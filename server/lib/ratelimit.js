/** KALEA — rate limiting en mémoire (fenêtre glissante, par IP + classe). */
import { config } from '../config.js';
import { tooMany } from './errors.js';

const buckets = new Map(); // key -> [timestamps]
let lastSweep = Date.now();
const WINDOW_MS = 60_000;

function sweep() {
  const nowTs = Date.now();
  if (nowTs - lastSweep < 30_000) return;
  lastSweep = nowTs;
  for (const [key, hits] of buckets) {
    const kept = hits.filter((t) => nowTs - t < WINDOW_MS);
    if (kept.length === 0) buckets.delete(key);
    else buckets.set(key, kept);
  }
}

/**
 * Limiteur : max requêtes / minute par clé.
 * @param {string} bucket nom de la classe ("auth", "api", "webhook"…)
 * @param {number} max    nombre max de requêtes par fenêtre
 */
export function rateLimit(bucket, max = config.security.rateLimitApi) {
  return async (ctx, next) => {
    if (!config.security.rateLimitEnabled) return next();
    sweep();
    const key = `${bucket}:${ctx.ip}`;
    const nowTs = Date.now();
    const hits = (buckets.get(key) ?? []).filter((t) => nowTs - t < WINDOW_MS);
    if (hits.length >= max) {
      const retry = Math.ceil((WINDOW_MS - (nowTs - hits[0])) / 1000);
      ctx.set('Retry-After', String(retry));
      throw tooMany(`Trop de requêtes. Réessayez dans ${retry} seconde${retry > 1 ? 's' : ''}.`);
    }
    hits.push(nowTs);
    buckets.set(key, hits);
    return next();
  };
}

export function resetRateLimits() {
  buckets.clear();
}
