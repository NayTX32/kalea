/**
 * KALEA — API sécurisée destinée au serveur du jeu.
 *
 * Authentification : signature HMAC-SHA256 (partagée via GAME_API_KEY).
 *   X-Kalea-Timestamp : millisecondes
 *   X-Kalea-Signature : hex(HMAC_SHA256(GAME_API_KEY, `${ts}.${body}`))
 *
 * Toutes les réponses sont en lecture seule : le jeu consomme les droits
 * accordés, il ne peut pas fabriquer d'achat.
 */
import { all, get, parseJson } from '../db.js';
import { notFound, unauthorized } from '../lib/errors.js';
import { verifyInbound } from '../services/gameapi.js';
import { config } from '../config.js';

function requireGameSignature(ctx) {
  const ts = ctx.get('x-kalea-timestamp');
  const sig = ctx.get('x-kalea-signature');
  const check = verifyInbound(ctx.rawBody ?? '', ts, sig);
  if (!check.ok) throw unauthorized(`Signature API jeu invalide (${check.reason}).`);
}

export function gameRoutes(router) {
  /**
   * GET /api/game/v1/entitlements/:playerId
   * Retourne les packs, permissions, fonctionnalités et récompenses du joueur.
   * (Signature vérifiée sur un corps vide : on signe le chemin de la requête.)
   */
  router.get('/api/game/v1/entitlements/:playerId', (ctx) => {
    const check = verifyInbound(ctx.path, ctx.get('x-kalea-timestamp'), ctx.get('x-kalea-signature'));
    if (!check.ok) throw unauthorized(`Signature API jeu invalide (${check.reason}).`);
    const playerId = ctx.params.playerId;
    const user = get('SELECT * FROM users WHERE game_player_id = ? OR discord_id = ?', playerId, playerId)
      ?? get('SELECT * FROM users WHERE id = ?', playerId);
    if (!user) throw notFound('Joueur introuvable.');

    const packs = all(
      `SELECT up.*, p.name, p.slug, p.emoji, p.features, p.game_rewards, p.discord_role_name
       FROM user_packs up JOIN packs p ON p.id = up.pack_id
       WHERE up.user_id = ? AND up.active = 1`,
      user.id,
    ).map((row) => ({
      packId: row.pack_id,
      slug: row.slug,
      name: row.name,
      grantedAt: row.granted_at,
      orderId: row.order_id,
      rewards: parseJson(row.game_rewards, {}) ?? {},
      features: parseJson(row.features, []) ?? [],
    }));

    const grants = all(
      `SELECT kind, key, label, value, status, tx_id, created_at
       FROM grants WHERE user_id = ? AND status = 'granted'`,
      user.id,
    );

    const merged = {
      skins: [], items: [], permissions: [], features: [], currency: {},
    };
    for (const pack of packs) {
      const r = pack.rewards ?? {};
      merged.skins.push(...(r.skins ?? []));
      merged.items.push(...(r.items ?? []));
      merged.permissions.push(...(r.permissions ?? []));
      merged.features.push(...(r.features ?? []));
      if (r.currency) {
        merged.currency[r.currency.type] = (merged.currency[r.currency.type] ?? 0) + r.currency.amount;
      }
      if (r.profile) merged.profile = { ...(merged.profile ?? {}), ...r.profile };
    }

    return ctx.json({
      player: {
        id: user.game_player_id ?? user.id,
        kaleaUserId: user.id,
        displayName: user.display_name,
        discordId: user.discord_id,
      },
      activePacks: packs,
      grants,
      entitlements: merged,
      generatedAt: Date.now(),
      apiVersion: 'v1',
    });
  });

  /** Ping d'authentification (le jeu vérifie sa signature). */
  router.get('/api/game/v1/ping', (ctx) => {
    const check = verifyInbound(ctx.path, ctx.get('x-kalea-timestamp'), ctx.get('x-kalea-signature'));
    if (!check.ok) throw unauthorized(`Signature API jeu invalide (${check.reason}).`);
    return ctx.json({ ok: true, service: 'kalea', inbound: config.game.inboundConfigured });
  });
}
