/** KALEA — catalogue de packs (CRUD admin + lecture publique). */
import { all, get, run, newId, now, parseJson, toRow } from '../db.js';
import { badRequest, notFound, conflict } from '../lib/errors.js';
import { str, int, bool, slugify, sanitizeRewards } from '../lib/validate.js';
import { resolveCategoryId } from './categories.js';

/** Stock : -1 = illimité (valeur par défaut d'un pack numérique). */
export const STOCK_UNLIMITED = -1;

export const DEFAULT_FEATURES_BY_SLUG = {
  base: ['Lancement du jeu plus rapide', 'Changement de pseudo', 'Rôle Discord Pack de Base'],
  'full-locker': ['Accès complet au locker', 'Skins premium inclus', 'Objets exclusifs', 'Rôle Discord Full Locker'],
  moder: ['Rôle Discord Moder', 'Permissions de modération en jeu', 'Outils de gestion', 'Avantages exclusifs'],
};

/** Transforme une ligne SQL en objet public (prix en euros, JSON parsés). */
export function serializePack(row, { publicView = true, category = undefined } = {}) {
  if (!row) return null;
  const rewards = parseJson(row.game_rewards, {}) ?? {};
  const stock = row.stock ?? STOCK_UNLIMITED;
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
    /** Catégorie produit (null = « Sans catégorie »). */
    categoryId: row.category_id ?? null,
    category: resolveCategory(row, category),
    /** -1 = illimité, 0 = épuisé, n>0 = n unités restantes. */
    stock,
    stockLabel: stock < 0 ? 'Illimité' : stock === 0 ? 'Épuisé' : `${stock} restant${stock > 1 ? 's' : ''}`,
    inStock: stock !== 0,
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
    delete pack.categoryId; // l'admin dispose du détail, le public du libellé
  }
  return pack;
}

/** Résout la catégorie d'un pack (jointure déjà faite, sinon requête unique). */
function resolveCategory(row, preloaded) {
  if (preloaded !== undefined) return preloaded;
  if (!row.category_id) return null;
  const cat = get('SELECT * FROM categories WHERE id = ?', row.category_id);
  if (!cat) return null;
  return { id: cat.id, slug: cat.slug, name: cat.name, emoji: cat.emoji, active: cat.active === 1 };
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

/**
 * Liste des packs. `categorySlug` filtre sur une catégorie (boutique publique) ;
 * `category` précharge la catégorie pour éviter une requête par ligne.
 */
export function listPacks({ includeInactive = false, categorySlug = null } = {}) {
  const where = [];
  const params = [];
  if (!includeInactive) where.push('p.active = 1');
  if (categorySlug) {
    where.push('c.slug = ? AND c.active = 1');
    params.push(categorySlug);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = all(
    `SELECT p.*, c.slug AS cat_slug, c.name AS cat_name, c.emoji AS cat_emoji, c.active AS cat_active
     FROM packs p LEFT JOIN categories c ON c.id = p.category_id
     ${clause}
     ORDER BY p.sort_order ASC, p.created_at ASC`,
    ...params,
  );
  return rows.map((r) => serializePack(r, {
    publicView: !includeInactive,
    category: r.cat_slug
      ? { id: r.category_id, slug: r.cat_slug, name: r.cat_name, emoji: r.cat_emoji, active: r.cat_active === 1 }
      : null,
  }));
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

  // Catégorie : la clé `categoryId` (présente même à null) fait foi ; sinon
  // on retombe sur l'objet `category` déjà sérialisé (mise à jour partielle).
  let categoryRef = null;
  if (Object.prototype.hasOwnProperty.call(body, 'categoryId')) {
    categoryRef = body.categoryId;
  } else if (body.category && typeof body.category === 'object') {
    categoryRef = body.category.id ?? null;
  } else {
    categoryRef = body.category ?? null;
  }
  const categoryId = resolveCategoryId(categoryRef);

  // Stock : -1 = illimité, 0 = épuisé, sinon nombre d'unités restantes.
  const stock = int(body.stock ?? STOCK_UNLIMITED, {
    field: 'stock', min: -1, max: 10_000_000, fallback: STOCK_UNLIMITED,
  });

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
    category_id: categoryId,
    stock,
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
       badge, features, category_id, stock, discord_role_id, discord_role_name, game_rewards,
       active, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, data.slug, data.name, data.emoji, data.tagline, data.description, data.imageUrl,
    data.price_cents, data.currency, data.badge, data.features, data.category_id, data.stock,
    data.discord_role_id, data.discord_role_name, data.game_rewards, data.active, data.sort_order,
    now(), data.updated_at,
  );
  return serializePack(getPack(id, { includeInactive: true }), { publicView: false });
}

export function updatePack(id, body) {
  const existing = getPack(id, { includeInactive: true });
  const data = sanitizePackInput({ ...serializePack(existing, { publicView: false }), ...body }, { existing });
  run(
    `UPDATE packs SET slug=?, name=?, emoji=?, tagline=?, description=?, image_url=?, price_cents=?,
       badge=?, features=?, category_id=?, stock=?, discord_role_id=?, discord_role_name=?,
       game_rewards=?, active=?, sort_order=?, updated_at=?
     WHERE id = ?`,
    data.slug, data.name, data.emoji, data.tagline, data.description, data.imageUrl, data.price_cents,
    data.badge, data.features, data.category_id, data.stock, data.discord_role_id, data.discord_role_name,
    data.game_rewards, data.active, data.sort_order, data.updated_at, existing.id,
  );
  return serializePack(getPack(existing.id, { includeInactive: true }), { publicView: false });
}

/**
 * Décrémente le stock après un paiement confirmé.
 * Un stock illimité (-1) ou déjà à 0 n'est jamais modifié : impossible de
 * partir sous zéro même en cas d'événement webhook dupliqué (garde SQL).
 */
export function consumeStock(packId, qty = 1) {
  return run(
    'UPDATE packs SET stock = stock - ? WHERE id = ? AND stock >= ?',
    qty, packId, qty,
  ).changes;
}

/** Ré-incrémente le stock lors d'un remboursement complet (jamais sous -1). */
export function releaseStock(packId, qty = 1) {
  return run(
    'UPDATE packs SET stock = stock + ? WHERE id = ? AND stock >= 0',
    qty, packId,
  ).changes;
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
