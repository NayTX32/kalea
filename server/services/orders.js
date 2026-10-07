/** KALEA — service commandes : création, numérotation, transitions d'état. */
import { all, get, run, newId, now, parseJson, toRow, transaction } from '../db.js';
import { notFound, conflict, badRequest } from '../lib/errors.js';
import { getPackRow, consumeStock, releaseStock } from './packs.js';
import { applyPromotion } from './promotions.js';

export const ORDER_STATUS = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  PAID: 'paid',
  FAILED: 'failed',
  CANCELED: 'canceled',
  EXPIRED: 'expired',
  REFUNDED: 'refunded',
};

export const STATUS_LABELS = {
  pending: 'En attente de paiement',
  processing: 'Paiement en cours',
  paid: 'Payée',
  failed: 'Échouée',
  canceled: 'Annulée',
  expired: 'Expirée',
  refunded: 'Remboursée',
};

function nextOrderNumber() {
  const row = get('SELECT COUNT(*) AS c FROM orders');
  const year = new Date().getFullYear();
  return `KAL-${year}-${String((row?.c ?? 0) + 1).padStart(5, '0')}`;
}

/**
 * Normalise les articles d'un panier.
 * Le serveur fixe les prix (jamais le client) et un pack numérique ne
 * s'achète qu'une seule fois par compte : la quantité est donc bornée à 1.
 */
function resolveItems({ packId, items }) {
  const list = Array.isArray(items) && items.length
    ? items
    : (packId ? [{ packId }] : []);
  if (!list.length) throw badRequest('Votre panier est vide.');

  const seen = new Set();
  const resolved = [];
  for (const entry of list) {
    const id = String(entry?.packId ?? '').trim();
    const qty = Number(entry?.qty ?? 1);
    if (!id) throw badRequest('Article du panier invalide.');
    if (!Number.isInteger(qty) || qty < 1) throw badRequest('Quantité invalide.');
    if (qty > 1) throw badRequest('Un pack numérique ne s’achète qu’une seule fois par compte.');
    if (seen.has(id)) throw badRequest('Ce pack apparaît deux fois dans le panier.');
    seen.add(id);
    resolved.push({ packId: id, qty });
  }
  if (resolved.length > 8) throw badRequest('Trop d’articles dans le panier (8 maximum).');
  return resolved;
}

const snapshotOf = (pack) => ({
  id: pack.id, slug: pack.slug, name: pack.name, emoji: pack.emoji,
  priceCents: pack.price_cents, discordRoleId: pack.discord_role_id,
  discordRoleName: pack.discord_role_name, gameRewards: parseJson(pack.game_rewards, {}),
  features: parseJson(pack.features, []),
});

/**
 * Articles d'une commande : lignes du panier, ou fallback sur le snapshot
 * pour les commandes créées avant l'introduction de `order_items`.
 */
export function getOrderItems(orderId) {
  const rows = all('SELECT * FROM order_items WHERE order_id = ? ORDER BY created_at, id', orderId);
  if (rows.length) {
    return rows.map((row) => ({
      packId: row.pack_id,
      snapshot: parseJson(row.snapshot, {}) ?? {},
      priceCents: row.price_cents,
      qty: row.qty,
    }));
  }
  const order = getOrderRow(orderId);
  if (!order) return [];
  return [{
    packId: order.pack_id,
    snapshot: parseJson(order.pack_snapshot, {}) ?? {},
    priceCents: order.amount_cents,
    qty: 1,
  }];
}

/**
 * Crée une commande : un article (achat direct) ou plusieurs (panier).
 * Un seul paiement, un montant total calculé côté serveur.
 * La clé d'idempotence garantit qu'un double clic ne crée jamais deux
 * commandes identiques en parallèle.
 *
 * @param {{user:object, packId?:string, items?:Array|null, idempotencyKey?:string|null, promoCode?:string|null}} input
 */
export function createOrder({ user, packId, items = null, idempotencyKey = null, promoCode = null }) {
  const resolved = resolveItems({ packId, items });
  const packs = resolved.map(({ packId: id }) => {
    const pack = getPackRow(id);
    if (!pack) throw notFound('Pack introuvable.');
    if (pack.active !== 1) throw badRequest(`« ${pack.name} » n’est plus disponible à la vente.`);
    if (pack.stock === 0) throw badRequest(`« ${pack.name} » est en rupture de stock.`);
    return pack;
  });

  const primary = packs[0];
  const subtotalCents = packs.reduce((sum, pack) => sum + pack.price_cents, 0);
  const signature = packs.map((pack) => pack.id).sort().join(',');

  // Promotion : validée ICI, côté serveur, sur le sous-total réel du panier.
  const promo = promoCode
    ? applyPromotion(promoCode, subtotalCents)
    : null;
  const discountCents = promo?.discountCents ?? 0;
  const amountCents = Math.max(0, subtotalCents - discountCents);
  const storedPromoCode = promo?.promotion?.code ?? null;

  /** Ajuste le code promo d'une commande encore « en attente » (aucun paiement lancé). */
  const reconcilePending = (order) => {
    if (order.status !== ORDER_STATUS.PENDING) return order;
    if ((order.promo_code ?? null) === storedPromoCode) return order;
    if (order.promo_code) {
      run(`UPDATE promotions SET used_count = MAX(0, used_count - 1)
           WHERE id = (SELECT id FROM promotions WHERE code = ?)`, order.promo_code);
    }
    if (promo) run('UPDATE promotions SET used_count = used_count + 1 WHERE id = ?', promo.promotion.id);
    run('UPDATE orders SET promo_code = ?, discount_cents = ?, amount_cents = ?, updated_at = ? WHERE id = ?',
      storedPromoCode, discountCents, amountCents, now(), order.id);
    return get('SELECT * FROM orders WHERE id = ?', order.id);
  };

  return transaction(() => {
    if (idempotencyKey) {
      const existing = get('SELECT * FROM orders WHERE idempotency_key = ?', idempotencyKey);
      if (existing) return reconcilePending(existing);
    }
    // Une seule commande "en attente" identique par joueur (panier identique).
    const pending = all(
      `SELECT * FROM orders WHERE user_id = ? AND status IN ('pending','processing')
       ORDER BY created_at DESC`,
      user.id,
    ).find((row) => getOrderItems(row.id).map((i) => i.packId).sort().join(',') === signature);
    if (pending) return reconcilePending(pending);

    const id = newId('ord');
    const ts = now();
    run(
      `INSERT INTO orders (id, order_number, user_id, pack_id, pack_snapshot, amount_cents, currency,
         status, provider, idempotency_key, promo_code, discount_cents, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)`,
      id, nextOrderNumber(), user.id, primary.id, toRow(snapshotOf(primary)),
      amountCents, primary.currency,
      'pending', idempotencyKey ?? `idem_${id}`, storedPromoCode, discountCents, ts, ts,
    );
    for (const pack of packs) {
      run(
        `INSERT INTO order_items (id, order_id, pack_id, snapshot, price_cents, qty, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        newId('itm'), id, pack.id, toRow(snapshotOf(pack)), pack.price_cents, 1, ts,
      );
    }
    if (promo) {
      // La réservation du code est comptée à la création : deux joueurs ne
      // peuvent pas dépasser `max_uses` en ouvrant des paniers en parallèle.
      run('UPDATE promotions SET used_count = used_count + 1 WHERE id = ?', promo.promotion.id);
    }
    return get('SELECT * FROM orders WHERE id = ?', id);
  });
}

export function getOrderRow(orderId) {
  return get('SELECT * FROM orders WHERE id = ?', orderId);
}

export function requireOwnedOrder(ctx, orderId) {
  const order = getOrderRow(orderId);
  if (!order) throw notFound('Commande introuvable.');
  if (order.user_id !== ctx.user.id && ctx.userRow?.role !== 'admin') {
    throw notFound('Commande introuvable.');
  }
  return order;
}

export function listOrdersForUser(userId) {
  return all('SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC', userId);
}

export function updateOrder(orderId, patch) {
  const fields = [];
  const values = [];
  const map = {
    status: 'status',
    provider: 'provider',
    checkoutSessionId: 'checkout_session_id',
    paymentIntentId: 'payment_intent_id',
    providerRefundId: 'provider_refund_id',
    failureReason: 'failure_reason',
    refundReason: 'refund_reason',
    refundedCents: 'refunded_cents',
    paidAt: 'paid_at',
  };
  for (const [key, column] of Object.entries(map)) {
    if (patch[key] !== undefined) {
      fields.push(`${column} = ?`);
      values.push(patch[key]);
    }
  }
  if (!fields.length) return getOrderRow(orderId);
  fields.push('updated_at = ?');
  values.push(now(), orderId);
  run(`UPDATE orders SET ${fields.join(', ')} WHERE id = ?`, ...values);
  return getOrderRow(orderId);
}

export function serializeOrder(row, { includePack = true } = {}) {
  if (!row) return null;
  const snapshot = parseJson(row.pack_snapshot, {}) ?? {};
  const delivery = get('SELECT * FROM deliveries WHERE order_id = ?', row.id);
  const items = getOrderItems(row.id);
  return {
    id: row.id,
    number: row.order_number,
    packId: row.pack_id,
    pack: includePack
      ? {
          id: snapshot.id,
          slug: snapshot.slug,
          name: snapshot.name,
          emoji: snapshot.emoji,
          features: snapshot.features ?? [],
          priceCents: snapshot.priceCents,
        }
      : undefined,
    /** Articles du panier (un seul pour les commandes simples). */
    items: items.map((item) => ({
      packId: item.packId,
      name: item.snapshot?.name ?? item.packId,
      slug: item.snapshot?.slug ?? null,
      emoji: item.snapshot?.emoji ?? null,
      priceCents: item.priceCents,
      qty: item.qty,
    })),
    userId: row.user_id,
    amountCents: row.amount_cents,
    amount: (row.amount_cents / 100).toFixed(2).replace('.', ','),
    currency: row.currency,
    /** Code promo appliqué (null si aucun) + remise correspondante. */
    promoCode: row.promo_code ?? null,
    discountCents: row.discount_cents ?? 0,
    discount: ((row.discount_cents ?? 0) / 100).toFixed(2).replace('.', ','),
    subtotalCents: (row.amount_cents ?? 0) + (row.discount_cents ?? 0),
    status: row.status,
    statusLabel: STATUS_LABELS[row.status] ?? row.status,
    provider: row.provider,
    paymentIntentId: row.payment_intent_id ?? null,
    failureReason: row.failure_reason ?? null,
    refundReason: row.refund_reason ?? null,
    refundedCents: row.refunded_cents,
    paidAt: row.paid_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    delivery: delivery
      ? {
          status: delivery.status,
          steps: parseJson(delivery.steps, []) ?? [],
          attempts: delivery.attempts,
          lastError: delivery.last_error,
          txId: delivery.tx_id,
          updatedAt: delivery.updated_at,
        }
      : null,
  };
}

/** Passe une commande à l'état « payée » (appelé uniquement après vérification webhook). */
export function markOrderPaid(orderId, { provider, paymentIntentId = null, paidAt = Date.now() }) {
  const order = getOrderRow(orderId);
  if (!order) throw notFound('Commande introuvable.');
  if (order.status === ORDER_STATUS.PAID) return { order, alreadyPaid: true };
  if ([ORDER_STATUS.REFUNDED, ORDER_STATUS.CANCELED, ORDER_STATUS.EXPIRED].includes(order.status)) {
    throw conflict(`Impossible de marquer une commande « ${order.status} » comme payée.`, 'invalid_transition');
  }
  const updated = updateOrder(orderId, {
    status: ORDER_STATUS.PAID,
    provider: provider ?? order.provider,
    paymentIntentId,
    paidAt,
    failureReason: null,
  });
  // Stock : décrémenté UNE SEULE FOIS, uniquement sur la transition réelle
  // vers « payée » (le webhook peut être rejoué : `alreadyPaid` ci-dessus).
  for (const item of getOrderItems(orderId)) {
    consumeStock(item.packId, item.qty ?? 1);
  }
  return { order: updated, alreadyPaid: false };
}

/**
 * Remboursement complet : ré-incrémente le stock des packs concernés.
 * Appelé depuis le module paiements après `revokeOrder`.
 */
export function releaseOrderStock(orderId) {
  for (const item of getOrderItems(orderId)) {
    releaseStock(item.packId, item.qty ?? 1);
  }
}
