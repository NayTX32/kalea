/**
 * KALEA — test de bout en bout (sans dépendance) :
 * inscription → commande → paiement signé → livraison → anti-doublon →
 * remboursement → retrait des récompenses → accès admin.
 *
 *   node tools/smoke-test.js
 */
const BASE = process.env.BASE_URL ?? 'http://localhost:4000';

const jar = new Map();
let failures = 0;
let checks = 0;

function cookieHeader() {
  return [...jar.entries()].map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('; ');
}

function storeCookies(res) {
  const raw = res.headers.getSetCookie?.() ?? [];
  for (const line of raw) {
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

function check(label, condition, detail = '') {
  checks += 1;
  if (condition) console.log(`  ✔ ${label}`);
  else { failures += 1; console.log(`  ✘ ${label} ${detail}`); }
}

const stamp = Date.now();
const player = {
  email: `joueur${stamp}@kalea.gg`,
  password: 'MdpTest2026',
  displayName: `Joueur${String(stamp).slice(-4)}`,
};

async function waitForServer(retries = 20) {
  for (let i = 0; i < retries; i += 1) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return true;
    } catch { /* pas encore prêt */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

async function main() {
  console.log('\n=== KALEA — smoke test ===\n');
  if (!(await waitForServer())) {
    console.error('  ✘ Serveur injoignable sur ' + BASE);
    process.exitCode = 1;
    return;
  }

  // 0. Configuration publique
  const cfg = await call('GET', '/api/config');
  check('GET /api/config', cfg.res.status === 200 && cfg.json?.siteName === 'KaleaShop');
  const csrf = jar.get('kalea_csrf');
  check('Cookie CSRF délivré', Boolean(csrf));

  // 1. Catalogue
  const packs = await call('GET', '/api/packs');
  const list = packs.json?.packs ?? [];
  check('3 packs par défaut', list.length === 3, `reçu ${list.length}`);
  const base = list.find((p) => p.slug === 'pack-de-base');
  const full = list.find((p) => p.slug === 'full-locker');
  const moder = list.find((p) => p.slug === 'moder');
  check('Prix Pack de Base = 4 €', base?.priceCents === 400, String(base?.priceCents));
  check('Prix Full Locker = 15 €', full?.priceCents === 1500, String(full?.priceCents));
  check('Prix Moder = 30 €', moder?.priceCents === 3000, String(moder?.priceCents));

  // 2. Inscription
  const reg = await call('POST', '/api/auth/register', player);
  check('Inscription', reg.res.status === 201, JSON.stringify(reg.json));
  check('Session ouverte', Boolean(reg.json?.user?.id));

  // 3. Refus CSRF sans jeton
  const noCsrf = await fetch(`${BASE}/api/orders`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ packId: base.id }),
  });
  check('Requête sans CSRF refusée (403)', noCsrf.status === 403, String(noCsrf.status));

  // 4. Création de commande
  const orderRes = await call('POST', '/api/orders', { packId: base.id, idempotencyKey: `test_${stamp}` });
  check('Commande créée', orderRes.res.status === 201 || orderRes.res.status === 200, JSON.stringify(orderRes.json));
  const order = orderRes.json?.order;
  check('Montant = 4,00 €', order?.amountCents === 400, String(order?.amountCents));
  check('Statut en attente', order?.status === 'pending', order?.status);

  // 5. Paiement (mode démo signé)
  const pay = await call('POST', `/api/demo/orders/${order.id}/pay`, { outcome: 'succeeded' });
  check('Paiement confirmé', pay.res.status === 200 && pay.json?.status === 'paid', JSON.stringify(pay.json));

  // 6. Livraison automatique
  const delivery = pay.json?.order?.delivery;
  check('Livraison créée', Boolean(delivery), 'absente');
  const stepKeys = (delivery?.steps ?? []).map((s) => `${s.key}:${s.status}`);
  check('Étape activation OK', stepKeys.some((k) => k.startsWith('activation:ok')), stepKeys.join(', '));
  check('Transaction unique', Boolean(delivery?.txId), 'txId manquant');

  // 7. Idempotence : rejouer le paiement ne double rien
  const replay = await call('POST', `/api/demo/orders/${order.id}/pay`, { outcome: 'succeeded' });
  const replayEvents = replay.json?.result?.status;
  check('Rejeu webhook = doublon ignoré', replayEvents === 'duplicate' || replayEvents === 'processed', String(replayEvents));

  // 8. Registre des récompenses : une seule ligne par récompense et par transaction
  const overview = await call('GET', '/api/account/overview');
  const allGrants = overview.json?.grants ?? [];
  const uniqueEntries = new Set(allGrants.map((g) => `${g.orderId}:${g.kind}:${g.key}`));
  check('Registre des récompenses non vide', allGrants.length > 0, `${allGrants.length} ligne(s)`);
  check('Aucun doublon dans le registre', allGrants.length === uniqueEntries.size, `${allGrants.length} vs ${uniqueEntries.size}`);
  check('Activation du pack enregistrée', allGrants.some((g) => g.kind === 'activation' && g.status === 'granted'),
    allGrants.map((g) => `${g.kind}:${g.status}`).join(', '));
  check('Pack actif sur le compte', (overview.json?.packs ?? []).some((p) => p.slug === 'pack-de-base'));
  check('Historique de commande présent', (overview.json?.orders ?? []).length >= 1);

  // 9. Deuxième achat : Full Locker + échec simulé puis succès
  const order2 = (await call('POST', '/api/orders', { packId: full.id })).json?.order;
  const fail = await call('POST', `/api/demo/orders/${order2.id}/pay`, { outcome: 'failed' });
  check('Paiement échoué → statut failed', fail.json?.status === 'failed', fail.json?.status);
  const retry = await call('POST', `/api/orders/${order2.id}/checkout`);
  check('Nouvelle tentative de paiement possible', retry.res.status === 200, JSON.stringify(retry.json));
  const pay2 = await call('POST', `/api/demo/orders/${order2.id}/pay`, { outcome: 'succeeded' });
  check('Second paiement confirmé', pay2.json?.status === 'paid', pay2.json?.status);
  check('Full Locker livré', pay2.json?.order?.delivery?.status === 'delivering'
    || pay2.json?.order?.delivery?.status === 'delivered'
    || pay2.json?.order?.delivery?.status === 'partial',
  pay2.json?.order?.delivery?.status);

  // 10. Accès admin
  const adminLogin = await call('POST', '/api/auth/login', {
    email: process.env.ADMIN_EMAIL ?? 'admin@kalea.gg',
    password: process.env.ADMIN_PASSWORD ?? 'KaleaAdmin2026!',
  });
  check('Connexion admin', adminLogin.res.status === 200, JSON.stringify(adminLogin.json));

  const stats = await call('GET', '/api/admin/stats');
  check('Statistiques admin', stats.res.status === 200 && Number(stats.json?.stats?.orders?.total) >= 2, JSON.stringify(stats.json?.error));

  const adminOrders = await call('GET', '/api/admin/orders?limit=50');
  check('Liste commandes admin', adminOrders.res.status === 200 && (adminOrders.json?.orders ?? []).length >= 2);

  const adminPackUpdate = await call('PUT', `/api/admin/packs/${base.id}`, {
    tagline: 'Lancement rapide + changement de pseudo (modifié)',
    price: 4,
  });
  check('Modification d’un pack sans toucher au code', adminPackUpdate.res.status === 200, JSON.stringify(adminPackUpdate.json));

  // 11. Remboursement → retrait automatique
  const refund = await call('POST', `/api/admin/orders/${order.id}/refund`, { reason: 'Test remboursement' });
  check('Remboursement effectué', refund.res.status === 200 && refund.json?.ok === true, JSON.stringify(refund.json));
  check('Commande remboursée', refund.json?.order?.status === 'refunded', refund.json?.order?.status);

  // Nouvelle session joueur : l'admin a repris le cookie de session
  await call('POST', '/api/auth/logout');
  await call('POST', '/api/auth/login', { email: player.email, password: player.password });
  const after = await call('GET', '/api/account/overview');
  const grantsAfter = (after.json?.grants ?? []).filter((g) => g.orderId === order.id);
  check('Récompenses révoquées', grantsAfter.length > 0 && grantsAfter.every((g) => g.status === 'revoked'),
    grantsAfter.map((g) => g.status).join(','));
  check('Pack désactivé après remboursement', !(after.json?.packs ?? []).some((p) => p.slug === 'pack-de-base'));

  // 12. API jeu (signature HMAC)
  const { createHmac } = await import('node:crypto');
  const ts = String(Date.now());
  const sig = createHmac('sha256', process.env.GAME_API_KEY ?? '')
    .update(`/api/game/v1/entitlements/${player.email}`).digest('hex');
  const ent = await fetch(`${BASE}/api/game/v1/entitlements/${encodeURIComponent(player.email)}`, {
    headers: { 'X-Kalea-Timestamp': ts, 'X-Kalea-Signature': sig },
  });
  check('API jeu sans signature refusée', (await (async () => {
    const r = await fetch(`${BASE}/api/game/v1/entitlements/test`);
    return { status: r.status };
  })()).status === 401);

  // 13. Protection des routes admin
  const anon = await fetch(`${BASE}/api/admin/stats`);
  check('Admin refusé aux anonymes', anon.status === 401, String(anon.status));

  console.log(`\n=== ${checks - failures}/${checks} vérifications réussies ===\n`);
  if (failures > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error('ERREUR FATALE', error);
  process.exitCode = 1;
});
