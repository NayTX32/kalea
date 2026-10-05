/** KALEA — support : formulaire de contact → tickets. */
import { all, get, run, newId, now } from '../db.js';
import { config } from '../config.js';
import { assertObject, str, email as vEmail, int } from '../lib/validate.js';
import { rateLimit } from '../lib/ratelimit.js';
import { badRequest } from '../lib/errors.js';
import { audit } from '../lib/logger.js';

const CATEGORIES = ['achat', 'paiement', 'livraison', 'discord', 'jeu', 'compte', 'autre'];

export function supportRoutes(router) {
  router.post('/api/support/tickets', rateLimit('auth', 8), (ctx) => {
    const body = assertObject(ctx.body);
    const email = vEmail(body.email);
    const name = str(body.name ?? (ctx.user?.displayName ?? 'Joueur'), { field: 'nom', min: 2, max: 60 });
    const subject = str(body.subject, { field: 'sujet', min: 3, max: 140 });
    const message = str(body.message, { field: 'message', min: 10, max: 4000 });
    let category = str(body.category ?? 'autre', { field: 'catégorie', max: 30, required: false }) || 'autre';
    if (!CATEGORIES.includes(category)) category = 'autre';

    const id = newId('tkt');
    const ref = `SUP-${String(((get('SELECT COUNT(*) AS c FROM tickets')?.c ?? 0) + 1)).padStart(4, '0')}`;
    run(
      `INSERT INTO tickets (id, ref, user_id, name, email, subject, category, message, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`,
      id, ref, ctx.user?.id ?? null, name, email, subject, category, message, now(), now(),
    );
    audit('support.ticket_created', { actor: ctx.user, target: id, ip: ctx.ip, meta: { subject, category } });
    return ctx.json({ ok: true, ref, id }, 201);
  });

  router.get('/api/support/tickets/mine', (ctx) => {
    if (!ctx.user) throw badRequest('Connectez-vous pour consulter vos demandes.');
    const rows = all('SELECT * FROM tickets WHERE user_id = ? ORDER BY created_at DESC', ctx.user.id);
    return ctx.json({ tickets: rows.map((t) => ({ ...t, message: undefined })) });
  });

  router.get('/api/support/categories', (ctx) => ctx.json({ categories: CATEGORIES }));
  router.get('/api/support/contact', (ctx) => ctx.json({ email: config.admin.email }));
}

export { CATEGORIES };
