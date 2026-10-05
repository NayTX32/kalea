/** KALEA — sessions, authentification et contrôle des rôles. */
import { config } from '../config.js';
import { get, run, now, newId } from '../db.js';
import { randomToken, sha256 } from '../lib/crypto.js';
import { unauthorized, forbidden } from '../lib/errors.js';

const COOKIE = config.session.cookieName;

/** Charge la session et l'utilisateur associés (sans exiger d'authentification). */
export function loadSession(ctx, next) {
  const raw = ctx.cookies[COOKIE];
  if (raw) {
    const id = sha256(raw);
    const session = get(
      'SELECT * FROM sessions WHERE id = ? AND expires_at > ?',
      id, now(),
    );
    if (session) {
      ctx.session = session;
      const user = get('SELECT * FROM users WHERE id = ?', session.user_id);
      if (user && user.status === 'active') {
        ctx.user = toPublicUser(user);
        ctx.userRow = user;
      } else if (user) {
        ctx.user = null;
        ctx.userRow = null;
        destroySessionRow(session.id);
        ctx.clearCookie(COOKIE, { httpOnly: true, sameSite: 'Lax', secure: config.isProd });
      }
      // Last seen : au plus toutes les 60 s.
      if (now() - session.last_seen_at > 60_000) {
        run('UPDATE sessions SET last_seen_at = ? WHERE id = ?', now(), session.id);
      }
    }
  }
  return next();
}

export function destroySessionRow(sessionRowId) {
  run('DELETE FROM sessions WHERE id = ?', sessionRowId);
}

/** Crée une session et pose les cookies (sid httpOnly + CSRF lisible). */
export function createSession(ctx, user, { ip, userAgent } = {}) {
  const raw = randomToken(32);
  const id = sha256(raw);
  const csrf = randomToken(24);
  const ts = now();
  run(
    `INSERT INTO sessions (id, user_id, csrf_token, ip, user_agent, created_at, last_seen_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    id, user.id, csrf, ip ?? ctx.ip, (userAgent ?? '').slice(0, 300), ts, ts, ts + config.session.ttlMs,
  );
  const maxAge = Math.floor(config.session.ttlMs / 1000);
  ctx.setCookie(COOKIE, raw, { httpOnly: true, sameSite: 'Lax', secure: config.isProd, maxAge });
  ctx.setCookie(config.session.csrfCookie, csrf, { httpOnly: false, sameSite: 'Lax', secure: config.isProd, maxAge });
  ctx.cookies[config.session.csrfCookie] = csrf;
  ctx.session = { id, user_id: user.id, csrf_token: csrf, created_at: ts };
  return ctx.session;
}

export function destroySession(ctx) {
  if (ctx.session) destroySessionRow(ctx.session.id);
  ctx.clearCookie(COOKIE, { httpOnly: true, sameSite: 'Lax', secure: config.isProd });
  // Le cookie CSRF est conservé : il est renouvelé à la prochaine connexion
  // (createSession) et permet de se reconnecter sans recharger la page.
  ctx.session = null;
  ctx.user = null;
}

/** Supprime les sessions expirées (appelé périodiquement). */
export function pruneSessions() {
  run('DELETE FROM sessions WHERE expires_at < ?', now());
}

/* --------------------------- Gardes de route --------------------------- */

export function requireAuth(ctx, next) {
  if (!ctx.user) throw unauthorized('Vous devez être connecté pour effectuer cette action.');
  return next();
}

export function requireAdmin(ctx, next) {
  if (!ctx.user) throw unauthorized('Vous devez être connecté.');
  if (ctx.userRow?.role !== 'admin') throw forbidden('Accès réservé aux administrateurs.');
  return next();
}

/** Format public d'un utilisateur (aucune donnée sensible). */
export function toPublicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    displayName: user.display_name,
    role: user.role,
    status: user.status,
    avatar: user.discord_avatar ?? null,
    discord: user.discord_id
      ? { id: user.discord_id, username: user.discord_username ?? null, linked: true }
      : { id: null, username: null, linked: false },
    gamePlayerId: user.game_player_id ?? null,
    createdAt: user.created_at,
    lastLoginAt: user.last_login_at ?? null,
  };
}
