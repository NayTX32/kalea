/** KALEA — catégories de produits (CRUD admin + lecture publique). */
import { all, get, run, newId, now } from '../db.js';
import { badRequest, notFound, conflict } from '../lib/errors.js';
import { str, int, bool, slugify } from '../lib/validate.js';

export function serializeCategory(row, { packCount } = {}) {
  if (!row) return null;
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    emoji: row.emoji,
    description: row.description,
    sortOrder: row.sort_order,
    active: row.active === 1,
    packCount: packCount ?? countPacks(row.id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const countPacks = (categoryId) =>
  get('SELECT COUNT(*) AS c FROM packs WHERE category_id = ?', categoryId)?.c ?? 0;

/** Toutes les catégories (admin : inactives incluses). */
export function listCategories({ includeInactive = false } = {}) {
  const rows = includeInactive
    ? all('SELECT * FROM categories ORDER BY sort_order ASC, name ASC')
    : all('SELECT * FROM categories WHERE active = 1 ORDER BY sort_order ASC, name ASC');
  return rows.map((row) => serializeCategory(row));
}

export function getCategoryRow(idOrSlug) {
  return get('SELECT * FROM categories WHERE id = ? OR slug = ?', idOrSlug, idOrSlug);
}

/** Catégories utilisées au moins par un pack actif (filtres de la boutique). */
export function listUsedCategories() {
  return all(
    `SELECT c.* FROM categories c
     WHERE c.active = 1 AND EXISTS (
       SELECT 1 FROM packs p WHERE p.category_id = c.id AND p.active = 1
     )
     ORDER BY c.sort_order ASC, c.name ASC`,
  ).map((row) => serializeCategory(row));
}

export function sanitizeCategoryInput(body, { existing = null } = {}) {
  const name = str(body.name, { field: 'nom', min: 2, max: 60 });
  // Slug vide → dérivé automatiquement du nom (jamais d'erreur bloquante).
  const slug = str(String(body.slug ?? '').trim() || slugify(name), { field: 'slug', min: 2, max: 60 });
  if (!/^[a-z0-9-]+$/.test(slug)) {
    throw badRequest('Le slug ne peut contenir que des lettres minuscules, chiffres et tirets.');
  }
  const duplicate = get('SELECT id FROM categories WHERE slug = ?', slug);
  if (duplicate && duplicate.id !== existing?.id) {
    throw conflict('Ce slug de catégorie est déjà utilisé.', 'duplicate_slug');
  }
  return {
    slug,
    name,
    emoji: str(body.emoji ?? '🗂️', { field: 'emoji', min: 1, max: 8, required: false }) || '🗂️',
    description: str(body.description ?? '', { field: 'description', max: 300, required: false }),
    sort_order: int(body.sortOrder ?? 0, { field: 'ordre', min: -1000, max: 1000, fallback: 0 }),
    active: bool(body.active, true) ? 1 : 0,
    updated_at: now(),
  };
}

export function createCategory(body) {
  const data = sanitizeCategoryInput(body);
  const id = newId('cat');
  run(
    `INSERT INTO categories (id, slug, name, emoji, description, sort_order, active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, data.slug, data.name, data.emoji, data.description, data.sort_order, data.active, now(), data.updated_at,
  );
  return serializeCategory(get('SELECT * FROM categories WHERE id = ?', id));
}

export function updateCategory(id, body) {
  const existing = getCategoryRow(id);
  if (!existing) throw notFound('Catégorie introuvable.');
  const data = sanitizeCategoryInput({ ...serializeCategory(existing), ...body }, { existing });
  run(
    `UPDATE categories SET slug=?, name=?, emoji=?, description=?, sort_order=?, active=?, updated_at=?
     WHERE id = ?`,
    data.slug, data.name, data.emoji, data.description, data.sort_order, data.active, data.updated_at,
    existing.id,
  );
  return serializeCategory(get('SELECT * FROM categories WHERE id = ?', existing.id));
}

/**
 * Suppression : les packs rattachés passent en « sans catégorie »
 * (ON DELETE SET NULL côté contrainte, mais on repasse aussi par SQL explicite).
 */
export function deleteCategory(id) {
  const existing = getCategoryRow(id);
  if (!existing) throw notFound('Catégorie introuvable.');
  run('UPDATE packs SET category_id = NULL, updated_at = ? WHERE category_id = ?', now(), existing.id);
  run('DELETE FROM categories WHERE id = ?', existing.id);
  return { deleted: true, id: existing.id };
}

/** Valide qu'une catégorie existe et est active (usage : formulaire pack). */
export function resolveCategoryId(value) {
  // Accepte : null / '', un id, un slug, ou un objet { id } / { slug }.
  const ref = value && typeof value === 'object'
    ? (value.id ?? value.slug ?? '')
    : value;
  const raw = String(ref ?? '').trim();
  if (!raw) return null;
  const row = getCategoryRow(raw);
  if (!row) throw badRequest('Catégorie inconnue.');
  return row.id;
}
