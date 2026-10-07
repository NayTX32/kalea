/** KALEA — service Discord : OAuth2, bot REST, gestion des rôles. */
import { config } from '../config.js';
import { log } from '../lib/logger.js';

const API = 'https://discord.com/api/v10';
const SCOPES = ['identify', 'guilds.members.read'].join(' ');

async function discordFetch(url, options = {}, { retries = 1 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    if (res.status === 429 && retries > 0) {
      const data = await res.json().catch(() => ({}));
      const wait = Math.min(Number(data.retry_after ?? 1) * 1000, 5_000);
      await new Promise((r) => setTimeout(r, wait));
      return discordFetch(url, options, { retries: retries - 1 });
    }
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!res.ok) {
      const message = data?.message ?? `Discord ${res.status}`;
      const err = new Error(message);
      err.status = res.status;
      err.code = data?.code ?? null;
      throw err;
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

/* --------------------------- OAuth2 --------------------------- */

export function buildAuthorizeUrl({ state, redirectUri, scopes = SCOPES }) {
  const params = new URLSearchParams({
    client_id: config.discord.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: scopes,
    state,
    prompt: 'consent',
  });
  return `${API}/oauth2/authorize?${params.toString()}`;
}

export async function exchangeCode(code, redirectUri) {
  const body = new URLSearchParams({
    client_id: config.discord.clientId,
    client_secret: config.discord.clientSecret,
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
  });
  const data = await discordFetch(`${API}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: Number(data.expires_in ?? 3600),
    scope: data.scope ?? '',
  };
}

export async function fetchCurrentUser(accessToken) {
  const data = await discordFetch(`${API}/users/@me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return {
    id: data.id,
    username: data.username,
    globalName: data.global_name ?? data.globalName ?? data.username,
    avatar: data.avatar
      ? `https://cdn.discordapp.com/avatars/${data.id}/${data.avatar}.png?size=128`
      : null,
  };
}

/** Vérifie l'appartenance au serveur avec le jeton utilisateur. */
export async function fetchGuildMember(accessToken, guildId) {
  try {
    return await discordFetch(`${API}/users/@me/guilds/${guildId}/member`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch (error) {
    if (error.status === 404) return null;
    throw error;
  }
}

/* ----------------------------- Bot ---------------------------- */

const botHeaders = () => ({
  Authorization: `Bot ${config.discord.botToken}`,
  'Content-Type': 'application/json',
});

export const botReady = () => config.discord.botConfigured;

/** Ajoute un rôle à un membre (idempotent côté Discord). */
export async function botAddRole(guildId, userId, roleId) {
  if (!config.discord.botConfigured) return { skipped: true, reason: 'bot_discord_non_configure' };
  try {
    await discordFetch(`${API}/guilds/${guildId}/members/${userId}/roles/${roleId}`, {
      method: 'PUT',
      headers: botHeaders(),
      body: '{}',
    });
    return { ok: true };
  } catch (error) {
    if (error.status === 404) {
      return { ok: false, error: 'Membre introuvable sur le serveur Discord (le bot doit être présent).' };
    }
    return { ok: false, error: error.message };
  }
}

export async function botRemoveRole(guildId, userId, roleId) {
  if (!config.discord.botConfigured) return { skipped: true, reason: 'bot_discord_non_configure' };
  try {
    await discordFetch(`${API}/guilds/${guildId}/members/${userId}/roles/${roleId}`, {
      method: 'DELETE',
      headers: botHeaders(),
    });
    return { ok: true };
  } catch (error) {
    if (error.status === 404) return { ok: true, alreadyGone: true };
    return { ok: false, error: error.message };
  }
}

/**
 * Membre du serveur via le bot (rôles Discord inclus).
 * Retourne null quand le membre a quitté le serveur ; lève une erreur
 * en cas d'échec réseau/token (le appelant décide alors de ne rien changer).
 */
export async function botGetGuildMember(guildId, userId) {
  if (!config.discord.botConfigured || !guildId || !userId) return null;
  try {
    return await discordFetch(`${API}/guilds/${guildId}/members/${userId}`, { headers: botHeaders() });
  } catch (error) {
    if (error.status === 404) return null;
    throw error;
  }
}

/** Liste les rôles du serveur (dashboard admin : sélecteur de rôles). */
export async function botListRoles() {
  if (!config.discord.botConfigured) return [];
  const roles = await discordFetch(`${API}/guilds/${config.discord.guildId}/roles`, {
    headers: botHeaders(),
  });
  return (roles ?? [])
    .filter((r) => r.id !== config.discord.guildId)
    .map((r) => ({ id: r.id, name: r.name, color: r.color ? `#${r.color.toString(16).padStart(6, '0')}` : null, position: r.position, managed: r.managed }))
    .sort((a, b) => a.position - b.position);
}

export async function botGetGuild() {
  if (!config.discord.botConfigured) return null;
  return discordFetch(`${API}/guilds/${config.discord.guildId}`, { headers: botHeaders() });
}

/** Rôle Discord à attribuer pour un pack : config pack > variable d'environnement. */
export function roleForPack(pack, { slugFallbacks = {} } = {}) {
  if (pack?.discord_role_id) return pack.discord_role_id;
  const bySlug = slugFallbacks[pack?.slug];
  return bySlug || null;
}

export const discordStatus = () => ({
  oauth: config.discord.oauthConfigured,
  bot: config.discord.botConfigured,
  guildId: config.discord.guildId || null,
});

export { log };
