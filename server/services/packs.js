/** KALEA — catalogue de packs (CRUD admin + lecture publique). */
import { all, get, run, newId, now, parseJson, toRow } from '../db.js';
import { badRequest, notFound, conflict } from '../lib/errors.js';
import { str, int, bool, slugify, sanitizeRewards } from '../lib/validate.js';

export const DEFAULT_FEATURES_BY_SLUG = {
  base: ['Lancement du jeu plus rapide', 'Changement de pseudo', 'Rôle Discord Pack de Base'],
  'full-locker': ['Accès complet au locker', 'Skins premium inclus', 'Objets exclusifs', 'Rôle Discord Full Locker'],
  moder: ['Rôle Discord Moder', 'Permissions de modération en jeu', 'Outils de gestion', 'Avantages exclusifs'],
};

/** Transforme une ligne SQL en objet public (prix en euros, JSON parsés). */
export function serializePack(row, { publicView = true } = {}) {
  if (!row) return null;
  const rewards = parseJson(row.game_rewards, {}) ?? {};
  const pack = {
    id: row.id,
    slug: row.slug,
    name: row.name,
    emoji: row.emoji,
    tagline: row.tagline,
    description: row.description,
    imageUrl: row.image_url,
    priceCents: row.price_cents,
    price: (row.price_cents / 100).toFixed(2).replace('.', ','),
    priceNumber: row.price_cents / 100,
    currency: row.currency,
    badge: row.badge,
    features: parseJson(row.features, []) ?? [],
    discordRole: {
      id: row.discord_role_id || null,
      name: row.discord_role_name || null,
      configured: Boolean(row.discord_role_id),
    },
    rewards,
    rewardSummary: summarizeRewards(rewards),
    active: row.active === 1,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (publicView) {
    delete pack.discordRole.id;
    delete pack.rewards;
  }
  return pack;
}

export function summarizeRewards(rewards = {}) {
  const parts = [];
  const label = (v) => (typeof v === 'string' ? v : v?.name ?? v?.id ?? '');
  for (const skin of rewards.skins ?? []) parts.push(`Skin : ${label(skin)}`);
  for (const item of rewards.items ?? []) parts.push(`Objet : ${label(item)}`);
  if (rewards.currency) parts.push(`${rewards.currency.amount} ${rewards.currency.type}`);
  for (const p of rewards.permissions ?? []) parts.push(`Permission : ${label(p)}`);
  for (const f of rewards.features ?? []) parts.push(`Fonctionnalité : ${label(f)}`);
  return parts;
}

export function listPacks({ includeInactive = false } = {}) {
  const rows = includeInactive
    ? all('SELECT * FROM packs ORDER BY sort_order ASC, created_at ASC')
    : all('SELECT * FROM packs WHERE active = 1 ORDER BY sort_order ASC, created_at ASC');
  return rows.map((r) => serializePack(r, { publicView: !includeInactive }));
}

export function getPackRow(idOrSlug) {
  return get('SELECT * FROM packs WHERE id = ? OR slug = ?', idOrSlug, idOrSlug);
}

export function getPack(idOrSlug, { includeInactive = false } = {}) {
  const row = getPackRow(idOrSlug);
  if (!row) throw notFound('Pack introuvable.');
  if (!includeInactive && row.active !== 1) throw notFound('Pack indisponible.');
  return row;
}

/** Valide et normalise le payload d'un pack (création / modification). */
export function sanitizePackInput(body, { existing = null } = {}) {
  const name = str(body.name, { field: 'nom', min: 2, max: 80 });
  const slug = str(body.slug ?? slugify(name), { field: 'slug', min: 2, max: 60 });
  if (!/^[a-z0-9-]+$/.test(slug)) throw badRequest('Le slug ne peut contenir que des lettres minuscules, chiffres et tirets.');
  const duplicate = get('SELECT id FROM packs WHERE slug = ?', slug);
  if (duplicate && duplicate.id !== existing?.id) throw conflict('Ce slug est déjà utilisé.', 'duplicate_slug');

  const priceCents = int(body.priceCents ?? Math.round(Number(body.price) * 100), {
    field: 'prix', min: 0, max: 10_000_000,
  });
  const features = (Array.isArray(body.features) ? body.features : [])
    .map((f) => String(f).trim())
    .filter(Boolean)
    .slice(0, 30);

  return {
    slug,
    name,
    emoji: str(body.emoji ?? '🎁', { field: 'emoji', min: 1, max: 8, required: false }) || '🎁',
    tagline: str(body.tagline ?? '', { field: 'accroche', max: 140, required: false }),
    description: str(body.description ?? '', { field: 'description', max: 2000, required: false }),
    imageUrl: str(body.imageUrl ?? '', { field: 'image', max: 400, required: false }),
    price_cents: priceCents,
    currency: 'EUR',
    badge: str(body.badge ?? '', { field: 'badge', max: 30, required: false }),
    features: toRow(features),
    discord_role_id: str(body.discordRoleId ?? '', { field: 'identifiant de rôle Discord', max: 40, required: false }),
    discord_role_name: str(body.discordRoleName ?? '', { field: 'nom du rôle Discord', max: 80, required: false }),
    game_rewards: toRow(sanitizeRewards(body.rewards)),
    active: bool(body.active, true) ? 1 : 0,
    sort_order: int(body.sortOrder ?? 0, { field: 'ordre', min: -1000, max: 1000, fallback: 0 }),
    updated_at: now(),
  };
}

export function createPack(body) {
  const data = sanitizePackInput(body);
  const id = newId('pack');
  run(
    `INSERT INTO packs (id, slug, name, emoji, tagline, description, image_url, price_cents, currency,
       badge, features, discord_role_id, discord_role_name, game_rewards, active, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, data.slug, data.name, data.emoji, data.tagline, data.description, data.imageUrl,
    data.price_cents, data.currency, data.badge, data.features, data.discord_role_id,
    data.discord_role_name, data.game_rewards, data.active, data.sort_order, now(), data.updated_at,
  );
  return serializePack(getPack(id, { includeInactive: true }), { publicView: false });
}

export function updatePack(id, body) {
  const existing = getPack(id, { includeInactive: true });
  const data = sanitizePackInput({ ...serializePack(existing, { publicView: false }), ...body }, { existing });
  run(
    `UPDATE packs SET slug=?, name=?, emoji=?, tagline=?, description=?, image_url=?, price_cents=?,
       badge=?, features=?, discord_role_id=?, discord_role_name=?, game_rewards=?, active=?, sort_order=?, updated_at=?
     WHERE id = ?`,
    data.slug, data.name, data.emoji, data.tagline, data.description, data.imageUrl, data.price_cents,
    data.badge, data.features, data.discord_role_id, data.discord_role_name, data.game_rewards,
    data.active, data.sort_order, data.updated_at, existing.id,
  );
  return serializePack(getPack(existing.id, { includeInactive: true }), { publicView: false });
}

export function deletePack(id) {
  const existing = getPack(id, { includeInactive: true });
  const used = get('SELECT id FROM orders WHERE pack_id = ? LIMIT 1', existing.id);
  if (used) {
    // Un pack commandé n'est jamais supprimé : on le désactive pour préserver l'historique.
    run('UPDATE packs SET active = 0, updated_at = ? WHERE id = ?', now(), existing.id);
    return { deactivated: true, id: existing.id };
  }
  run('DELETE FROM packs WHERE id = ?', existing.id);
  return { deleted: true, id: existing.id };
}
