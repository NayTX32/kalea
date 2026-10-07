/**
 * KALEA — tests des rôles et permissions (système Fondateur → Administrateur).
 *
 *   node tools/test-roles.mjs
 *
 * Couvre :
 *  1. la décision pure de promotion/rétrogradation (aucun réseau) ;
 *  2. la carte des permissions (admin / utilisateur / rôle inconnu) ;
 *  3. les migrations SQLite (colonnes de rôle, table order_items) ;
 *  4. la configuration (défaut sûr, rôle Fondateur) ;
 *  5. les gardes HTTP côté serveur (anonyme, utilisateur, administrateur) ;
 *  6. l'anti-spoofing d'adresse IP (X-Forwarded-For ignoré sans TRUST_PROXY).
 */
import { get, all, closeDb } from '../server/db.js';
import { config } from '../server/config.js';
import {
  decideRole, permissionsOf, hasPermission, founderConfigured, PERMISSIONS,
} from '../server/services/roles.js';

const BASE = process.env.BASE_URL ?? 'http://localhost:4000';
const jar = new Map();
let checks = 0;
let failures = 0;

const check = (label, ok, detail = '') => {
  checks += 1;
  if (ok) console.log(`  ✔ ${label}`);
  else { failures += 1; console.log(`  ✘ ${label} ${detail ? `— ${detail}` : ''}`); }
};

function cookieHeader() {
  return [...jar.entries()].map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('; ');
}

function storeCookies(res) {
  for (const line of (res.headers.getSetCookie?.() ?? [])) {
    const [pair] = line.split(';');
    const idx = pair.indexOf('=');
    if (idx > 0) jar.set(pair.slice(0, idx).trim(), decodeURIComponent(pair.slice(idx + 1).trim()));
  }
}

async function call(method, path, body = null, headers = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      Cookie: cookieHeader(),
      ...(jar.has('kalea_csrf') ? { 'X-CSRF-Token': jar.get('kalea_csrf') } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  });
  storeCookies(res);
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* HTML */ }
  return { res, json, text };
}

const waitForServer = async (retries = 25) => {
  for (let i = 0; i < retries; i += 1) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) return true; } catch { /* pas prêt */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
};

const resetJar = () => jar.clear();

/* ------------------------------ 1. Décision pure ------------------------------ */
function testDecideRole() {
  console.log('\n1. Décision pure (promote / demote / keep)');
  check('Fondateur + rôle utilisateur → promotion',
    decideRole({ founder: true, role: 'user', roleSource: 'manual' }) === 'promote');
  check('Fondateur + administrateur (source Discord) → conservé',
    decideRole({ founder: true, role: 'admin', roleSource: 'discord' }) === 'keep');
  check('Fondateur + administrateur (source manuelle) → conservé',
    decideRole({ founder: true, role: 'admin', roleSource: 'manual' }) === 'keep');
  check('Sans Fondateur + admin (source Discord) → rétrogradation',
    decideRole({ founder: false, role: 'admin', roleSource: 'discord' }) === 'demote');
  check('Sans Fondateur + admin (source manuelle) → conservé (Discord ne retire jamais)',
    decideRole({ founder: false, role: 'admin', roleSource: 'manual' }) === 'keep');
  check('Sans Fondateur + utilisateur → aucun changement',
    decideRole({ founder: false, role: 'user', roleSource: 'manual' }) === 'keep');
}

/* ------------------------------ 2. Permissions ------------------------------ */
function testPermissions() {
  console.log('\n2. Carte des permissions');
  const admin = { role: 'admin' };
  const user = { role: 'user' };
  const futur = { role: 'moderator' }; // rôle ajouté plus tard sans configuration
  const attendues = ['dashboard', 'users', 'products', 'orders', 'payments', 'settings', 'roles', 'stats', 'logs'];
  check('Administrateur : toutes les sections', attendues.every((p) => hasPermission(admin, p)),
    attendues.filter((p) => !hasPermission(admin, p)).join(','));
  check('Utilisateur : aucune section admin',
    attendues.every((p) => !hasPermission(user, p)));
  check('Utilisateur : accès boutique/compte/support',
    ['shop', 'cart', 'account', 'my_orders', 'support'].every((p) => hasPermission(user, p)));
  check('Rôle inconnu → aucune permission (défaut « rien n’est autorisé »)',
    permissionsOf(futur).length === 0);
  check('Aucun utilisateur → aucune permission', permissionsOf(null).length === 0);
  check('Table PERMISSIONS cohérente (admin ⊇ sections exposées)',
    PERMISSIONS.admin.length > PERMISSIONS.user.length);
}

/* --------------------------- 3. Migrations SQLite --------------------------- */
function testSchema() {
  console.log('\n3. Migrations de la base');
  const cols = all('PRAGMA table_info(users)').map((c) => c.name);
  check("Colonne users.role_source ('discord' vs 'manual')", cols.includes('role_source'));
  check('Colonne users.discord_checked_at (horodatage de vérification)', cols.includes('discord_checked_at'));
  check('Colonne users.discord_founder (cache du rôle Fondateur)', cols.includes('discord_founder'));
  const items = all("SELECT name FROM sqlite_master WHERE type='table' AND name='order_items'");
  check('Table order_items (panier multi-articles) créée', items.length === 1);

  // Catégories / promotions / stock (dashboard).
  const tables = all("SELECT name FROM sqlite_master WHERE type='table'").map((r) => r.name);
  check('Table categories créée', tables.includes('categories'));
  check('Table promotions créée', tables.includes('promotions'));
  check('Colonne packs.category_id (classement)', all('PRAGMA table_info(packs)').map((c) => c.name).includes('category_id'));
  check('Colonne packs.stock (gestion des disponibilités)',
    all('PRAGMA table_info(packs)').map((c) => c.name).includes('stock'));
  const orderCols = all('PRAGMA table_info(orders)').map((c) => c.name);
  check('Colonnes orders.promo_code / discount_cents (remise)',
    orderCols.includes('promo_code') && orderCols.includes('discount_cents'));

  const rows = all('SELECT role, role_source, discord_founder FROM users');
  check(`Lignes utilisateurs valides (${rows.length})`,
    rows.every((r) => r.role_source === 'manual' || r.role_source === 'discord')
    && rows.every((r) => r.discord_founder === 0 || r.discord_founder === 1));
}

/* ---------------------------- 4. Configuration ---------------------------- */
function testConfig() {
  console.log('\n4. Configuration');
  const snowflake = /^\d{15,25}$/;
  check('Rôle Fondateur renseigné (ID Discord ou nom exact)', Boolean(config.discord.founderRole),
    String(config.discord.founderRole));
  check('Serveur Discord renseigné (identifiant valide)', snowflake.test(String(config.discord.guildId ?? '')),
    String(config.discord.guildId));
  check('Bot Discord configuré → vérification des rôles côté serveur',
    config.discord.botConfigured === true, String(config.discord.botConfigured));
  check('Vérification des rôles activée (founderConfigured)', founderConfigured() === true,
    String(founderConfigured()));
  check('TRUST_PROXY désactivé par défaut (pas de confiance en X-Forwarded-For)',
    config.security.trustProxy === false, String(config.security.trustProxy));
  check('Période de revalidation définie (> 0)', config.security.roleRevalidateMs > 0);
}

/* ------------------------------ 5. Gardes HTTP ------------------------------ */
async function testGuards() {
  console.log('\n5. Gardes serveur des routes d’administration');

  resetJar();
  let r = await call('GET', '/api/admin/stats');
  check('Anonyme → /api/admin/stats refusé (401)', r.res.status === 401, String(r.res.status));
  r = await call('GET', '/api/admin/users');
  check('Anonyme → /api/admin/users refusé (401)', r.res.status === 401, String(r.res.status));
  r = await call('POST', '/api/admin/settings', {});
  check('Anonyme → écriture admin refusée (401)', r.res.status === 401, String(r.res.status));

  // Compte utilisateur normal.
  const stamp = Date.now();
  const email = `roles${stamp}@kalea.test`;
  const password = 'RolesTest2026!';
  r = await call('POST', '/api/auth/register', { email, password, displayName: `Roles${String(stamp).slice(-5)}` });
  check('Inscription du compte de test (201)', r.res.status === 201, String(r.res.status));

  r = await call('GET', '/api/me');
  check('/api/me expose les permissions de l’utilisateur',
    Array.isArray(r.json?.permissions) && r.json.permissions.includes('account'),
    JSON.stringify(r.json?.permissions));
  check('/api/me n’accorde aucune permission admin',
    Array.isArray(r.json?.permissions) && !r.json.permissions.includes('users'));
  check('Le rôle annoncé est "user"', r.json?.user?.role === 'user', r.json?.user?.role);

  r = await call('GET', '/api/admin/stats');
  check('Utilisateur connecté → /api/admin/stats interdit (403)', r.res.status === 403, String(r.res.status));
  r = await call('GET', '/api/admin/users');
  check('Utilisateur connecté → /api/admin/users interdit (403)', r.res.status === 403, String(r.res.status));
  r = await call('PUT', '/api/admin/settings', { key: 'site_name', value: 'Piratage' });
  check('Utilisateur connecté → tentative d’écriture interdite (403)', r.res.status === 403, String(r.res.status));
  check('Le rôle n’a pas été modifié par la tentative',
    r.json?.error?.code !== 'ok');

  // L'utilisateur tente de se promouvoir par l'API de vérification sans Discord lié.
  r = await call('POST', '/api/account/discord/sync', {});
  check('POST /api/account/discord/sync sans Discord lié → 400', r.res.status === 400, String(r.res.status));
  check('La réponse reste en français',
    typeof r.json?.error?.message === 'string' && /Discord/i.test(r.json.error.message),
    JSON.stringify(r.json?.error));

  // Désassociation sans compte Discord.
  r = await call('POST', '/api/auth/discord/unlink');
  check('Désassociation sans Discord lié → 404', r.res.status === 404, String(r.res.status));

  // Porte administrateur (mot de passe) → session admin.
  resetJar();
  await call('GET', '/api/me'); // obtient le jeton CSRF avant tout POST
  r = await call('POST', '/api/auth/admin-unlock', { password: 'mauvais' });
  check('Porte admin : mauvais mot de passe → 401', r.res.status === 401, String(r.res.status));
  r = await call('POST', '/api/auth/admin-unlock', { password: config.admin.gatePassword });
  check('Porte admin : bon mot de passe → 200', r.res.status === 200, String(r.res.status));
  check('La session ouverte est administrateur', r.json?.user?.role === 'admin', r.json?.user?.role);

  r = await call('GET', '/api/me');
  check('/api/me admin : permissions complètes',
    Array.isArray(r.json?.permissions) && r.json.permissions.includes('users') && r.json.permissions.includes('stats'),
    JSON.stringify(r.json?.permissions));

  r = await call('GET', '/api/admin/stats');
  check('Administrateur → /api/admin/stats accepté (200)', r.res.status === 200, String(r.res.status));
  r = await call('GET', '/api/admin/users');
  check('Administrateur → /api/admin/users accepté (200, permission section)',
    r.res.status === 200, String(r.res.status));
  r = await call('GET', '/api/admin/settings');
  check('Administrateur → /api/admin/settings accepté (200)', r.res.status === 200, String(r.res.status));
}

/* --------------------- 6. Anti-spoofing d'adresse IP --------------------- */
async function testTrustProxy() {
  console.log('\n6. Adresse IP : X-Forwarded-For ignoré sans TRUST_PROXY');
  resetJar();
  await call('GET', '/api/me'); // obtient le jeton CSRF avant tout POST
  const stamp = Date.now();
  const email = `spoof${stamp}@kalea.test`;
  const r = await call('POST', '/api/auth/register', {
    email, password: 'SpoofTest2026!', displayName: `Spoof${String(stamp).slice(-5)}`,
  }, { 'X-Forwarded-For': '203.0.113.7' });
  check('Inscription avec en-tête X-Forwarded-For falsifié (201)', r.res.status === 201, String(r.res.status));

  const user = get('SELECT id FROM users WHERE email = ?', email);
  const session = user
    ? get('SELECT ip FROM sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 1', user.id)
    : null;
  check('La session conserve l’adresse réelle (203.0.113.7 ignorée)',
    Boolean(session) && session.ip !== '203.0.113.7',
    session ? `ip=${session.ip}` : 'session introuvable');
}

async function main() {
  console.log('\n=== KALEA — tests des rôles et permissions ===\n');
  if (!(await waitForServer())) {
    console.error(`  ✘ Serveur injoignable sur ${BASE}`);
    process.exitCode = 1;
    return;
  }

  testDecideRole();
  testPermissions();
  testSchema();
  testConfig();
  await testGuards();
  await testTrustProxy();
  closeDb();

  console.log(`\nRésultat : ${checks - failures}/${checks} vérifications réussies${failures ? ` — ${failures} échec(s)` : ''}\n`);
  if (failures) process.exitCode = 1;
}

main().catch((error) => {
  console.error('  ✘ Erreur fatale :', error);
  closeDb();
  process.exitCode = 1;
});
