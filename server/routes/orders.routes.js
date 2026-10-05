/** KALEA — parcours d'achat : création de commande, paiement, suivi, livraison. */
import { config } from '../config.js';
import { get, all, now } from '../db.js';
import { badRequest, notFound } from '../lib/errors.js';
import { assertObject, str } from '../lib/validate.js';
import { rateLimit } from '../lib/ratelimit.js';
import { audit, log } from '../lib/logger.js';
import { requireAuth, toPublicUser } from '../middleware/session.js';
import { createOrder, getOrderRow, requireOwnedOrder, listOrdersForUser, updateOrder, serializeOrder, ORDER_STATUS, STATUS_LABELS } from '../services/orders.js';
import { getPack, serializePack } from '../services/packs.js';
import { startCheckout, activeProvider, handlePaymentEvent, confirmPaymentFromServer } from '../services/payments/index.js';
import { demoProvider } from '../services/payments/demo.js';
import { fulfillOrder, getDelivery } from '../services/fulfillment.js';
import { grantRewards } from '../services/gameapi.js';

export function orderRoutes(router) {
  /* ------------------------- Création d'une commande ------------------------- */
  router.post('/api/orders', requireAuth, rateLimit('api'), (ctx) => {
    const body = assertObject(ctx.body);
    const packId = str(body.packId, { field: 'pack', min: 1, max: 60 });
    const idempotencyKey = str(body.idempotencyKey ?? '', { field: 'clé', max: 80, required: false }) || null;
    const pack = getPack(packId);

    const order = createOrder({ user: ctx.user, packId: pack.id, idempotencyKey });
    audit('order.created', { actor: ctx.user, target: order.id, ip: ctx.ip, meta: { pack: pack.slug, amount: order.amount_cents } });

    if (order.status === ORDER_STATUS.PAID) {
      return ctx.json({ order: serializeOrder(order), alreadyPaid: true });
    }
    return ctx.json({ order: serializeOrder(order) }, 201);
  });

  /* ------------------------ Ouverture du paiement --------------------------- */
  router.post('/api/orders/:id/checkout', requireAuth, rateLimit('api'), async (ctx) => {
    const order = requireOwnedOrder(ctx, ctx.params.id);
    if (order.status === ORDER_STATUS.PAID) throw badRequest('Cette commande est déjà payée.');
    if ([ORDER_STATUS.REFUNDED, ORDER_STATUS.CANCELED, ORDER_STATUS.EXPIRED].includes(order.status)) {
      throw badRequest('Cette commande n’est plus payable.');
    }
    const pack = getPack(order.pack_id);
    const fresh = getOrderRow(order.id);
    const checkout = await startCheckout({ order: fresh, user: ctx.userRow, pack });
    return ctx.json({ order: serializeOrder(getOrderRow(order.id)), checkout });
  });

  /* --------------------------- Paiement démo ------------------------------- */
  router.post('/api/demo/orders/:id/pay', requireAuth, rateLimit('auth', 20), async (ctx) => {
    if (activeProvider().name !== 'demo') throw badRequest('Le mode démo est désactivé (Stripe est actif).');
    const order = requireOwnedOrder(ctx, ctx.params.id);
    const body = assertObject(ctx.body);
    const outcome = str(body.outcome ?? 'succeeded', { field: 'résultat', max: 20 });
    const reason = str(body.reason ?? '', { field: 'motif', max: 200, required: false });

    if (outcome === 'canceled') {
      if (![ORDER_STATUS.PENDING, ORDER_STATUS.PROCESSING].includes(order.status)) {
        throw badRequest('Cette commande n’est plus en attente de paiement.');
      }
      updateOrder(order.id, { status: ORDER_STATUS.CANCELED, failureReason: 'Paiement annulé par le joueur' });
      audit('payment.canceled', { actor: ctx.user, target: order.id, ip: ctx.ip });
      return ctx.json({ ok: true, status: ORDER_STATUS.CANCELED, statusLabel: STATUS_LABELS.canceled });
    }

    const type = outcome === 'failed' ? 'payment_intent.payment_failed' : 'payment_intent.succeeded';
    const { event, raw, signature } = demoProvider.buildEvent({
      type, order, amountCents: order.amount_cents,
      paymentIntentId: `pi_demo_${order.id}`, reason: reason || 'Fonds insuffisants (simulation)',
    });
    // Exactement le même canal qu'un vrai prestataire : webhook signé.
    const result = await handlePaymentEvent({ providerName: 'demo', rawBody: raw, signatureHeader: signature });
    const updated = getOrderRow(order.id);
    log.info('demo_payment', { orderId: order.id, outcome, eventId: event.id });
    return ctx.json({
      ok: true,
      result,
      status: updated.status,
      statusLabel: STATUS_LABELS[updated.status],
      order: serializeOrder(updated),
    });
  });

  /* ----------------------------- Suivi ------------------------------------- */
  /**
   * Retour du joueur depuis PayPal : capture + vérification serveur.
   * Le webhook reste l'autorité finale (traitement idempotent).
   */
  router.post('/api/orders/:id/capture', requireAuth, rateLimit('auth', 20), async (ctx) => {
    const order = requireOwnedOrder(ctx, ctx.params.id);
    if (order.status === ORDER_STATUS.PAID) {
      return ctx.json({ ok: true, status: 'paid', alreadyPaid: true, order: serializeOrder(order) });
    }
    const provider = order.provider || activeProvider().name;
    if (provider !== 'paypal') throw badRequest('Cette commande n’utilise pas PayPal.');
    const result = await confirmPaymentFromServer({ orderId: order.id, providerName: provider, source: 'player_return' });
    return ctx.json({
      ok: result.status === 'paid' || result.status === 'already_paid',
      status: result.status,
      order: serializeOrder(result.order),
    });
  });

  router.get('/api/orders/:id', requireAuth, (ctx) => {
    const order = requireOwnedOrder(ctx, ctx.params.id);
    return ctx.json({ order: serializeOrder(order) });
  });

  router.get('/api/orders', requireAuth, (ctx) => {
    const orders = listOrdersForUser(ctx.user.id);
    return ctx.json({ orders: orders.map((o) => serializeOrder(o)) });
  });

  router.post('/api/orders/:id/cancel', requireAuth, (ctx) => {
    const order = requireOwnedOrder(ctx, ctx.params.id);
    if (![ORDER_STATUS.PENDING, ORDER_STATUS.PROCESSING].includes(order.status)) {
      throw badRequest('Seule une commande en attente peut être annulée.');
    }
    updateOrder(order.id, { status: ORDER_STATUS.CANCELED, failureReason: 'Annulée par le joueur' });
    audit('order.canceled', { actor: ctx.user, target: order.id, ip: ctx.ip });
    return ctx.json({ ok: true, order: serializeOrder(getOrderRow(order.id)) });
  });

  /* -------------------- Livraison / relance par le joueur ------------------- */
  router.post('/api/orders/:id/deliver', requireAuth, rateLimit('api'), async (ctx) => {
    const order = requireOwnedOrder(ctx, ctx.params.id);
    if (order.status !== ORDER_STATUS.PAID) throw badRequest('Seule une commande payée peut être livrée.');
    const result = await fulfillOrder(order.id, { trigger: 'player_retry', force: true });
    audit('delivery.retry', { actor: ctx.user, target: order.id, ip: ctx.ip });
    return ctx.json({ ok: true, result, order: serializeOrder(getOrderRow(order.id)) });
  });

  /* --------------------- Rattrapage manuel des récompenses ------------------ */
  router.post('/api/orders/:id/sync-game', requireAuth, rateLimit('api'), async (ctx) => {
    const order = requireOwnedOrder(ctx, ctx.params.id);
    if (order.status !== ORDER_STATUS.PAID) throw badRequest('Commande non payée.');
    const user = get('SELECT * FROM users WHERE id = ?', ctx.user.id);
    if (!user.game_player_id) throw badRequest('Renseignez d’abord votre identifiant de jeu.');
    const snapshot = JSON.parse(order.pack_snapshot);
    const res = await grantRewards({
      order, user,
      pack: { id: order.pack_id, slug: snapshot.slug, name: snapshot.name },
      txId: `tx_${order.id}`,
      rewards: snapshot.gameRewards ?? {},
    });
    return ctx.json({ ok: res.ok, skipped: Boolean(res.skipped), detail: res.data ?? res.error ?? null });
  });

  /* --------------------------- Mon compte ---------------------------------- */
  router.get('/api/account/overview', requireAuth, (ctx) => {
    const orders = listOrdersForUser(ctx.user.id);
    const packs = all(
      `SELECT up.*, p.name, p.slug, p.emoji, p.tagline, p.features, p.game_rewards, p.discord_role_name, p.price_cents
       FROM user_packs up JOIN packs p ON p.id = up.pack_id
       WHERE up.user_id = ? AND up.active = 1 ORDER BY up.granted_at DESC`,
      ctx.user.id,
    ).map((row) => ({
      id: row.pack_id,
      slug: row.slug,
      name: row.name,
      emoji: row.emoji,
      tagline: row.tagline,
      features: JSON.parse(row.features ?? '[]'),
      rewards: JSON.parse(row.game_rewards ?? '{}'),
      discordRoleName: row.discord_role_name,
      grantedAt: row.granted_at,
      orderId: row.order_id,
      price: (row.price_cents / 100).toFixed(2).replace('.', ','),
    }));

    const grants = all(
      'SELECT * FROM grants WHERE user_id = ? ORDER BY created_at DESC', ctx.user.id,
    ).map((g) => ({ id: g.id, orderId: g.order_id, kind: g.kind, key: g.key, label: g.label, status: g.status, createdAt: g.created_at, txId: g.tx_id }));

    const deliveries = all(
      `SELECT d.* FROM deliveries d WHERE d.user_id = ? ORDER BY d.updated_at DESC`, ctx.user.id,
    ).map((d) => ({ orderId: d.order_id, status: d.status, steps: JSON.parse(d.steps ?? '[]'), lastError: d.last_error, txId: d.tx_id, attempts: d.attempts, updatedAt: d.updated_at }));

    return ctx.json({
      user: toPublicUser(ctx.userRow),
      orders: orders.map((o) => serializeOrder(o)),
      packs,
      grants,
      deliveries,
      discordConfigured: config.discord.oauthConfigured,
      gameConfigured: Boolean(config.game.url),
    });
  });

  router.get('/api/account/orders', requireAuth, (ctx) =>
    ctx.json({ orders: listOrdersForUser(ctx.user.id).map((o) => serializeOrder(o)) }));

  router.get('/api/account/deliveries/:orderId', requireAuth, (ctx) => {
    const order = requireOwnedOrder(ctx, ctx.params.orderId);
    const delivery = getDelivery(order.id);
    if (!delivery) throw notFound('Aucune livraison pour cette commande.');
    return ctx.json({ delivery: { ...delivery, steps: JSON.parse(delivery.steps ?? '[]') } });
  });
}
