/**
 * KALEA — codes promotionnels.
 *
 * Toute la validation est faite côté serveur : le client n'envoie qu'un code
 * et des identifiants de packs, jamais un montant. Le calcul du montant final
 * est refait par `createOrder`, indépendamment de ce que le navigateur affiche.
 */
import { all, get, run, newId, now } from '../db.js';
import { badRequest, notFound, conflict } from '../lib/errors.js';
import { str, int, bool } from '../lib/validate.js';

export function serializePromo(row) {
  if (!row) return null;
  return {
    id: row.id,
    code: row.code,
    label: row.label,
    kind: row.kind,
    value: row.value,
    /** Libellé lisible : « 10 % » ou « 5,00 € ». */
    discountLabel: row.kind === 'percent' ? `${row.value} %` : `${(row.value / 100).toFixed(2).replace('.', ',')} €`,
    minAmountCents: row.min_amount_cents,
    maxUses: row.max_uses,
    usedCount: row.used_count,
    startsAt: row.starts_at ?? null,
    endsAt: row.ends_at ?? null,
    active: row.active === 1,
    expired: Boolean(row.ends_at && row.ends_at < now()),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listPromotions() {
  return all('SELECT * FROM promotions ORDER BY created_at DESC').map(serializePromo);
}

export function getPromoRow(idOrCode) {
  if (!idOrCode) return null;
  const code = String(idOrCode).trim().toUpperCase();
  return get('SELECT * FROM promotions WHERE id = ? OR code = ?', idOrCode, code);
}

export function sanitizePromoInput(body, { existing = null } = {}) {
  const code = str(body.code, { field: 'code', min: 2, max: 32 }).toUpperCase();
  if (!/^[A-Z0-9_-]+$/.test(code)) {
    throw badRequest('Le code promo ne peut contenir que des lettres, chiffres, tirets et tirets bas.');
  }
  const duplicate = get('SELECT id FROM promotions WHERE code = ?', code);
  if (duplicate && duplicate.id !== existing?.id) {
    throw conflict('Ce code promotionnel existe déjà.', 'duplicate_code');
  }

  const kind = str(body.kind ?? 'percent', { field: 'type', max: 10 });
  if (!['percent', 'fixed'].includes(kind)) throw badRequest('Type de remise invalide.');

  // percent : 1–99. fixed : montant en CENTIMES (jamais de flottant côté serveur).
  const value = kind === 'percent'
    ? int(body.value, { field: 'pourcentage', min: 1, max: 99 })
    : int(body.value, { field: 'montant', min: 1, max: 10_000_000 });
  if (!Number.isFinite(value)) throw badRequest('La valeur de la remise est invalide.');

  const startsAt = body.startsAt ? int(body.startsAt, { field: 'début', min: 0, fallback: null }) : null;
  const endsAt = body.endsAt ? int(body.endsAt, { field: 'fin', min: 0, fallback: null }) : null;
  if (startsAt && endsAt && endsAt <= startsAt) throw badRequest('La date de fin doit être postérieure à la date de début.');

  return {
    code,
    label: str(body.label ?? '', { field: 'libellé', max: 80, required: false }),
    kind,
    value,
    min_amount_cents: int(body.minAmountCents ?? 0, { field: 'montant minimum', min: 0, max: 10_000_000, fallback: 0 }),
    max_uses: body.maxUses === undefined || body.maxUses === null || body.maxUses === ''
      ? null
      : int(body.maxUses, { field: 'utilisations max', min: 1, max: 1_000_000 }),
    starts_at: startsAt,
    ends_at: endsAt,
    active: bool(body.active, true) ? 1 : 0,
    updated_at: now(),
  };
}

export function createPromotion(body) {
  const data = sanitizePromoInput(body);
  const id = newId('pro');
  run(
    `INSERT INTO promotions (id, code, label, kind, value, min_amount_cents, max_uses, used_count,
        starts_at, ends_at, active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`,
    id, data.code, data.label, data.kind, data.value, data.min_amount_cents, data.max_uses,
    data.starts_at, data.ends_at, data.active, now(), data.updated_at,
  );
  return serializePromo(get('SELECT * FROM promotions WHERE id = ?', id));
}

export function updatePromotion(id, body) {
  const existing = get('SELECT * FROM promotions WHERE id = ?', id);
  if (!existing) throw notFound('Code promotionnel introuvable.');
  const data = sanitizePromoInput({ ...serializePromo(existing), ...body }, { existing });
  run(
    `UPDATE promotions SET code=?, label=?, kind=?, value=?, min_amount_cents=?, max_uses=?,
        starts_at=?, ends_at=?, active=?, updated_at=? WHERE id = ?`,
    data.code, data.label, data.kind, data.value, data.min_amount_cents, data.max_uses,
    data.starts_at, data.ends_at, data.active, data.updated_at, existing.id,
  );
  return serializePromo(get('SELECT * FROM promotions WHERE id = ?', existing.id));
}

export function deletePromotion(id) {
  const existing = get('SELECT * FROM promotions WHERE id = ?', id);
  if (!existing) throw notFound('Code promotionnel introuvable.');
  run('DELETE FROM promotions WHERE id = ?', existing.id);
  return { deleted: true, id: existing.id };
}

/**
 * Calcule la remise pour un sous-total donné.
 * @returns {{promotion:object, discountCents:number}}
 * @throws 400 avec un message français si le code est inapplicable.
 */
export function applyPromotion(code, subtotalCents, { consume = false } = {}) {
  const raw = String(code ?? '').trim();
  if (!raw) return null;
  const row = getPromoRow(raw);
  if (!row) throw badRequest('Ce code promotionnel n’existe pas.');
  if (row.active !== 1) throw badRequest('Ce code promotionnel n’est plus actif.');

  const ts = now();
  if (row.starts_at && ts < row.starts_at) throw badRequest('Ce code promotionnel n’est pas encore valide.');
  if (row.ends_at && ts > row.ends_at) throw badRequest('Ce code promotionnel a expiré.');
  if (row.max_uses !== null && row.used_count >= row.max_uses) {
    throw badRequest('Ce code promotionnel a atteint son nombre d’utilisations.');
  }
  if (subtotalCents < (row.min_amount_cents ?? 0)) {
    const min = (row.min_amount_cents / 100).toFixed(2).replace('.', ',');
    throw badRequest(`Ce code s’applique à partir de ${min} € d’achat.`);
  }

  const discount = row.kind === 'percent'
    ? Math.floor((subtotalCents * row.value) / 100)
    : Math.min(row.value, subtotalCents);
  const discountCents = Math.max(0, Math.min(discount, subtotalCents));

  if (consume) run('UPDATE promotions SET used_count = used_count + 1 WHERE id = ?', row.id);
  return { promotion: serializePromo(row), discountCents };
}
