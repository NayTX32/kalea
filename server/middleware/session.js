/** KALEA — sessions, authentification et contrôle des rôles. */
import { config } from '../config.js';
import { get, run, now, newId } from '../db.js';
import { randomToken, sha256 } from '../lib/crypto.js';
import { unauthorized, forbidden } from '../lib/errors.js';
import { audit, log } from '../lib/logger.js';
import { syncDiscordRole } from '../services/roles.js';

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

/**
 * Revalide côté serveur le rôle Discord du compte connecté (contrôle de
 * fréquence : une vérification toutes les ROLE_REVALIDATE_MS au maximum).
 * Le contexte de requête est rafraîchi si le rôle a changé.
 * Une panne Discord ne modifie jamais un rôle.
 */
async function refreshDiscordRole(ctx) {
  const row = ctx.userRow;
  if (!row) return;

  if (!row.discord_id) {
    // Lien Discord perdu mais rôle dérivé de Discord → retrait immédiat.
    if (row.role === 'admin' && row.role_source === 'discord') {
      run(
        `UPDATE users SET role = 'user', role_source = 'manual', discord_founder = 0,
           discord_checked_at = NULL, updated_at = ? WHERE id = ?`,
        now(), row.id,
      );
      applyFreshUser(ctx, row.id);
      audit('role.revoked', { actor: ctx.user, target: row.id, ip: ctx.ip, meta: { reason: 'discord_unlinked' } });
      log.info('role_revoked', { userId: row.id, reason: 'discord_unlinked' });
    }
    return;
  }

  let result;
  try {
    result = await syncDiscordRole(row, { reason: 'route_guard' });
  } catch (error) {
    log.warn('role_guard_failed', { userId: row.id, error: error.message });
    return;
  }
  if (result.action === 'promote' || result.action === 'demote') applyFreshUser(ctx, row.id);
}

function applyFreshUser(ctx, userId) {
  const fresh = get('SELECT * FROM users WHERE id = ?', userId);
  if (!fresh) return;
  ctx.userRow = fresh;
  ctx.user = toPublicUser(fresh);
}

/**
 * Accès administration : session valide + rôle admin + rôle Discord encore
 * valable (« Fondateur »). Une seule route admin suffit pour détecter la perte
 * du rôle Discord et rétrograder le compte.
 */
export async function requireAdmin(ctx, next) {
  if (!ctx.user) throw unauthorized('Vous devez être connecté.');
  if (ctx.userRow?.role !== 'admin') throw forbidden('Accès réservé aux administrateurs.');

  await refreshDiscordRole(ctx);
  if (ctx.userRow?.role !== 'admin') {
    throw forbidden('Vos privilèges administrateur ont été retirés : votre compte ne possède plus le rôle Discord Fondateur.');
  }
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
    // Provenance du rôle (« discord » = accordé puis revalidé par le serveur
    // après vérification du rôle Fondateur ; « manual » = jamais rétrogradé).
    roleSource: user.role_source ?? 'manual',
    discordFounder: user.discord_founder === 1,
    discordCheckedAt: user.discord_checked_at ?? null,
    discord: user.discord_id
      ? { id: user.discord_id, username: user.discord_username ?? null, linked: true }
      : { id: null, username: null, linked: false },
    gamePlayerId: user.game_player_id ?? null,
    createdAt: user.created_at,
    lastLoginAt: user.last_login_at ?? null,
  };
}
