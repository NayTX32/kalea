/** KALEA — statistiques du dashboard administrateur. */
import { get, all, parseJson } from '../db.js';
import { listPacks } from './packs.js';
import { STATUS_LABELS } from './orders.js';

export function dashboardStats() {
  const totals = get(`
    SELECT
      COUNT(*) AS orders,
      SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) AS paid,
      SUM(CASE WHEN status = 'refunded' THEN 1 ELSE 0 END) AS refunded,
      SUM(CASE WHEN status IN ('failed') THEN 1 ELSE 0 END) AS failed,
      SUM(CASE WHEN status IN ('pending','processing') THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN status = 'paid' THEN amount_cents ELSE 0 END) AS gross_cents,
      SUM(CASE WHEN status = 'paid' THEN refunded_cents ELSE 0 END) AS refunded_cents
    FROM orders
  `) ?? {};

  const gross = Number(totals.gross_cents ?? 0);
  const refundedAmount = Number(totals.refunded_cents ?? 0);

  const users = get('SELECT COUNT(*) AS c FROM users')?.c ?? 0;
  const discordLinked = get('SELECT COUNT(*) AS c FROM users WHERE discord_id IS NOT NULL')?.c ?? 0;
  const deliveries = get(`
    SELECT
      SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END) AS delivered,
      SUM(CASE WHEN status IN ('failed','partial','blocked') THEN 1 ELSE 0 END) AS errors,
      SUM(CASE WHEN status = 'delivering' THEN 1 ELSE 0 END) AS running
    FROM deliveries
  `) ?? {};

  const perPack = listPacks({ includeInactive: true }).map((pack) => {
    const row = get(`
      SELECT COUNT(*) AS units, COALESCE(SUM(amount_cents), 0) AS revenue
      FROM orders WHERE pack_id = ? AND status IN ('paid','refunded')
    `, pack.id) ?? {};
    return {
      id: pack.id, name: pack.name, emoji: pack.emoji, price: pack.price,
      active: pack.active, units: row.units ?? 0,
      revenue: ((Number(row.revenue ?? 0)) / 100).toFixed(2).replace('.', ','),
    };
  });

  const statusBreakdown = all('SELECT status, COUNT(*) AS c FROM orders GROUP BY status')
    .map((r) => ({ status: r.status, label: STATUS_LABELS[r.status] ?? r.status, count: r.c }));

  // Série des 14 derniers jours (revenu + volume).
  const days = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let i = 13; i >= 0; i -= 1) {
    const start = new Date(today.getTime() - i * 86_400_000).getTime();
    const end = start + 86_400_000;
    const row = get(`
      SELECT COUNT(*) AS orders, COALESCE(SUM(CASE WHEN status IN ('paid','refunded') THEN amount_cents ELSE 0 END), 0) AS cents
      FROM orders WHERE created_at >= ? AND created_at < ?
    `, start, end) ?? {};
    days.push({
      date: new Date(start).toISOString().slice(0, 10),
      label: new Date(start).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }),
      orders: row.orders ?? 0,
      revenue: Number(row.cents ?? 0) / 100,
    });
  }

  const recentOrders = all(`
    SELECT o.*, u.display_name AS user_name, u.email AS user_email, p.name AS pack_name, p.emoji AS pack_emoji
    FROM orders o
    LEFT JOIN users u ON u.id = o.user_id
    LEFT JOIN packs p ON p.id = o.pack_id
    ORDER BY o.created_at DESC LIMIT 8
  `).map((row) => ({
    id: row.id,
    number: row.order_number,
    user: row.user_name ?? '—',
    email: row.user_email,
    pack: `${row.pack_emoji ?? ''} ${row.pack_name ?? '—'}`.trim(),
    amount: (row.amount_cents / 100).toFixed(2).replace('.', ','),
    status: row.status,
    statusLabel: STATUS_LABELS[row.status] ?? row.status,
    createdAt: row.created_at,
  }));

  return {
    revenue: {
      gross: (gross / 100).toFixed(2).replace('.', ','),
      refunded: (refundedAmount / 100).toFixed(2).replace('.', ','),
      net: ((gross - refundedAmount) / 100).toFixed(2).replace('.', ','),
    },
    orders: {
      total: totals.orders ?? 0,
      paid: totals.paid ?? 0,
      refunded: totals.refunded ?? 0,
      failed: totals.failed ?? 0,
      pending: totals.pending ?? 0,
      breakdown: statusBreakdown,
    },
    users: { total: users, discordLinked },
    deliveries: {
      delivered: deliveries.delivered ?? 0,
      errors: deliveries.errors ?? 0,
      running: deliveries.running ?? 0,
    },
    packs: perPack,
    series: days,
    recentOrders,
  };
}
