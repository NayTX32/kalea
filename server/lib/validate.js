/** KALEA — validation côté serveur (aucune confiance au client). */
import { badRequest } from './errors.js';

const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(String(v).trim());

export function assertObject(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw badRequest('Corps de requête invalide.');
  }
  return body;
}

export const str = (value, { min = 0, max = 1000, field = 'champ', required = true, trim = true } = {}) => {
  if (value === undefined || value === null || value === '') {
    if (required) throw badRequest(`Le champ « ${field} » est obligatoire.`);
    return '';
  }
  if (typeof value !== 'string') throw badRequest(`Le champ « ${field} » doit être du texte.`);
  const v = trim ? value.trim() : value;
  if (required && v.length < min) {
    throw badRequest(`Le champ « ${field} » doit contenir au moins ${min} caractère${min > 1 ? 's' : ''}.`);
  }
  if (v.length > max) throw badRequest(`Le champ « ${field} » est trop long (max ${max}).`);
  return v;
};

export const email = (value, opts = {}) => {
  const v = str(value, { ...opts, field: opts.field ?? 'e-mail', max: 254 });
  if (!isEmail(v)) throw badRequest('Adresse e-mail invalide.');
  return v.toLowerCase();
};

export const password = (value) => {
  const v = str(value, { field: 'mot de passe', min: 8, max: 200 });
  if (!/[a-zA-Z]/.test(v) || !/[0-9]/.test(v)) {
    throw badRequest('Le mot de passe doit contenir au moins une lettre et un chiffre.');
  }
  return v;
};

export const int = (value, { min = 0, max = Number.MAX_SAFE_INTEGER, field = 'champ', fallback = null } = {}) => {
  if (value === undefined || value === null || value === '') {
    if (fallback !== null) return fallback;
    throw badRequest(`Le champ « ${field} » est obligatoire.`);
  }
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n)) throw badRequest(`Le champ « ${field} » doit être un entier.`);
  if (n < min || n > max) throw badRequest(`Le champ « ${field} » hors plage autorisée (${min}–${max}).`);
  return n;
};

export const bool = (value, fallback = false) => {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  return /^(1|true|yes|on)$/i.test(String(value));
};

export const pick = (obj, keys) => Object.fromEntries(keys.map((k) => [k, obj?.[k]]));

export const slugify = (value) =>
  String(value)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'pack';

/** Valide un objet JSON de récompenses de jeu. */
export function sanitizeRewards(input) {
  const src = input && typeof input === 'object' ? input : {};
  const list = (value) =>
    (Array.isArray(value) ? value : [])
      .filter((v) => typeof v === 'string' || (v && typeof v === 'object'))
      .slice(0, 100);
  const out = {
    skins: list(src.skins),
    items: list(src.items),
    currency: null,
    permissions: list(src.permissions),
    features: list(src.features),
  };
  if (src.currency && typeof src.currency === 'object') {
    const amount = Number(src.currency.amount);
    if (Number.isFinite(amount) && amount > 0) {
      out.currency = {
        type: str(src.currency.type ?? 'coins', { field: 'monnaie', max: 40 }) || 'coins',
        amount: Math.min(Math.floor(amount), 1_000_000_000),
      };
    }
  }
  if (src.profile && typeof src.profile === 'object') {
    out.profile = Object.fromEntries(
      Object.entries(src.profile)
        .filter(([, v]) => typeof v === 'string' || typeof v === 'number')
        .slice(0, 20)
        .map(([k, v]) => [k, String(v).slice(0, 200)]),
    );
  }
  // Retire les clés vides pour garder un payload propre côté jeu.
  for (const key of Object.keys(out)) {
    if (out[key] === null || (Array.isArray(out[key]) && out[key].length === 0)) delete out[key];
  }
  return out;
}
