/** KALEA — en-têtes de sécurité, cookies et protection CSRF. */
import { config } from '../config.js';
import { forbidden } from '../lib/errors.js';
import { timingSafeEqual, randomToken } from '../lib/crypto.js';

const CSRF_COOKIE = config.session.csrfCookie;

const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self' data:",
  "connect-src 'self'",
].join('; ');

/** En-têtes appliqués à toutes les réponses (site + API). */
export function securityHeaders(ctx) {
  ctx.set('X-Content-Type-Options', 'nosniff');
  ctx.set('X-Frame-Options', 'DENY');
  ctx.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  ctx.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  ctx.set('Cross-Origin-Opener-Policy', 'same-origin');
  ctx.set('X-DNS-Prefetch-Control', 'off');
  if (ctx.path.startsWith('/api/')) ctx.set('Cache-Control', 'no-store');
  if (config.isProd) ctx.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  if (!ctx.path.startsWith('/api/')) ctx.set('Content-Security-Policy', CSP);
  if (process.env.NODE_ENV !== 'production') ctx.set('Cache-Control', 'no-store');
}

/** Garantit l'existence du jeton CSRF (cookie lisible par le JS). */
export function ensureCsrfCookie(ctx, next) {
  let token = ctx.cookies[CSRF_COOKIE];
  if (!token || token.length < 20) {
    token = randomToken(24);
    ctx.setCookie(CSRF_COOKIE, token, {
      httpOnly: false,
      sameSite: 'Lax',
      secure: config.isProd,
      maxAge: Math.floor(config.session.ttlMs / 1000),
    });
    ctx.cookies[CSRF_COOKIE] = token;
  }
  return next();
}

const EXEMPT = ['/api/webhooks/', '/api/game/'];
const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'];

/** Double-submit CSRF : exigé sur toute écriture API. */
export function csrfGuard(ctx, next) {
  if (SAFE_METHODS.includes(ctx.method)) return next();
  if (!ctx.path.startsWith('/api/')) return next();
  if (EXEMPT.some((prefix) => ctx.path.startsWith(prefix))) return next();

  const cookie = ctx.cookies[CSRF_COOKIE];
  const header = ctx.get('x-csrf-token');
  if (!cookie || !header || !timingSafeEqual(cookie, header)) {
    throw forbidden('Jeton de sécurité (CSRF) manquant ou invalide. Rechargez la page.');
  }
  if (ctx.session && ctx.session.csrf_token && !timingSafeEqual(ctx.session.csrf_token, header)) {
    throw forbidden('Jeton de sécurité (CSRF) obsolète. Rechargez la page.');
  }
  return next();
}
