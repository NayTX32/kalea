/**
 * KALEA — rôles et permissions.
 *
 * Règle métier : le rôle Discord « Fondateur » ouvre automatiquement les
 * privilèges administrateur sur le site. La vérification est faite exclusivement
 * côté serveur, directement contre l'API Discord : aucune donnée venue du client
 * (JavaScript, localStorage, cookie, requête HTTP ou paramètre d'URL) ne peut
 * élever un rôle.
 *
 * Provenance du rôle (`users.role_source`) :
 *  • 'discord' — accordé car le compte possède le rôle Fondateur. Revalidé
 *    régulièrement : si le rôle Discord est perdu, l'accès administrateur est
 *    retiré (y compris en pleine session).
 *  • 'manual'  — accordé par un administrateur depuis le dashboard. Discord ne
 *    le retire jamais.
 */
import { get, run, now } from '../db.js';
import { config } from '../config.js';
import { log, audit } from '../lib/logger.js';
import { botGetGuildMember, botListRoles, fetchGuildMember } from './discord.js';

/** Libellés des rôles du site (affichés dans le compte et le dashboard). */
export const ROLE_LABELS = {
  user: 'Utilisateur',
  admin: 'Administrateur',
};

/**
 * Permissions par rôle. Ajouter un rôle = ajouter une entrée ici ;
 * un rôle absent du tableau n'a aucun droit (défaut « rien n'est autorisé »).
 */
export const PERMISSIONS = {
  admin: [
    'dashboard', 'users', 'products', 'promotions', 'orders', 'payments',
    'settings', 'roles', 'content', 'stats', 'logs', 'config',
    'shop', 'cart', 'account', 'support',
  ],
  /* 'my_orders' = ses propres commandes ; 'orders' (admin) = toutes les commandes. */
  user: ['shop', 'cart', 'account', 'my_orders', 'support'],
};

/** Permissions effectives d'une ligne `users` (rôle inconnu → aucune). */
export const permissionsOf = (userRow) => (userRow ? (PERMISSIONS[userRow.role] ?? []) : []);

export const hasPermission = (userRow, permission) => permissionsOf(userRow).includes(permission);

const ROLE_ID = /^\d{5,}$/;
const SNOWFLAKE = /^\d{15,25}$/;
const wantedRole = () => String(config.discord.founderRole ?? '').trim();

/**
 * Indique si la vérification est possible.
 * Sans configuration valable : aucun droit n'est jamais accordé (défaut sûr).
 *  • bot présent → ID ou nom de rôle ;
 *  • sans bot mais OAuth2 configuré → ID de rôle uniquement.
 */
export function founderConfigured() {
  const wanted = wantedRole();
  if (!config.discord.guildId || !wanted) return false;
  if (config.discord.botConfigured) return true;
  return config.discord.oauthConfigured && ROLE_ID.test(wanted);
}

/**
 * Décision pure (testable sans réseau) : quel rôle appliquer.
 * @param {{ founder: boolean, role: string, roleSource: string }} input
 * @returns {'promote'|'demote'|'keep'}
 */
export function decideRole({ founder, role, roleSource }) {
  if (founder && role !== 'admin') return 'promote';
  if (!founder && role === 'admin' && roleSource === 'discord') return 'demote';
  return 'keep';
}

/** Le compte possède-t-il le rôle Fondateur, d'après la liste de ses rôles (IDs) ? */
async function holdsFounderRole(roleIds) {
  const wanted = wantedRole();
  if (ROLE_ID.test(wanted)) return roleIds.includes(wanted);
  // Nom de rôle : le bot sert à convertir les IDs en noms.
  const roles = await botListRoles();
  const target = wanted.toLowerCase();
  return roles.some((role) => roleIds.includes(role.id) && String(role.name).toLowerCase() === target);
}

/**
 * Rôles Discord du compte.
 * Bot d'abord (fiable, sans expiration), puis jeton utilisateur (guilds.members.read).
 * @returns {{roleIds: string[]}|{notMember: true}|{unsupported?:true}|{}}  {} = vérification impossible
 */
async function fetchDiscordRoleIds(userRow) {
  // Identifiant non valide (compte « lier Discord » de démonstration, champ
  // corrompu…) : inutile d'appeler l'API Discord — ce serait systématiquement
  // un 400, sans jamais modifier de rôle.
  if (!SNOWFLAKE.test(String(userRow.discord_id ?? ''))) return { unsupported: true };

  if (config.discord.botConfigured) {
    try {
      const member = await botGetGuildMember(config.discord.guildId, userRow.discord_id);
      if (member) return { roleIds: member.roles ?? [] };
      return { notMember: true }; // le membre a quitté le serveur → définitif
    } catch (error) {
      log.warn('role_check_bot_failed', { userId: userRow.id, error: error.message });
    }
  }
  if (userRow.discord_access_token) {
    try {
      const member = await fetchGuildMember(userRow.discord_access_token, config.discord.guildId);
      if (member) return { roleIds: member.roles ?? [] };
      return { notMember: true };
    } catch (error) {
      log.warn('role_check_user_failed', { userId: userRow.id, error: error.message });
    }
  }
  return {};
}

/**
 * Revalide le rôle site d'un compte lié à Discord et applique la décision.
 *
 * Garanties :
 *  • Discord injoignable → AUCUN rôle n'est modifié (jamais de rétrogradation
 *    sur une erreur réseau ou un jeton expiré) ;
 *  • contrôle de fréquence : au plus une vérification par `ttlMs` et par compte,
 *    sauf `force` (connexion Discord ou bouton « Vérifier mon rôle ») ;
 *  • tout changement est journalisé (audit + logs).
 *
 * @returns {{checked:boolean, action?:'promote'|'demote'|'keep', founder?:boolean, ...}}
 */
export async function syncDiscordRole(userRow, { force = false, ttlMs, reason = 'check' } = {}) {
  if (!userRow?.discord_id) return { checked: false, skipped: 'non_lien_discord' };
  if (!founderConfigured()) return { checked: false, skipped: 'non_configure' };

  const ttl = ttlMs ?? config.security.roleRevalidateMs;
  if (!force && userRow.discord_checked_at && now() - userRow.discord_checked_at < ttl) {
    return { checked: false, cached: true, founder: Boolean(userRow.discord_founder) };
  }

  const { roleIds, notMember, unsupported } = await fetchDiscordRoleIds(userRow);
  if (unsupported) {
    // Identifiant Discord inutilisable : aucun appel réseau, AUCUN rôle modifié.
    return { checked: false, skipped: 'identifiant_invalide' };
  }
  if (!roleIds && !notMember) return { checked: false, failed: true };

  let founder;
  try {
    founder = notMember ? false : await holdsFounderRole(roleIds);
  } catch (error) {
    log.warn('role_check_name_failed', { userId: userRow.id, error: error.message });
    return { checked: false, failed: true };
  }

  const action = decideRole({
    founder,
    role: userRow.role,
    roleSource: userRow.role_source ?? 'manual',
  });

  const role = action === 'promote' ? 'admin' : action === 'demote' ? 'user' : userRow.role;
  const roleSource = action === 'promote' ? 'discord' : (userRow.role_source ?? 'manual');

  run(
    `UPDATE users SET role = ?, role_source = ?, discord_founder = ?, discord_checked_at = ?, updated_at = ?
     WHERE id = ?`,
    role, roleSource, founder ? 1 : 0, now(), now(), userRow.id,
  );

  if (action !== 'keep') {
    audit(action === 'promote' ? 'role.promoted' : 'role.revoked', {
      actor: { id: userRow.id, email: userRow.email },
      target: userRow.id,
      meta: { via: 'discord', reason, founder, previous: userRow.role, role },
    });
    log.info(action === 'promote' ? 'role_promoted' : 'role_revoked', {
      userId: userRow.id, reason, founder, role,
    });
  }

  return { checked: true, action, founder, role, notMember: Boolean(notMember) };
}

/** Recharge la ligne utilisateur dans le contexte de requête (rôle fraîchement vérifié). */
export function reloadUserRow(userId) {
  return get('SELECT * FROM users WHERE id = ?', userId);
}
