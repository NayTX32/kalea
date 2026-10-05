/**
 * KALEA — primitives crypto : mots de passe (scrypt), jetsons signés (HMAC),
 * comparaison à temps constant et générateurs d'identifiants.
 */
import crypto from 'node:crypto';

const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, keylen: 64 };

/** Hachage de mot de passe au format : scrypt$N$r$p$salt$hash */
export function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 8) {
    const err = new Error('Le mot de passe doit contenir au moins 8 caractères.');
    err.code = 'WEAK_PASSWORD';
    throw err;
  }
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(password.normalize('NFKC'), salt, SCRYPT_PARAMS.keylen, {
    N: SCRYPT_PARAMS.N, r: SCRYPT_PARAMS.r, p: SCRYPT_PARAMS.p,
    maxmem: 64 * 1024 * 1024,
  });
  return ['scrypt', SCRYPT_PARAMS.N, SCRYPT_PARAMS.r, SCRYPT_PARAMS.p,
    salt.toString('base64'), derived.toString('base64')].join('$');
}

export function verifyPassword(password, stored) {
  try {
    if (!stored) return false;
    const [scheme, N, r, p, saltB64, hashB64] = stored.split('$');
    if (scheme !== 'scrypt') return false;
    const expected = Buffer.from(hashB64, 'base64');
    const derived = crypto.scryptSync(
      String(password).normalize('NFKC'),
      Buffer.from(saltB64, 'base64'),
      expected.length,
      { N: Number(N), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024 },
    );
    return crypto.timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

/** Jeton opaque aléatoire (session). */
export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

/** Empreinte SHA-256 hex (stockage des jetons de session en base). */
export function sha256(input) {
  return crypto.createHash('sha256').update(String(input)).digest('hex');
}

export function hmacHex(secret, payload) {
  return crypto.createHmac('sha256', String(secret)).update(String(payload)).digest('hex');
}

export function hmacBase64(secret, payload) {
  return crypto.createHmac('sha256', String(secret)).update(String(payload)).digest('base64');
}

export const timingSafeEqual = (a, b) => {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
};

/** Signature façon Stripe : `t=<ms>,v1=<hmac>` sur `${t}.${rawBody}`. */
export function signPayload(secret, rawBody, timestamp = Date.now()) {
  const signed = `${timestamp}.${rawBody}`;
  return `t=${timestamp},v1=${hmacHex(secret, signed)}`;
}

/** Vérifie une signature `t=…,v1=…` avec fenêtre de tolérance (anti replay). */
export function verifySignedPayload(secret, rawBody, header, toleranceMs = 5 * 60 * 1000) {
  if (!header || typeof header !== 'string') return { ok: false, reason: 'signature_absente' };
  const parts = Object.create(null);
  for (const chunk of header.split(',')) {
    const [k, v] = chunk.split('=');
    if (k && v) parts[k.trim()] = v.trim();
  }
  const timestamp = Number(parts.t);
  const signature = parts.v1;
  if (!Number.isFinite(timestamp) || !signature) return { ok: false, reason: 'signature_invalide' };
  if (Math.abs(Date.now() - timestamp) > toleranceMs) return { ok: false, reason: 'signature_expiree' };
  const expected = hmacHex(secret, `${timestamp}.${rawBody}`);
  return timingSafeEqual(expected, signature)
    ? { ok: true, timestamp }
    : { ok: false, reason: 'signature_invalide' };
}
