/** KALEA — authentification (e-mail/mot de passe) et connexion Discord OAuth2. */
import crypto from 'node:crypto';
import { get, run, newId, now } from '../db.js';
import { config } from '../config.js';
import { hashPassword, verifyPassword, randomToken } from '../lib/crypto.js';
import { badRequest, conflict, unauthorized, notFound } from '../lib/errors.js';
import { assertObject, email as vEmail, password as vPassword, str } from '../lib/validate.js';
import { rateLimit } from '../lib/ratelimit.js';
import { audit, log } from '../lib/logger.js';
import { createSession, destroySession, requireAuth, toPublicUser } from '../middleware/session.js';
import { buildAuthorizeUrl, exchangeCode, fetchCurrentUser, fetchGuildMember } from '../services/discord.js';
import { backfillUserEntitlements } from '../services/fulfillment.js';

export function authRoutes(router) {
  /* ------------------------------ Inscription ------------------------------ */
  router.post('/api/auth/register', rateLimit('auth', config.security.rateLimitAuth), (ctx) => {
    const body = assertObject(ctx.body);
    const email = vEmail(body.email);
    const pass = vPassword(body.password);
    const displayName = str(body.displayName ?? body.name ?? email.split('@')[0], {
      field: 'pseudo', min: 3, max: 32,
    });

    if (get('SELECT id FROM users WHERE email = ?', email)) {
      throw conflict('Un compte existe déjà avec cette adresse e-mail.', 'email_taken');
    }
    const id = newId('usr');
    run(
      `INSERT INTO users (id, email, password_hash, display_name, role, status, locale, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'user', 'active', 'fr', ?, ?)`,
      id, email, hashPassword(pass), displayName, now(), now(),
    );
    const user = get('SELECT * FROM users WHERE id = ?', id);
    createSession(ctx, user);
    audit('user.registered', { actor: user, ip: ctx.ip, meta: { email } });
    log.info('user_registered', { userId: id });
    return ctx.json({ user: toPublicUser(user) }, 201);
  });

  /* ------------------------------- Connexion ------------------------------- */
  router.post('/api/auth/login', rateLimit('auth', config.security.rateLimitAuth), (ctx) => {
    const body = assertObject(ctx.body);
    const email = String(body.email ?? '').trim().toLowerCase();
    const pass = String(body.password ?? '');
    if (!email || !pass) throw badRequest('E-mail et mot de passe obligatoires.');

    const user = get('SELECT * FROM users WHERE email = ?', email);
    // Temps de réponse identique que le compte existe ou non.
    const ok = user ? verifyPassword(pass, user.password_hash) : verifyPassword(pass, 'scrypt$16384$8$1$AAAA$AAAA');
    if (!user || !ok) {
      audit('auth.login_failed', { ip: ctx.ip, meta: { email } });
      throw unauthorized('E-mail ou mot de passe incorrect.');
    }
    if (user.status !== 'active') throw unauthorized('Ce compte est désactivé.');

    if (ctx.session) destroySession(ctx);
    createSession(ctx, user);
    run('UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?', now(), now(), user.id);
    audit('auth.login', { actor: user, ip: ctx.ip });
    return ctx.json({ user: toPublicUser({ ...user, last_login_at: now() }) });
  });

  router.post('/api/auth/logout', (ctx) => {
    if (ctx.user) audit('auth.logout', { actor: ctx.userRow, ip: ctx.ip });
    destroySession(ctx);
    return ctx.json({ ok: true });
  });

  /* -------------------- Porte d'accès administration ----------------------
   * Un seul mot de passe ouvre /admin : la session récupérée est celle du
   * compte administrateur, donc toutes les API /api/admin/* restent protégées.
   * Comparaison à temps constant + limitation de débit + journal d'audit.
   */
  router.post('/api/auth/admin-unlock', rateLimit('auth', config.security.rateLimitAuth), (ctx) => {
    const body = assertObject(ctx.body);
    const password = String(body.password ?? '');
    if (!password) throw badRequest('Mot de passe obligatoire.');

    if (!safeCompare(password, config.admin.gatePassword)) {
      audit('auth.admin_unlock_failed', { ip: ctx.ip });
      log.warn('admin_unlock_failed', { ip: ctx.ip });
      throw unauthorized('Mot de passe administrateur incorrect.');
    }

    const admin = get("SELECT * FROM users WHERE role = 'admin' AND status = 'active' ORDER BY created_at LIMIT 1");
    if (!admin) throw unauthorized('Aucun compte administrateur actif.');

    if (ctx.session) destroySession(ctx);
    createSession(ctx, admin);
    run('UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?', now(), now(), admin.id);
    audit('auth.admin_unlocked', { actor: toPublicUser(admin), ip: ctx.ip });
    log.info('admin_unlocked', { userId: admin.id, ip: ctx.ip });
    return ctx.json({ user: toPublicUser(admin) });
  });

  /* -------------------------------- Profil -------------------------------- */
  router.get('/api/me', (ctx) => ctx.json({
    user: ctx.user ?? null,
    csrf: ctx.cookies[config.session.csrfCookie] ?? null,
    isAuthenticated: Boolean(ctx.user),
  }));

  /* --------------------------- Discord OAuth2 -----------------------------
   * Démarrage : ouvert aux visiteurs (connexion avec Discord) comme aux
   * comptes connectés (liaison). Sans identifiants d'application, le serveur
   * bascule sur l'écran de consentement de démonstration.
   */
  router.get('/api/auth/discord', (ctx) => {
    const returnTo = str(ctx.query.return ?? '/mon-compte', {
      field: 'redirection', max: 120, required: false,
    }) || '/mon-compte';

    if (!config.discord.oauthConfigured) {
      return ctx.redirect(`/connexion/discord?return=${encodeURIComponent(returnTo)}`);
    }
    const state = randomToken(16);
    ctx.setCookie('kalea_oauth', JSON.stringify({ state, returnTo }), {
      httpOnly: true, sameSite: 'Lax', secure: config.isProd, maxAge: 600,
    });
    return ctx.redirect(buildAuthorizeUrl({ state, redirectUri: config.discord.redirectUri }));
  });

  /** Connexion / liaison Discord — mode démonstration (pas d'application Discord). */
  router.post('/api/auth/discord/demo', rateLimit('auth', config.security.rateLimitAuth), async (ctx) => {
    if (config.discord.oauthConfigured) {
      throw badRequest('Discord OAuth2 est configuré : utilisez la vraie connexion.');
    }
    const body = assertObject(ctx.body);
    const username = str(body.username ?? 'Joueur KALEA', { field: 'pseudo', min: 2, max: 32 });
    const slug = username.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24) || 'joueur';
    // Identité Discord déterministe : le même pseudo retrouve toujours le même compte.
    const discordId = `demo_${crypto.createHash('sha256').update(slug).digest('hex').slice(0, 16)}`;

    let userRow = ctx.userRow ?? null;
    if (userRow) {
      const taken = get('SELECT id FROM users WHERE discord_id = ? AND id != ?', discordId, userRow.id);
      if (taken) throw conflict('Ce compte Discord est déjà lié à un autre compte KALEA.', 'discord_linked_elsewhere');
    } else {
      userRow = get('SELECT * FROM users WHERE discord_id = ?', discordId) ?? null;
      if (!userRow) {
        const id = newId('usr');
        const base = `discord_${slug}@discord.kalea`;
        const email = get('SELECT id FROM users WHERE email = ?', base) ? `${id.slice(-6)}_${base}` : base;
        run(
          `INSERT INTO users (id, email, password_hash, display_name, role, status, locale, created_at, updated_at)
           VALUES (?, ?, NULL, ?, 'user', 'active', 'fr', ?, ?)`,
          id, email, username, now(), now(),
        );
        userRow = get('SELECT * FROM users WHERE id = ?', id);
        audit('user.registered', { actor: toPublicUser(userRow), ip: ctx.ip, meta: { via: 'discord_demo' } });
      }
    }

    run(
      `UPDATE users SET discord_id = ?, discord_username = ?, discord_avatar = NULL,
         discord_access_token = NULL, discord_expires_at = NULL, updated_at = ? WHERE id = ?`,
      discordId, username, now(), userRow.id,
    );
    const updated = get('SELECT * FROM users WHERE id = ?', userRow.id);

    if (ctx.session) destroySession(ctx);
    createSession(ctx, updated);
    run('UPDATE users SET last_login_at = ? WHERE id = ?', now(), updated.id);

    audit('discord.linked', { actor: toPublicUser(updated), ip: ctx.ip, meta: { discordId, demo: true } });
    log.info('discord_linked', { userId: updated.id, discordId, demo: true });
    const backfill = await backfillUserEntitlements(updated.id).catch((error) => {
      log.warn('backfill_failed', { userId: updated.id, error: error.message });
      return { granted: [], errors: [error.message] };
    });

    return ctx.json({ user: toPublicUser(updated), backfill: backfill ?? null });
  });

  /**
   * Callback OAuth2 — échange le code contre un jeton, crée/lie le compte
   * puis ouvre la session. Toute anomalie redirige vers /connexion avec un
   * message français explicite (refus de l'utilisateur, secret manquant,
   * state falsifié, panne de l'API Discord…).
   */
  router.get('/api/auth/discord/callback', rateLimit('auth', config.security.rateLimitAuth), async (ctx) => {
    const fail = (message) => ctx.redirect(`/connexion?error=${encodeURIComponent(message)}`);

    const raw = ctx.cookies.kalea_oauth;
    if (!raw) return fail('La session Discord a expiré. Recommencez la connexion.');
    ctx.clearCookie('kalea_oauth', { httpOnly: true, sameSite: 'Lax', secure: config.isProd });

    let stored = null;
    try { stored = JSON.parse(raw); } catch { /* cookie corrompu */ }
    if (!stored?.state) return fail('Session Discord invalide. Recommencez la connexion.');
    if (!ctx.query.state || ctx.query.state !== stored.state) {
      return fail('Échec de la vérification de sécurité (state). Recommencez la connexion Discord.');
    }
    if (ctx.query.error) {
      return fail(ctx.query.error === 'access_denied'
        ? 'Vous avez refusé l’autorisation Discord : connexion annulée.'
        : `Discord a refusé la connexion : ${ctx.query.error_description ?? ctx.query.error}`);
    }
    if (!config.discord.oauthConfigured) {
      return fail('Connexion Discord non configurée : renseignez DISCORD_CLIENT_ID et DISCORD_CLIENT_SECRET dans le fichier .env.');
    }
    const code = String(ctx.query.code ?? '').slice(0, 400);
    if (!code) return fail('Code d’autorisation manquant. Recommencez la connexion Discord.');

    try {
      const token = await exchangeCode(code, config.discord.redirectUri);
      const me = await fetchCurrentUser(token.accessToken);
      let member = null;
      if (config.discord.guildId && token.scope.includes('guilds.members.read')) {
        member = await fetchGuildMember(token.accessToken, config.discord.guildId);
      }

      // Identification : compte connecté → liaison, sinon recherche puis création.
      let userRow = ctx.userRow ?? null;
      if (userRow) {
        const taken = get('SELECT id FROM users WHERE discord_id = ? AND id != ?', me.id, userRow.id);
        if (taken) throw conflict('Ce compte Discord est déjà lié à un autre compte KALEA.', 'discord_linked_elsewhere');
      } else {
        userRow = get('SELECT * FROM users WHERE discord_id = ?', me.id)
          ?? (me.email ? get('SELECT * FROM users WHERE email = ?', me.email) : null)
          ?? null;
        if (!userRow) {
          const id = newId('usr');
          const email = me.email ?? `discord_${me.id}@discord.kalea`;
          run(
            `INSERT INTO users (id, email, password_hash, display_name, role, status, locale, created_at, updated_at)
             VALUES (?, ?, NULL, ?, 'user', 'active', 'fr', ?, ?)`,
            id, email, (me.globalName ?? me.username).slice(0, 32), now(), now(),
          );
          userRow = get('SELECT * FROM users WHERE id = ?', id);
          audit('user.registered', { actor: toPublicUser(userRow), ip: ctx.ip, meta: { via: 'discord' } });
        }
      }

      run(
        `UPDATE users SET discord_id = ?, discord_username = ?, discord_avatar = ?,
           discord_access_token = ?, discord_expires_at = ?, updated_at = ? WHERE id = ?`,
        me.id, me.username, me.avatar, token.accessToken, Date.now() + token.expiresIn * 1000, now(), userRow.id,
      );
      const updated = get('SELECT * FROM users WHERE id = ?', userRow.id);

      if (ctx.session) destroySession(ctx);
      createSession(ctx, updated);
      run('UPDATE users SET last_login_at = ? WHERE id = ?', now(), updated.id);

      audit('discord.linked', { actor: toPublicUser(updated), ip: ctx.ip, meta: { discordId: me.id, guildMember: Boolean(member) } });
      log.info('discord_linked', { userId: updated.id, discordId: me.id, inGuild: Boolean(member) });

      // Attribue les rôles des packs déjà payés (rattrapage).
      const backfill = await backfillUserEntitlements(updated.id);

      const safeReturn = String(stored.returnTo ?? '/mon-compte');
      const target = safeReturn.startsWith('/') && !safeReturn.startsWith('//') ? safeReturn : '/mon-compte';
      return ctx.redirect(`${target}?discord=ok${backfill?.granted?.length ? '&sync=1' : ''}`);
    } catch (error) {
      const reason = error?.status && error.status < 500 && error.message
        ? error.message
        : 'Impossible de terminer la connexion Discord (secret incorrect, redirection non déclarée ou service injoignable).';
      log.warn('discord_callback_failed', { ip: ctx.ip, reason: error?.message });
      audit('discord.callback_failed', { ip: ctx.ip, meta: { reason: error?.message } });
      return fail(reason);
    }
  });

  router.post('/api/auth/discord/unlink', requireAuth, (ctx) => {
    if (!ctx.userRow?.discord_id) throw notFound('Aucun compte Discord lié.');
    run(`UPDATE users SET discord_id = NULL, discord_username = NULL, discord_avatar = NULL,
         discord_access_token = NULL, discord_expires_at = NULL, updated_at = ? WHERE id = ?`, now(), ctx.user.id);
    audit('discord.unlinked', { actor: ctx.user, ip: ctx.ip });
    return ctx.json({ ok: true });
  });

  /* ---------------------- Profil / mot de passe ---------------------- */
  router.patch('/api/account', requireAuth, (ctx) => {
    const body = assertObject(ctx.body);
    const patch = {};
    if (body.displayName !== undefined) patch.displayName = str(body.displayName, { field: 'pseudo', min: 3, max: 32 });
    if (body.gamePlayerId !== undefined) {
      patch.gamePlayerId = str(body.gamePlayerId, { field: 'identifiant de jeu', min: 2, max: 64, required: false });
    }
    if (body.email !== undefined) patch.email = vEmail(body.email);

    if (patch.email && patch.email !== ctx.user.email) {
      if (get('SELECT id FROM users WHERE email = ? AND id != ?', patch.email, ctx.user.id)) {
        throw conflict('Cette adresse e-mail est déjà utilisée.', 'email_taken');
      }
    }
    const sets = [];
    const values = [];
    if (patch.displayName !== undefined) { sets.push('display_name = ?'); values.push(patch.displayName); }
    if (patch.gamePlayerId !== undefined) { sets.push('game_player_id = ?'); values.push(patch.gamePlayerId || null); }
    if (patch.email !== undefined) { sets.push('email = ?'); values.push(patch.email); }
    if (!sets.length) throw badRequest('Aucune modification reçue.');
    sets.push('updated_at = ?');
    values.push(now(), ctx.user.id);
    run(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, ...values);

    const updated = get('SELECT * FROM users WHERE id = ?', ctx.user.id);
    audit('account.updated', { actor: toPublicUser(updated), ip: ctx.ip, meta: { fields: Object.keys(patch) } });
    // Un identifiant de jeu renseigné peut déclencher le rattrapage des récompenses.
    const backfill = patch.gamePlayerId !== undefined
      ? await_backfill(updated.id)
      : null;
    return ctx.json({ user: toPublicUser(updated), backfill });
  });

  router.post('/api/account/password', requireAuth, rateLimit('auth', config.security.rateLimitAuth), (ctx) => {
    const body = assertObject(ctx.body);
    const current = String(body.currentPassword ?? '');
    const next = vPassword(body.newPassword);
    if (!ctx.userRow.password_hash) {
      throw badRequest('Ce compte utilise la connexion Discord. Définissez un mot de passe depuis Discord ou contactez le support.');
    }
    if (!verifyPassword(current, ctx.userRow.password_hash)) throw unauthorized('Mot de passe actuel incorrect.');
    run('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?', hashPassword(next), now(), ctx.user.id);
    audit('account.password_changed', { actor: ctx.user, ip: ctx.ip });
    return ctx.json({ ok: true });
  });
}

/** Rattrapage synchrone (les appels Discord/API jeu sont asynchrones). */
function await_backfill(userId) {
  return backfillUserEntitlements(userId).catch((error) => {
    log.warn('backfill_failed', { userId, error: error.message });
    return { granted: [], errors: [error.message] };
  });
}

/** Comparaison de secrets à temps constant (hachage SHA-256 → tailles égales). */
function safeCompare(a, b) {
  const digest = (value) => crypto.createHash('sha256').update(String(value), 'utf8').digest();
  return crypto.timingSafeEqual(digest(a), digest(b));
}
