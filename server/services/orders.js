/** KALEA — service commandes : création, numérotation, transitions d'état. */
import { all, get, run, newId, now, parseJson, toRow, transaction } from '../db.js';
import { notFound, conflict, badRequest } from '../lib/errors.js';
import { getPackRow } from './packs.js';

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
 * Crée une commande pour un utilisateur et un pack.
 * La clé d'idempotence garantit qu'un double clic ne crée jamais deux commandes
 * identiques en parallèle.
 */
export function createOrder({ user, packId, idempotencyKey = null }) {
  const pack = getPackRow(packId);
  if (!pack) throw notFound('Pack introuvable.');
  if (pack.active !== 1) throw badRequest('Ce pack n’est plus disponible à la vente.');

  return transaction(() => {
    if (idempotencyKey) {
      const existing = get('SELECT * FROM orders WHERE idempotency_key = ?', idempotencyKey);
      if (existing) return existing;
    }
    // Une seule commande "en attente" par pack et par joueur.
    const pending = get(
      `SELECT * FROM orders WHERE user_id = ? AND pack_id = ? AND status IN ('pending','processing')
       ORDER BY created_at DESC LIMIT 1`,
      user.id, pack.id,
    );
    if (pending) return pending;

    const id = newId('ord');
    const ts = now();
    run(
      `INSERT INTO orders (id, order_number, user_id, pack_id, pack_snapshot, amount_cents, currency,
         status, provider, idempotency_key, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`,
      id, nextOrderNumber(), user.id, pack.id,
      toRow({
        id: pack.id, slug: pack.slug, name: pack.name, emoji: pack.emoji,
        priceCents: pack.price_cents, discordRoleId: pack.discord_role_id,
        discordRoleName: pack.discord_role_name, gameRewards: parseJson(pack.game_rewards, {}),
        features: parseJson(pack.features, []),
      }),
      pack.price_cents, pack.currency,
      'pending', idempotencyKey ?? `idem_${id}`, ts, ts,
    );
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
    userId: row.user_id,
    amountCents: row.amount_cents,
    amount: (row.amount_cents / 100).toFixed(2).replace('.', ','),
    currency: row.currency,
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
  return { order: updated, alreadyPaid: false };
}
