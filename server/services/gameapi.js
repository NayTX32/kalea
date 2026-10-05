/**
 * KALEA — client de l'API du jeu.
 *
 * Toutes les requêtes sortantes sont signées HMAC-SHA256 :
 *   X-Kalea-Timestamp : millisecondes
 *   X-Kalea-Signature : hex( HMAC_SHA256(secret, `${ts}.${body}`) )
 *   X-Kalea-Tx        : identifiant unique de transaction (anti double attribution)
 *   X-Kalea-Idem      : clé d'idempotence (le jeu doit rejeter les doublons)
 *
 * Le jeu rejoue-t-il la même transaction ? Il répond 200 avec "alreadyApplied".
 */
import { config } from '../config.js';
import { hmacHex, timingSafeEqual } from '../lib/crypto.js';
import { log } from '../lib/logger.js';

const TIMEOUT_MS = 10_000;

export function signBody(rawBody, timestamp = Date.now()) {
  return { timestamp, signature: hmacHex(config.game.secret || 'kalea', `${timestamp}.${rawBody}`) };
}

export const gameStatus = () => ({
  configured: config.game.outboundConfigured,
  url: config.game.url || null,
  required: config.game.required,
  inbound: config.game.inboundConfigured,
});

/** Requête signée vers l'API du jeu. */
export async function callGame(path, payload, { method = 'POST', txId = null } = {}) {
  if (!config.game.outboundConfigured) {
    return { ok: true, skipped: true, reason: 'api_jeu_non_configuree' };
  }
  const body = JSON.stringify(payload ?? {});
  const { timestamp, signature } = signBody(body);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${config.game.url}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Kalea-Timestamp': String(timestamp),
        'X-Kalea-Signature': signature,
        'X-Kalea-Tx': txId ?? '',
        'X-Kalea-Idem': payload?.idempotencyKey ?? txId ?? '',
        'User-Agent': 'Kalea/1.0 (+boutique-officielle)',
      },
      body: method === 'GET' ? undefined : body,
      signal: controller.signal,
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!res.ok) {
      return { ok: false, status: res.status, error: data?.error ?? data?.message ?? `HTTP ${res.status}`, data };
    }
    return { ok: true, status: res.status, data };
  } catch (error) {
    const message = error.name === 'AbortError' ? 'Délai dépassé (API du jeu injoignable)' : error.message;
    log.warn('game_api_unreachable', { url: config.game.url, error: message });
    return { ok: false, error: message };
  } finally {
    clearTimeout(timer);
  }
}

/** Accorde les récompenses d'un pack au joueur (une seule fois par transaction). */
export async function grantRewards({ order, user, pack, txId, rewards }) {
  return callGame('/v1/rewards/grant', {
    transactionId: txId,
    idempotencyKey: `${txId}:grant`,
    order: { id: order.id, number: order.order_number, paidAt: order.paid_at },
    player: { id: user.game_player_id ?? null, discordId: user.discord_id ?? null, displayName: user.display_name },
    pack: { id: pack.id, slug: pack.slug, name: pack.name },
    rewards: rewards ?? {},
    grantedAt: Date.now(),
  }, { txId });
}

/** Retire les récompenses après remboursement. */
export async function revokeRewards({ order, user, pack, txId, rewards }) {
  return callGame('/v1/rewards/revoke', {
    transactionId: `${txId}:revoke`,
    idempotencyKey: `${txId}:revoke`,
    order: { id: order.id, number: order.order_number },
    player: { id: user.game_player_id ?? null, discordId: user.discord_id ?? null },
    pack: { id: pack.id, slug: pack.slug, name: pack.name },
    rewards: rewards ?? {},
    revokedAt: Date.now(),
  }, { txId });
}

/** Vérifie une signature entrante (requêtes du jeu vers KALEA). */
export function verifyInbound(rawBody, timestampHeader, signatureHeader) {
  if (!config.game.inboundConfigured) return { ok: false, reason: 'api_key_non_configuree' };
  const ts = Number(timestampHeader);
  if (!Number.isFinite(ts)) return { ok: false, reason: 'timestamp_invalide' };
  if (Math.abs(Date.now() - ts) > 5 * 60_000) return { ok: false, reason: 'timestamp_expire' };
  const expected = hmacHex(config.game.apiKey, `${ts}.${rawBody}`);
  return timingSafeEqual(expected, String(signatureHeader ?? ''))
    ? { ok: true }
    : { ok: false, reason: 'signature_invalide' };
}
