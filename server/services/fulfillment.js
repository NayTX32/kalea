/**
 * KALEA — livraison automatique des récompenses.
 *
 * Enchaînement : paiement confirmé → identification du joueur →
 * rôle Discord → récompenses dans le jeu → activation du pack.
 *
 * Garanties :
 *  • Un identifiant de transaction unique par commande (tx_<orderId>).
 *  • Une contrainte UNIQUE (order_id, kind, key) : aucune récompense ne peut
 *    être attribuée deux fois, même si un webhook est rejoué.
 *  • Chaque étape est journalisée et rejouable (bouton "Relancer" admin).
 */
import { get, all, run, newId, now, parseJson, toRow, transaction } from '../db.js';
import { config } from '../config.js';
import { log, audit } from '../lib/logger.js';
import { getOrderRow, getOrderItems, updateOrder } from './orders.js';
import { botAddRole, botRemoveRole } from './discord.js';
import { grantRewards, revokeRewards } from './gameapi.js';

const locks = new Map();      // évite deux exécutions simultanées sur une commande
const retries = new Map();    // retries automatiques planifiés

export const STEP_STATUS = {
  PENDING: 'pending', RUNNING: 'running', OK: 'ok', ALREADY: 'already',
  SKIPPED: 'skipped', FAILED: 'failed',
};

/* ------------------------------ Lecture ------------------------------ */

export function getDelivery(orderId) {
  const row = get('SELECT * FROM deliveries WHERE order_id = ?', orderId);
  return row ? { ...row, steps: parseJson(row.steps, []) ?? [] } : null;
}

export function listDeliveries({ status = '', limit = 100, offset = 0 } = {}) {
  const rows = status
    ? all('SELECT * FROM deliveries WHERE status = ? ORDER BY updated_at DESC LIMIT ? OFFSET ?',
        status, clamp(limit), clamp(offset, 500))
    : all('SELECT * FROM deliveries ORDER BY updated_at DESC LIMIT ? OFFSET ?', clamp(limit), clamp(offset, 500));
  return rows.map((r) => ({ ...r, steps: parseJson(r.steps, []) ?? [] }));
}

const clamp = (v, max = 500) => Math.min(Math.max(Number(v) || 100, 1), max);

export function listDeliveryErrors() {
  return all(
    `SELECT * FROM deliveries WHERE status IN ('failed','partial','blocked') ORDER BY updated_at DESC LIMIT 200`,
  ).map((r) => ({ ...r, steps: parseJson(r.steps, []) ?? [] }));
}

/* --------------------------- Construction --------------------------- */

const labelFor = (reward, kind) => {
  const name = typeof reward === 'string' ? reward : (reward?.name ?? reward?.id ?? '');
  if (kind === 'skin') return `Skin « ${name} »`;
  if (kind === 'item') return `Objet « ${name} »`;
  if (kind === 'perm') return `Permission « ${name} »`;
  if (kind === 'feature') return `Fonctionnalité « ${name} »`;
  return name;
};

const rewardKey = (reward, kind) => {
  const id = typeof reward === 'string' ? reward : (reward?.id ?? reward?.name ?? '');
  return `${kind}:${String(id).toLowerCase().replace(/[^a-z0-9:_.-]/g, '_').slice(0, 80)}`;
};

/** Liste des récompenses à livrer, sous forme de lignes de registre. */
export function rewardLedger(snapshot) {
  const rewards = snapshot?.gameRewards ?? {};
  const rows = [];
  const push = (kind, key, label, value = '') => rows.push({ kind, key, label, value });

  for (const skin of rewards.skins ?? []) push('skin', rewardKey(skin, 'skin'), labelFor(skin, 'skin'));
  for (const item of rewards.items ?? []) push('item', rewardKey(item, 'item'), labelFor(item, 'item'));
  if (rewards.currency?.amount) {
    push('currency', `currency:${rewards.currency.type}`, `${rewards.currency.amount} ${rewards.currency.type}`,
      String(rewards.currency.amount));
  }
  for (const perm of rewards.permissions ?? []) push('perm', rewardKey(perm, 'perm'), labelFor(perm, 'perm'));
  for (const feat of rewards.features ?? []) push('feature', rewardKey(feat, 'feature'), labelFor(feat, 'feature'));
  if (rewards.profile) push('profile', 'profile', 'Profil joueur personnalisé', toRow(rewards.profile));
  return rows;
}

/**
 * Étapes de livraison, un bloc par article du panier.
 * Commande simple → clés historiques inchangées (discord_role, game_rewards,
 * activation) ; panier multi-articles → clés suffixées par pack pour que
 * chaque article garde son propre état lors d'une relance.
 */
function buildSteps(order, items, user) {
  const steps = [];
  const multi = items.length > 1;
  for (const item of items) {
    const { packId, snapshot } = item;
    const suffix = multi ? `:${packId}` : '';
    const prefix = multi ? `${snapshot?.name ?? packId} · ` : '';
    const roleId = snapshot?.discordRoleId || config.discord.roleBase ||
      (snapshot?.slug === 'full-locker' ? config.discord.roleFullLocker :
        snapshot?.slug === 'moder' ? config.discord.roleModer : '');
    steps.push({
      key: `discord_role${suffix}`,
      packId,
      label: roleId ? `${prefix}Rôle Discord « ${snapshot?.discordRoleName || 'Pack'} »` : `${prefix}Rôle Discord`,
      roleId: roleId || null,
      status: STEP_STATUS.PENDING,
    });
    const ledger = rewardLedger(snapshot);
    if (ledger.length) {
      steps.push({ key: `game_rewards${suffix}`, packId, label: `${prefix}Récompenses dans le jeu (${ledger.length})`, status: STEP_STATUS.PENDING });
    }
    steps.push({ key: `activation${suffix}`, packId, label: `${prefix}Activation du pack sur le compte`, status: STEP_STATUS.PENDING });
  }
  return steps;
}

function saveDelivery(delivery) {
  run('UPDATE deliveries SET status = ?, steps = ?, attempts = ?, last_error = ?, updated_at = ? WHERE id = ?',
    delivery.status, toRow(delivery.steps), delivery.attempts, delivery.last_error ?? null, now(), delivery.id);
  return getDelivery(delivery.order_id);
}

/* ----------------------------- Exécution ----------------------------- */

export async function fulfillOrder(orderId, { trigger = 'manual', force = false } = {}) {
  if (locks.has(orderId)) return { status: 'locked', message: 'Livraison déjà en cours.' };
  locks.set(orderId, true);
  try {
    return await runFulfillment(orderId, trigger, force);
  } finally {
    locks.delete(orderId);
  }
}

async function runFulfillment(orderId, trigger, force) {
  const order = getOrderRow(orderId);
  if (!order) return { status: 'error', message: 'Commande introuvable' };
  if (order.status !== 'paid') {
    return { status: 'blocked', message: `Commande non payée (${order.status})` };
  }
  const user = get('SELECT * FROM users WHERE id = ?', order.user_id);
  if (!user) return { status: 'error', message: 'Utilisateur introuvable' };
  const snapshot = parseJson(order.pack_snapshot, {}) ?? {};
  const items = getOrderItems(order.id);

  // 1. Création (ou récupération) de la transaction unique de la commande.
  let delivery = getDelivery(orderId);
  if (delivery && delivery.status === 'delivered' && !force) {
    return { status: 'already_delivered', delivery };
  }
  if (!delivery) {
    const txId = `tx_${order.id}`; // identifiant unique de transaction
    try {
      run(
        `INSERT INTO deliveries (id, order_id, user_id, tx_id, status, steps, attempts, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'pending', '[]', 0, ?, ?)`,
        newId('dlv'), order.id, user.id, txId, now(), now(),
      );
    } catch (error) {
      if (!/UNIQUE/i.test(error.message)) throw error;
    }
    delivery = getDelivery(orderId);
  }

  const steps = buildSteps(order, items, user);
  // Conserve l'état des étapes déjà réussies lors d'une relance.
  for (const step of steps) {
    const previous = (delivery.steps ?? []).find((s) => s.key === step.key);
    if (previous && ['ok', 'already', 'skipped'].includes(previous.status) && !force) {
      Object.assign(step, previous, { status: previous.status === 'ok' ? STEP_STATUS.ALREADY : previous.status });
    }
  }

  delivery.steps = steps;
  delivery.status = 'delivering';
  delivery.attempts += 1;
  delivery.last_error = null;
  saveDelivery(delivery);

  const results = [];
  for (const step of steps) {
    if ([STEP_STATUS.ALREADY, STEP_STATUS.SKIPPED].includes(step.status)) {
      results.push(step);
      continue;
    }
    step.status = STEP_STATUS.RUNNING;
    saveDelivery(delivery);
    /* Chaque étape travaille sur SON article : snapshot et pack du panier
     * propres à l'étape (identiques à la commande simple d'un seul article). */
    const item = items.find((entry) => entry.packId === step.packId) ?? { packId: order.pack_id, snapshot };
    const stepSnapshot = item.snapshot ?? snapshot;
    const packId = item.packId ?? order.pack_id;
    try {
      if (step.key.startsWith('discord_role')) {
        await stepDiscordRole(step, { order, user, snapshot: stepSnapshot, packId });
      } else if (step.key.startsWith('game_rewards')) {
        await stepGameRewards(step, { order, user, snapshot: stepSnapshot, packId, txId: delivery.tx_id });
      } else if (step.key.startsWith('activation')) {
        stepActivation(step, { order, user, snapshot: stepSnapshot, packId });
      }
    } catch (error) {
      step.status = STEP_STATUS.FAILED;
      step.error = error.message;
      log.error('delivery_step_failed', { orderId: order.id, step: step.key, error: error.message });
    }
    results.push(step);
    saveDelivery(delivery);
  }

  const failed = results.filter((s) => s.status === STEP_STATUS.FAILED);
  const delivered = results.filter((s) => [STEP_STATUS.OK, STEP_STATUS.ALREADY].includes(s.status));

  if (failed.length === 0) {
    delivery.status = 'delivered';
    delivery.last_error = null;
  } else if (delivered.length > 0 || results.some((s) => s.status === STEP_STATUS.SKIPPED)) {
    delivery.status = 'partial';
    delivery.last_error = failed.map((s) => `${s.key}: ${s.error ?? 'erreur'}`).join(' | ').slice(0, 400);
  } else {
    delivery.status = 'failed';
    delivery.last_error = failed.map((s) => `${s.key}: ${s.error ?? 'erreur'}`).join(' | ').slice(0, 400);
  }
  const finalDelivery = saveDelivery(delivery);

  if (failed.length) {
    scheduleRetry(order.id, delivery.attempts);
    audit('delivery.partial', { target: order.id, meta: { attempts: delivery.attempts, error: delivery.last_error } });
  } else {
    audit('delivery.completed', { target: order.id, meta: { txId: delivery.tx_id, trigger, attempts: delivery.attempts } });
    log.info('delivery_completed', { orderId: order.id, txId: delivery.tx_id, trigger });
  }
  return { status: finalDelivery.status, delivery: finalDelivery };
}

/** Relance automatique (2 tentatives : 30 s puis 120 s). */
function scheduleRetry(orderId, attempts) {
  if (attempts >= 3) return;
  if (retries.has(orderId)) return;
  const delay = attempts <= 1 ? 30_000 : 120_000;
  const timer = setTimeout(async () => {
    retries.delete(orderId);
    try {
      const order = getOrderRow(orderId);
      if (order?.status === 'paid') {
        log.info('delivery_auto_retry', { orderId, attempt: attempts + 1 });
        await fulfillOrder(orderId, { trigger: 'auto_retry' });
      }
    } catch (error) {
      log.error('delivery_retry_failed', { orderId, error: error.message });
    }
  }, delay);
  if (typeof timer.unref === 'function') timer.unref();
  retries.set(orderId, timer);
}

export function cancelScheduledRetry(orderId) {
  const timer = retries.get(orderId);
  if (timer) clearTimeout(timer);
  retries.delete(orderId);
}

/* ------------------------------ Étapes ------------------------------ */

async function stepDiscordRole(step, { order, user, snapshot, packId }) {
  if (!step.roleId) {
    step.status = STEP_STATUS.SKIPPED;
    step.reason = 'aucun_role_configure';
    return;
  }
  const grantKey = `role:${step.roleId}`;
  const pending = () => markGrantPending({
    orderId: order.id, userId: user.id, packId, txId: `tx_${order.id}`,
    kind: 'discord_role', key: grantKey, label: step.label, value: step.roleId,
  });
  if (!user.discord_id) {
    pending(); // rôle dû, en attente de connexion Discord
    step.status = STEP_STATUS.SKIPPED;
    step.reason = 'compte_discord_non_connecte';
    step.hint = 'Le joueur doit connecter son Discord pour recevoir le rôle.';
    return;
  }
  // Vérification anti double attribution.
  const existing = get('SELECT * FROM grants WHERE order_id = ? AND kind = ? AND key = ?',
    order.id, 'discord_role', grantKey);
  if (existing?.status === 'granted') {
    step.status = STEP_STATUS.ALREADY;
    return;
  }

  const result = await botAddRole(config.discord.guildId, user.discord_id, step.roleId);
  if (result.skipped) {
    pending();
    step.status = STEP_STATUS.SKIPPED;
    step.reason = result.reason;
    return;
  }
  if (!result.ok) {
    pending();
    step.status = STEP_STATUS.FAILED;
    step.error = result.error;
    return;
  }
  upsertGrant({
    orderId: order.id, userId: user.id, packId, txId: `tx_${order.id}`,
    kind: 'discord_role', key: `role:${step.roleId}`,
    label: step.label, value: step.roleId,
  });
  step.status = STEP_STATUS.OK;
}

async function stepGameRewards(step, { order, user, snapshot, packId, txId }) {
  const ledger = rewardLedger(snapshot);
  if (!ledger.length) {
    step.status = STEP_STATUS.SKIPPED;
    step.reason = 'aucune_recompense';
    return;
  }

  // Vérification : toutes les récompenses sont-elles déjà attribuées ?
  const missing = ledger.filter((entry) => {
    const existing = get('SELECT status FROM grants WHERE order_id = ? AND kind = ? AND key = ?',
      order.id, entry.kind, entry.key);
    return !(existing && existing.status === 'granted');
  });
  if (!missing.length) {
    step.status = STEP_STATUS.ALREADY;
    step.reason = 'deja_attribue';
    return;
  }
  // Toute récompense due est enregistrée (« pending ») tant qu'elle n'est pas livrée :
  // le joueur la voit dans son compte, elle basculera en « granted » à la livraison.
  const markPending = () => missing.forEach((entry) => markGrantPending({
    orderId: order.id, userId: user.id, packId, txId,
    kind: entry.kind, key: entry.key, label: entry.label, value: entry.value,
  }));

  if (!user.game_player_id) {
    markPending();
    step.status = STEP_STATUS.SKIPPED;
    step.reason = 'identifiant_jeu_absent';
    step.hint = 'Renseignez votre identifiant de jeu dans « Mon compte » puis relancez la livraison.';
    step.pending = missing;
    return;
  }

  const result = await grantRewards({
    order, user, pack: { id: packId, slug: snapshot.slug, name: snapshot.name },
    txId, rewards: snapshot.gameRewards ?? {},
  });

  if (result.skipped) {
    markPending();
    if (config.game.required) {
      step.status = STEP_STATUS.FAILED;
      step.error = 'API du jeu non configurée (GAME_API_URL / GAME_API_SECRET requis)';
    } else {
      step.status = STEP_STATUS.SKIPPED;
      step.reason = 'api_jeu_non_configuree';
      step.pending = missing;
    }
    return;
  }
  if (!result.ok) {
    markPending();
    step.status = STEP_STATUS.FAILED;
    step.error = result.error;
    return;
  }

  for (const entry of missing) {
    upsertGrant({
      orderId: order.id, userId: user.id, packId, txId,
      kind: entry.kind, key: entry.key, label: entry.label, value: entry.value,
    });
  }
  step.status = STEP_STATUS.OK;
  step.delivered = missing.map((m) => m.label);
  if (result.data?.alreadyApplied) step.status = STEP_STATUS.ALREADY;
}

function stepActivation(step, { order, user, snapshot, packId }) {
  transaction(() => {
    run(
      `INSERT INTO user_packs (user_id, pack_id, order_id, active, granted_at, revoked_at)
       VALUES (?, ?, ?, 1, ?, NULL)
       ON CONFLICT(user_id, pack_id) DO UPDATE SET active = 1, order_id = excluded.order_id,
         granted_at = excluded.granted_at, revoked_at = NULL`,
      user.id, packId, order.id, now(),
    );
  });
  // Registre : le pack devient actif sur le compte (une seule fois par transaction).
  upsertGrant({
    orderId: order.id, userId: user.id, packId, txId: `tx_${order.id}`,
    kind: 'activation', key: `pack:${packId}`,
    label: `Pack « ${snapshot.name ?? packId} » activé`, value: packId,
  });
  step.status = STEP_STATUS.OK;
}

/** Insère ou réactive une ligne du registre (anti doublon par transaction). */
export function upsertGrant({ orderId, userId, packId, txId, kind, key, label, value }) {
  try {
    run(
      `INSERT INTO grants (id, order_id, user_id, pack_id, tx_id, kind, key, label, value, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'granted', ?)
       ON CONFLICT(order_id, kind, key) DO UPDATE SET
         status = 'granted', revoked_at = NULL, label = excluded.label,
         value = excluded.value, tx_id = excluded.tx_id`,
      newId('grt'), orderId, userId, packId, txId, kind, key, label ?? '', value ?? '', now(),
    );
    return true;
  } catch (error) {
    if (/UNIQUE/i.test(error.message)) return false;
    throw error;
  }
}

/**
 * Enregistre une récompense « due » mais pas encore livrée (Discord non lié,
 * identifiant de jeu absent, API du jeu non configurée…). Elle apparaît dans
 * le compte du joueur puis bascule en « granted » dès la livraison réelle.
 */
export function markGrantPending({ orderId, userId, packId, txId, kind, key, label, value }) {
  try {
    run(
      `INSERT INTO grants (id, order_id, user_id, pack_id, tx_id, kind, key, label, value, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
       ON CONFLICT(order_id, kind, key) DO NOTHING`,
      newId('grt'), orderId, userId, packId, txId, kind, key, label ?? '', value ?? '', now(),
    );
    return true;
  } catch (error) {
    if (/UNIQUE/i.test(error.message)) return false;
    throw error;
  }
}

/* ------------------------- Rattrapage (backfill) -------------------------
 * Appelé quand un joueur connecte son Discord ou renseigne son identifiant de
 * jeu après un achat : on délivre ce qui manque, sans jamais dupliquer.
 * ------------------------------------------------------------------------ */

export async function backfillUserEntitlements(userId) {
  const user = get('SELECT * FROM users WHERE id = ?', userId);
  if (!user) return { granted: [], skipped: [] };
  const activePacks = all(
    'SELECT * FROM user_packs WHERE user_id = ? AND active = 1', userId,
  );
  const granted = [];
  const skipped = [];

  for (const row of activePacks) {
    const packRow = get('SELECT * FROM packs WHERE id = ?', row.pack_id);
    if (!packRow) continue;
    const snapshot = {
      id: packRow.id, slug: packRow.slug, name: packRow.name,
      discordRoleId: packRow.discord_role_id, discordRoleName: packRow.discord_role_name,
      gameRewards: parseJson(packRow.game_rewards, {}) ?? {},
    };
    const steps = buildSteps({ id: row.order_id, pack_id: row.pack_id }, [{ packId: row.pack_id, snapshot }], user);

    // Rôle Discord
    const roleStep = steps.find((s) => s.key === 'discord_role');
    if (roleStep?.roleId && user.discord_id) {
      const exists = get('SELECT status FROM grants WHERE order_id = ? AND kind = ? AND key = ?',
        row.order_id, 'discord_role', `role:${roleStep.roleId}`);
      if (exists?.status !== 'granted') {
        const res = await botAddRole(config.discord.guildId, user.discord_id, roleStep.roleId);
        if (res.ok) {
          upsertGrant({
            orderId: row.order_id, userId, packId: row.pack_id, txId: `tx_${row.order_id}`,
            kind: 'discord_role', key: `role:${roleStep.roleId}`, label: roleStep.label, value: roleStep.roleId,
          });
          granted.push(roleStep.label);
        } else if (!res.skipped) skipped.push(res.error ?? 'role');
      }
    }

    // Récompenses de jeu
    const ledger = rewardLedger(snapshot);
    if (ledger.length && user.game_player_id) {
      const missing = ledger.filter((entry) => {
        const existing = get('SELECT status FROM grants WHERE order_id = ? AND kind = ? AND key = ?',
          row.order_id, entry.kind, entry.key);
        return !(existing && existing.status === 'granted');
      });
      if (missing.length) {
        const res = await grantRewards({
          order: getOrderRow(row.order_id) ?? { id: row.order_id, order_number: '', paid_at: row.granted_at },
          user, pack: { id: row.pack_id, slug: snapshot.slug, name: snapshot.name },
          txId: `tx_${row.order_id}`, rewards: snapshot.gameRewards,
        });
        if (res.ok && !res.skipped) {
          for (const entry of missing) {
            upsertGrant({
              orderId: row.order_id, userId, packId: row.pack_id, txId: `tx_${row.order_id}`,
              kind: entry.kind, key: entry.key, label: entry.label, value: entry.value,
            });
          }
          granted.push(...missing.map((m) => m.label));
        } else if (res.skipped) skipped.push('api_jeu');
        else skipped.push(res.error ?? 'game');
      }
    }
  }
  if (granted.length) {
    audit('entitlements.backfill', { target: userId, meta: { granted: granted.length } });
    log.info('entitlements_backfill', { userId, granted: granted.length });
  }
  return { granted, skipped };
}

/* --------------------------- Remboursement --------------------------- */

export async function revokeOrder(orderId, { reason = 'remboursement', actor = null } = {}) {
  const order = getOrderRow(orderId);
  if (!order) return { status: 'error', message: 'Commande introuvable' };
  const user = get('SELECT * FROM users WHERE id = ?', order.user_id);
  const items = getOrderItems(orderId);
  const results = [];

  // 1. Registre : les récompenses (livrées ou dues) passent en "revoked".
  run('UPDATE grants SET status = ?, revoked_at = ? WHERE order_id = ? AND status IN (?, ?)',
    'revoked', now(), orderId, 'granted', 'pending');

  // 2. Tous les packs du panier deviennent inactifs sur le compte joueur.
  for (const item of items) {
    run('UPDATE user_packs SET active = 0, revoked_at = ? WHERE user_id = ? AND pack_id = ?',
      now(), order.user_id, item.packId);
  }

  const delivery = getDelivery(orderId);
  const steps = delivery?.steps ?? [];
  const multi = items.length > 1;
  const roleIdOf = (snapshot) => snapshot?.discordRoleId || config.discord.roleBase ||
    (snapshot?.slug === 'full-locker' ? config.discord.roleFullLocker :
      snapshot?.slug === 'moder' ? config.discord.roleModer : '');

  // 3. Retrait des rôles Discord (un par rôle distinct, option configurable).
  const roleIds = [...new Set(items.map((item) => roleIdOf(item.snapshot)).filter(Boolean))];
  if (config.discord.removeOnRefund && roleIds.length && user?.discord_id) {
    for (const roleId of roleIds) {
      const res = await botRemoveRole(config.discord.guildId, user.discord_id, roleId);
      results.push({ step: 'discord_role_revoke', status: res.ok ? 'ok' : 'failed', detail: res.error ?? res.reason ?? null });
      steps.push({ key: multi ? `discord_role_revoke:${roleId}` : 'discord_role_revoke', label: 'Retrait du rôle Discord', status: res.ok ? 'ok' : 'failed', error: res.error ?? null, at: now() });
    }
  } else {
    steps.push({ key: 'discord_role_revoke', label: 'Retrait du rôle Discord', status: 'skipped', reason: 'option_désactivée_ou_role_absent', at: now() });
  }

  // 4. Retrait des récompenses dans le jeu, article par article.
  for (const item of items) {
    const { packId, snapshot } = item;
    const ledger = rewardLedger(snapshot);
    if (!ledger.length) continue;
    const res = await revokeRewards({
      order, user: user ?? {}, pack: { id: packId, slug: snapshot?.slug, name: snapshot?.name },
      txId: delivery?.tx_id ?? `tx_${order.id}`, rewards: snapshot?.gameRewards ?? {},
    });
    results.push({ step: 'game_revoke', status: res.ok ? 'ok' : (res.skipped ? 'skipped' : 'failed'), detail: res.error ?? res.reason ?? null });
    steps.push({
      key: multi ? `game_revoke:${packId}` : 'game_revoke',
      label: `Retrait des récompenses dans le jeu${multi ? ` — ${snapshot?.name ?? packId}` : ''}`,
      status: res.ok ? 'ok' : (res.skipped ? 'skipped' : 'failed'),
      error: res.error ?? res.reason ?? null, at: now(),
    });
  }

  if (delivery) {
    delivery.steps = steps;
    delivery.status = 'reverted';
    saveDelivery(delivery);
  }
  audit('delivery.reverted', { actor, target: orderId, meta: { reason, results } });
  log.info('order_revoked', { orderId, reason });
  return { status: 'reverted', results };
}
