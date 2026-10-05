/** KALEA — API du dashboard administrateur (protégée : rôle admin requis). */
import { all, get, run, newId, now, parseJson } from '../db.js';
import { config } from '../config.js';
import { assertObject, str, int, bool } from '../lib/validate.js';
import { badRequest, notFound, conflict } from '../lib/errors.js';
import { audit, queryLogs } from '../lib/logger.js';
import { requireAdmin } from '../middleware/session.js';
import { listPacks, getPack, serializePack, createPack, updatePack, deletePack } from '../services/packs.js';
import { serializeOrder, getOrderRow, updateOrder, STATUS_LABELS, ORDER_STATUS } from '../services/orders.js';
import { dashboardStats } from '../services/stats.js';
import { refundOrder, paymentsStatus } from '../services/payments/index.js';
import { fulfillOrder, listDeliveries, listDeliveryErrors, getDelivery, cancelScheduledRetry } from '../services/fulfillment.js';
import { botListRoles, discordStatus } from '../services/discord.js';
import { gameStatus } from '../services/gameapi.js';
import { toPublicUser } from '../middleware/session.js';

const SETTING_KEYS = ['site_name', 'tagline', 'support_email', 'discord_invite', 'checkout_note', 'legal_company', 'site_background'];

export function adminRoutes(router) {
  // Toutes les routes de ce fichier exigent un compte administrateur.
  router.use((ctx, next) => {
    if (ctx.path.startsWith('/api/admin/')) return requireAdmin(ctx, next);
    return next();
  });

  /* ------------------------------- Vue générale ------------------------------ */
  router.get('/api/admin/system', (ctx) => ctx.json({
    provider: paymentsStatus(),
    discord: discordStatus(),
    game: gameStatus(),
    environment: config.nodeEnv,
    node: process.version,
    baseUrl: config.baseUrl,
    rateLimit: config.security.rateLimitEnabled,
    refundRoleRemoval: config.discord.removeOnRefund,
    uptimeSec: Math.floor(process.uptime()),
    memoryMb: Math.round(process.memoryUsage().rss / 1048576),
  }));

  router.get('/api/admin/stats', (ctx) => ctx.json({ stats: dashboardStats() }));

  /* --------------------------------- Packs ---------------------------------- */
  router.get('/api/admin/packs', (ctx) => ctx.json({ packs: listPacks({ includeInactive: true }) }));

  router.post('/api/admin/packs', (ctx) => {
    const body = assertObject(ctx.body);
    const pack = createPack(body);
    audit('pack.created', { actor: ctx.user, target: pack.id, ip: ctx.ip, meta: { name: pack.name, price: pack.priceCents } });
    return ctx.json({ pack }, 201);
  });

  router.put('/api/admin/packs/:id', (ctx) => {
    const body = assertObject(ctx.body);
    const pack = updatePack(ctx.params.id, body);
    audit('pack.updated', { actor: ctx.user, target: pack.id, ip: ctx.ip, meta: { name: pack.name, price: pack.priceCents, active: pack.active } });
    return ctx.json({ pack });
  });

  router.delete('/api/admin/packs/:id', (ctx) => {
    const result = deletePack(ctx.params.id);
    audit('pack.deleted', { actor: ctx.user, target: ctx.params.id, ip: ctx.ip, meta: result });
    return ctx.json({ ok: true, ...result });
  });

  /* -------------------------------- Commandes -------------------------------- */
  router.get('/api/admin/orders', (ctx) => {
    const status = str(ctx.query.status ?? '', { field: 'statut', max: 30, required: false });
    const search = str(ctx.query.q ?? '', { field: 'recherche', max: 80, required: false });
    const page = int(ctx.query.page ?? 1, { field: 'page', min: 1, max: 10000, fallback: 1 });
    const limit = int(ctx.query.limit ?? 25, { field: 'limit', min: 1, max: 100, fallback: 25 });
    const where = [];
    const params = [];
    if (status) { where.push('o.status = ?'); params.push(status); }
    if (search) {
      where.push('(o.order_number LIKE ? OR o.id LIKE ? OR u.email LIKE ? OR u.display_name LIKE ? OR p.name LIKE ?)');
      params.push(...Array(5).fill(`%${search}%`));
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = get(`SELECT COUNT(*) AS c FROM orders o LEFT JOIN users u ON u.id = o.user_id LEFT JOIN packs p ON p.id = o.pack_id ${clause}`, ...params)?.c ?? 0;
    const rows = all(
      `SELECT o.*, u.display_name AS user_name, u.email AS user_email, u.discord_id AS user_discord,
              p.name AS pack_name, p.emoji AS pack_emoji, p.slug AS pack_slug
       FROM orders o
       LEFT JOIN users u ON u.id = o.user_id
       LEFT JOIN packs p ON p.id = o.pack_id
       ${clause}
       ORDER BY o.created_at DESC LIMIT ? OFFSET ?`,
      ...params, limit, (page - 1) * limit,
    );
    const orders = rows.map((row) => ({
      ...serializeOrder(row),
      user: { id: row.user_id, name: row.user_name, email: row.user_email, discordId: row.user_discord },
      packName: `${row.pack_emoji ?? ''} ${row.pack_name ?? '—'}`.trim(),
      packSlug: row.pack_slug,
    }));
    return ctx.json({ orders, total, page, limit, pages: Math.ceil(total / limit) });
  });

  router.get('/api/admin/orders/:id', (ctx) => {
    const order = getOrderRow(ctx.params.id);
    if (!order) throw notFound('Commande introuvable.');
    const user = get('SELECT * FROM users WHERE id = ?', order.user_id);
    const events = all('SELECT * FROM payment_events WHERE order_id = ? ORDER BY received_at DESC', order.id);
    const grants = all('SELECT * FROM grants WHERE order_id = ? ORDER BY created_at', order.id);
    const delivery = getDelivery(order.id);
    return ctx.json({
      order: { ...serializeOrder(order), user: toPublicUser(user) },
      events: events.map((e) => ({ id: e.id, type: e.type, status: e.status, provider: e.provider, message: e.message, receivedAt: e.received_at, amountCents: e.amount_cents })),
      grants: grants.map((g) => ({ id: g.id, kind: g.kind, key: g.key, label: g.label, status: g.status, txId: g.tx_id, createdAt: g.created_at })),
      delivery: delivery ? { ...delivery, steps: JSON.parse(delivery.steps ?? '[]') } : null,
    });
  });

  router.post('/api/admin/orders/:id/refund', async (ctx) => {
    const order = getOrderRow(ctx.params.id);
    if (!order) throw notFound('Commande introuvable.');
    const body = assertObject(ctx.body ?? {});
    const reason = str(body.reason ?? 'Remboursement demandé par l’administrateur', { field: 'motif', max: 200 });
    const amountCents = body.amountCents === undefined ? order.amount_cents : int(body.amountCents, { field: 'montant', min: 1, max: order.amount_cents });
    cancelScheduledRetry(order.id);
    const result = await refundOrder({ order, amountCents, reason, actor: ctx.user });
    return ctx.json({ ok: true, ...result, order: serializeOrder(getOrderRow(order.id)) });
  });

  router.post('/api/admin/orders/:id/redeliver', async (ctx) => {
    const order = getOrderRow(ctx.params.id);
    if (!order) throw notFound('Commande introuvable.');
    if (order.status !== ORDER_STATUS.PAID) throw badRequest('Seule une commande payée peut être relancée.');
    const body = ctx.body ?? {};
    const result = await fulfillOrder(order.id, { trigger: 'admin', force: bool(body.force, false) });
    audit('delivery.admin_retry', { actor: ctx.user, target: order.id, ip: ctx.ip });
    return ctx.json({ ok: true, result, order: serializeOrder(getOrderRow(order.id)) });
  });

  router.post('/api/admin/orders/:id/mark-expired', (ctx) => {
    const order = getOrderRow(ctx.params.id);
    if (!order) throw notFound('Commande introuvable.');
    updateOrder(order.id, { status: ORDER_STATUS.EXPIRED, failureReason: 'Clôturée manuellement' });
    audit('order.expired', { actor: ctx.user, target: order.id, ip: ctx.ip });
    return ctx.json({ ok: true, order: serializeOrder(getOrderRow(order.id)) });
  });

  /* -------------------------------- Utilisateurs ----------------------------- */
  router.get('/api/admin/users', (ctx) => {
    const search = str(ctx.query.q ?? '', { field: 'recherche', max: 80, required: false });
    const page = int(ctx.query.page ?? 1, { field: 'page', min: 1, max: 5000, fallback: 1 });
    const limit = 25;
    const clause = search ? 'WHERE email LIKE ? OR display_name LIKE ? OR discord_id LIKE ? OR game_player_id LIKE ?' : '';
    const params = search ? Array(4).fill(`%${search}%`) : [];
    const total = get(`SELECT COUNT(*) AS c FROM users ${clause}`, ...params)?.c ?? 0;
    const rows = all(
      `SELECT u.*, (SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id AND o.status = 'paid') AS paid_orders,
              (SELECT COALESCE(SUM(o.amount_cents),0) FROM orders o WHERE o.user_id = u.id AND o.status = 'paid') AS revenue,
              (SELECT COUNT(*) FROM user_packs up WHERE up.user_id = u.id AND up.active = 1) AS active_packs
       FROM users u ${clause} ORDER BY u.created_at DESC LIMIT ? OFFSET ?`,
      ...params, limit, (page - 1) * limit,
    );
    return ctx.json({
      users: rows.map((u) => ({
        ...toPublicUser(u),
        gamePlayerId: u.game_player_id,
        paidOrders: u.paid_orders,
        revenue: ((u.revenue ?? 0) / 100).toFixed(2).replace('.', ','),
        activePacks: u.active_packs,
        createdAt: u.created_at,
      })),
      total, page, pages: Math.ceil(total / limit),
    });
  });

  router.get('/api/admin/users/:id', (ctx) => {
    const user = get('SELECT * FROM users WHERE id = ?', ctx.params.id);
    if (!user) throw notFound('Utilisateur introuvable.');
    const orders = all('SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC', user.id);
    const grants = all('SELECT * FROM grants WHERE user_id = ? ORDER BY created_at DESC', user.id);
    const packs = all('SELECT up.*, p.name, p.emoji FROM user_packs up JOIN packs p ON p.id = up.pack_id WHERE up.user_id = ?', user.id);
    const sessions = all('SELECT id, created_at, last_seen_at, expires_at, ip FROM sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 10', user.id);
    return ctx.json({
      user: { ...toPublicUser(user), gamePlayerId: user.game_player_id, createdAt: user.created_at },
      orders: orders.map((o) => serializeOrder(o)),
      grants: grants.map((g) => ({ id: g.id, orderId: g.order_id, kind: g.kind, label: g.label, status: g.status, txId: g.tx_id, createdAt: g.created_at })),
      packs: packs.map((p) => ({ id: p.pack_id, name: p.name, emoji: p.emoji, active: p.active, grantedAt: p.granted_at, orderId: p.order_id })),
      sessions: sessions.map((s) => ({ id: s.id.slice(0, 12) + '…', createdAt: s.created_at, lastSeenAt: s.last_seen_at, ip: s.ip })),
    });
  });

  router.put('/api/admin/users/:id', (ctx) => {
    const user = get('SELECT * FROM users WHERE id = ?', ctx.params.id);
    if (!user) throw notFound('Utilisateur introuvable.');
    const body = assertObject(ctx.body);
    const sets = [];
    const values = [];
    if (body.role !== undefined) {
      const role = str(body.role, { field: 'rôle', max: 20 });
      if (!['user', 'admin'].includes(role)) throw badRequest('Rôle invalide.');
      if (user.id === ctx.user.id && role !== 'admin') throw badRequest('Impossible de retirer son propre accès admin.');
      sets.push('role = ?'); values.push(role);
    }
    if (body.status !== undefined) {
      const status = str(body.status, { field: 'statut', max: 20 });
      if (!['active', 'banned'].includes(status)) throw badRequest('Statut invalide.');
      if (user.id === ctx.user.id && status !== 'active') throw badRequest('Impossible de désactiver son propre compte.');
      sets.push('status = ?'); values.push(status);
    }
    if (body.gamePlayerId !== undefined) { sets.push('game_player_id = ?'); values.push(String(body.gamePlayerId).slice(0, 64) || null); }
    if (body.displayName !== undefined) { sets.push('display_name = ?'); values.push(str(body.displayName, { field: 'pseudo', min: 3, max: 32 })); }
    if (!sets.length) throw badRequest('Aucune modification.');
    sets.push('updated_at = ?'); values.push(now(), user.id);
    run(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, ...values);
    if (body.status === 'banned') run('DELETE FROM sessions WHERE user_id = ?', user.id);
    audit('user.updated', { actor: ctx.user, target: user.id, ip: ctx.ip, meta: { role: body.role, status: body.status } });
    return ctx.json({ user: toPublicUser(get('SELECT * FROM users WHERE id = ?', user.id)) });
  });

  /* --------------------------------- Livraisons ------------------------------ */
  router.get('/api/admin/deliveries', (ctx) => {
    const status = str(ctx.query.status ?? '', { field: 'statut', max: 30, required: false });
    const rows = status === 'errors' ? listDeliveryErrors() : listDeliveries({ status, limit: 100 });
    const enriched = rows.map((d) => {
      const order = get('SELECT order_number, status, amount_cents FROM orders WHERE id = ?', d.order_id);
      const user = get('SELECT display_name, email FROM users WHERE id = ?', d.user_id);
      return {
        ...d,
        steps: parseJson(d.steps, []) ?? [],
        orderNumber: order?.order_number ?? '—',
        orderStatus: order?.status ?? null,
        user: user ? { name: user.display_name, email: user.email } : null,
      };
    });
    return ctx.json({ deliveries: enriched, errors: listDeliveryErrors().length });
  });

  router.post('/api/admin/deliveries/:orderId/retry', async (ctx) => {
    const order = getOrderRow(ctx.params.orderId);
    if (!order) throw notFound('Commande introuvable.');
    cancelScheduledRetry(order.id);
    const result = await fulfillOrder(order.id, { trigger: 'admin_retry', force: bool(ctx.body?.force, false) });
    audit('delivery.retry', { actor: ctx.user, target: order.id, ip: ctx.ip, meta: result.status });
    return ctx.json({ ok: true, result });
  });

  /* -------------------------- Paiements & remboursements ---------------------- */
  router.get('/api/admin/payments', (ctx) => {
    const limit = int(ctx.query.limit ?? 50, { field: 'limit', min: 1, max: 200, fallback: 50 });
    const rows = all(
      `SELECT e.*, o.order_number, o.status AS order_status, u.email AS user_email
       FROM payment_events e
       LEFT JOIN orders o ON o.id = e.order_id
       LEFT JOIN users u ON u.id = o.user_id
       ORDER BY e.received_at DESC LIMIT ?`,
      limit,
    );
    const refunds = all(
      `SELECT id, order_number, refunded_cents, refund_reason, provider_refund_id, updated_at, user_id
       FROM orders WHERE refunded_cents > 0 OR status = 'refunded' ORDER BY updated_at DESC LIMIT 50`,
    ).map((r) => ({ ...r, user: get('SELECT email, display_name FROM users WHERE id = ?', r.user_id) }));
    return ctx.json({
      events: rows.map((e) => ({
        id: e.id, eventId: e.event_id, provider: e.provider, type: e.type, status: e.status,
        message: e.message, orderNumber: e.order_number, orderStatus: e.order_status,
        userEmail: e.user_email, amountCents: e.amount_cents, receivedAt: e.received_at,
      })),
      refunds,
      status: paymentsStatus(),
    });
  });

  /* ---------------------------------- Logs ----------------------------------- */
  router.get('/api/admin/logs', (ctx) => {
    const action = str(ctx.query.action ?? '', { field: 'action', max: 60, required: false });
    const limit = int(ctx.query.limit ?? 100, { field: 'limit', min: 1, max: 500, fallback: 100 });
    const offset = int(ctx.query.offset ?? 0, { field: 'offset', min: 0, max: 100000, fallback: 0 });
    return ctx.json({ logs: queryLogs({ action, limit, offset }) });
  });

  router.get('/api/admin/errors', (ctx) => ctx.json({
    deliveries: listDeliveryErrors().map((d) => ({ ...d, steps: parseJson(d.steps, []) ?? [] })),
    failedOrders: all(`SELECT * FROM orders WHERE status = 'failed' ORDER BY updated_at DESC LIMIT 50`)
      .map((o) => serializeOrder(o)),
    paymentErrors: all(`SELECT * FROM payment_events WHERE status = 'error' ORDER BY received_at DESC LIMIT 50`)
      .map((e) => ({ id: e.id, type: e.type, provider: e.provider, message: e.message, receivedAt: e.received_at })),
  }));

  /* --------------------------------- Tickets --------------------------------- */
  router.get('/api/admin/tickets', (ctx) => ctx.json({
    tickets: all('SELECT * FROM tickets ORDER BY created_at DESC LIMIT 200').map((t) => ({
      ...t, createdAt: t.created_at, updatedAt: t.updated_at,
    })),
  }));

  router.put('/api/admin/tickets/:id', (ctx) => {
    const ticket = get('SELECT * FROM tickets WHERE id = ?', ctx.params.id);
    if (!ticket) throw notFound('Ticket introuvable.');
    const status = str(ctx.body?.status ?? '', { field: 'statut', max: 20 });
    if (!['open', 'pending', 'closed'].includes(status)) throw badRequest('Statut invalide.');
    run('UPDATE tickets SET status = ?, updated_at = ? WHERE id = ?', status, now(), ticket.id);
    audit('ticket.updated', { actor: ctx.user, target: ticket.id, ip: ctx.ip, meta: { status } });
    return ctx.json({ ok: true });
  });

  /* -------------------------------- Paramètres -------------------------------- */
  router.get('/api/admin/settings', (ctx) => {
    const rows = Object.fromEntries(all('SELECT key, value FROM settings').map((r) => [r.key, parseJson(r.value, r.value)]));
    return ctx.json({ settings: rows, keys: SETTING_KEYS, env: {
      provider: config.payments.provider,
      stripe: config.payments.configuredStripe,
      webhook: Boolean(config.payments.stripeWebhookSecret),
      discordOAuth: config.discord.oauthConfigured,
      discordBot: config.discord.botConfigured,
      gameApi: config.game.outboundConfigured,
      removeRoleOnRefund: config.discord.removeOnRefund,
    } });
  });

  router.put('/api/admin/settings', (ctx) => {
    const body = assertObject(ctx.body);
    const updated = [];
    for (const key of SETTING_KEYS) {
      if (body[key] === undefined) continue;
      const value = str(body[key], { field: key, max: 300, required: false });
      run(`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        key, JSON.stringify(value), now());
      updated.push(key);
    }
    audit('settings.updated', { actor: ctx.user, ip: ctx.ip, meta: { keys: updated } });
    const rows = Object.fromEntries(all('SELECT key, value FROM settings').map((r) => [r.key, parseJson(r.value, r.value)]));
    return ctx.json({ settings: rows, updated });
  });

  /* --------------------------- Rôles Discord (live) --------------------------- */
  router.get('/api/admin/discord/roles', async (ctx) => {
    if (!discordStatus().bot) {
      const fallback = [
        config.discord.roleBase && { id: config.discord.roleBase, name: 'Pack de Base (env)' },
        config.discord.roleFullLocker && { id: config.discord.roleFullLocker, name: 'Full Locker (env)' },
        config.discord.roleModer && { id: config.discord.roleModer, name: 'Moder (env)' },
      ].filter(Boolean);
      return ctx.json({ roles: fallback, source: 'env', status: discordStatus() });
    }
    try {
      const roles = await botListRoles();
      return ctx.json({ roles, source: 'discord', status: discordStatus() });
    } catch (error) {
      return ctx.json({ roles: [], source: 'error', error: error.message, status: discordStatus() });
    }
  });
}

export { conflict, newId };
