/**
 * KALEA — tests du panier (commande multi-articles, une seule livraison).
 *
 *   node tools/test-cart.mjs
 *
 *  1. panier de 2 packs → 1 commande, montant total calculé côté serveur ;
 *  2. articles exposés dans /api/orders ;
 *  3. paiement → livraison des 2 packs (étapes suffixées par pack) ;
 *  4. idempotence du panier (pas de doublon en attente) ;
 *  5. garde-fous : quantité > 1 et panier vide refusés (messages français) ;
 *  6. achat direct d'un pack → clés d'étapes historiques inchangées ;
 *  7. remboursement admin → les deux packs sont révoqués.
 */
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

const frError = (r) => typeof r.json?.error?.message === 'string' && r.json.error.message.length > 0;

async function main() {
  console.log('\n=== KALEA — tests du panier ===\n');
  if (!(await waitForServer())) {
    console.error(`  ✘ Serveur injoignable sur ${BASE}`);
    process.exitCode = 1;
    return;
  }
  await call('GET', '/api/me'); // pose le jeton CSRF avant le premier POST

  // Compte de test.
  const stamp = Date.now();
  const email = `panier${stamp}@kalea.test`;
  let r = await call('POST', '/api/auth/register', {
    email, password: 'PanierTest2026!', displayName: `Panier${String(stamp).slice(-5)}`,
  });
  check('Inscription du compte de test (201)', r.res.status === 201, String(r.res.status));

  // Catalogue.
  r = await call('GET', '/api/packs');
  const packs = (r.json?.packs ?? []).filter((p) => p.active);
  check(`Catalogue chargé (${packs.length} packs actifs)`, packs.length >= 2);
  if (packs.length < 2) throw new Error('Deux packs actifs sont nécessaires.');
  const [a, b] = packs;
  const expected = a.priceCents + b.priceCents;

  /* 1. Panier de deux packs. */
  r = await call('POST', '/api/orders', { items: [{ packId: a.id }, { packId: b.id }] });
  check('Panier de 2 packs → commande créée (201)', r.res.status === 201, `${r.res.status} ${r.text.slice(0, 160)}`);
  const cartOrder = r.json?.order;
  if (!cartOrder) {
    console.log(`\nRésultat : commande de panier introuvable — arrêt anticipé.\n`);
    process.exitCode = 1;
    return;
  }
  check('Montant total calculé côté serveur', cartOrder?.amountCents === expected,
    `${cartOrder?.amountCents} ≠ ${expected}`);
  check('La commande expose ses articles', Array.isArray(cartOrder?.items) && cartOrder.items.length === 2,
    JSON.stringify(cartOrder?.items));
  check('Chaque article porte son pack', Boolean(cartOrder?.items?.find((i) => i.packId === a.id))
    && Boolean(cartOrder?.items?.find((i) => i.packId === b.id)));

  /* 2. Idempotence : même panier en attente → même commande. */
  r = await call('POST', '/api/orders', { items: [{ packId: b.id }, { packId: a.id }] });
  check('Même panier (ordre inversé) → même commande (anti-doublon)',
    Boolean(cartOrder) && r.json?.order?.id === cartOrder.id,
    `${r.json?.order?.id ?? 'aucune'} ≠ ${cartOrder?.id ?? 'aucune'}`);

  /* 3. Garde-fous. */
  r = await call('POST', '/api/orders', { items: [{ packId: a.id, qty: 2 }] });
  check('Quantité > 1 refusée (400)', r.res.status === 400, String(r.res.status));
  check('Message français pour la quantité', /une seule fois/i.test(r.json?.error?.message ?? ''), r.text.slice(0, 120));
  r = await call('POST', '/api/orders', { items: [] });
  check('Panier vide refusé (400)', r.res.status === 400, String(r.res.status));
  r = await call('POST', '/api/orders', { items: [{ packId: 'pack_inexistant' }] });
  check('Pack introuvable refusé (404)', r.res.status === 404, String(r.res.status));

  /* 4. Paiement → livraison des deux articles. */
  r = await call('POST', `/api/demo/orders/${cartOrder.id}/pay`, { outcome: 'succeeded' });
  check('Paiement démo accepté (200)', r.res.status === 200, r.text.slice(0, 160));
  check('Commande payée', r.json?.status === 'paid', r.json?.status);

  r = await call('GET', `/api/orders/${cartOrder.id}`);
  const delivery = r.json?.order?.delivery;
  check('Livraison enregistrée', Boolean(delivery), JSON.stringify(delivery));
  const keys = (delivery?.steps ?? []).map((s) => s.key);
  check(`Étapes par article (suffixées) : ${keys.join(', ')}`,
    keys.some((k) => k.startsWith('activation:')) && keys.some((k) => k.startsWith('discord_role:')),
    keys.join(','));
  check('Aucune étape en échec',
    (delivery?.steps ?? []).every((s) => !['failed'].includes(s.status)),
    JSON.stringify((delivery?.steps ?? []).filter((s) => s.status === 'failed')));

  r = await call('GET', '/api/account/overview');
  const owned = new Set((r.json?.packs ?? []).map((p) => p.id));
  check('Les 2 packs sont actifs sur le compte', owned.has(a.id) && owned.has(b.id),
    JSON.stringify([...owned]));
  const orderPackIds = (r.json?.orders ?? []).find((o) => o.id === cartOrder.id)?.items?.map((i) => i.packId) ?? [];
  check('Historique : commande multi-articles lisible', orderPackIds.length === 2, JSON.stringify(orderPackIds));

  /* 5. Achat direct (chemin historique) : clés d'étapes inchangées. */
  const other = packs[2] ?? packs[0];
  r = await call('POST', '/api/orders', { packId: other.id });
  check('Achat direct d’un pack (201)', r.res.status === 201, r.text.slice(0, 160));
  const singleOrder = r.json?.order;
  check('Commande simple : un seul article', singleOrder?.items?.length === 1,
    JSON.stringify(singleOrder?.items));
  r = await call('POST', `/api/demo/orders/${singleOrder.id}/pay`, { outcome: 'succeeded' });
  check('Paiement du pack simple (200)', r.res.status === 200, r.text.slice(0, 160));
  r = await call('GET', `/api/orders/${singleOrder.id}`);
  const singleKeys = (r.json?.order?.delivery?.steps ?? []).map((s) => s.key);
  check(`Commande simple : clés historiques (${singleKeys.join(', ')})`,
    singleKeys.includes('activation') && !singleKeys.some((k) => k.startsWith('activation:')),
    singleKeys.join(','));

  /* 6. Remboursement admin → les deux packs du panier sont révoqués. */
  jar.clear();
  await call('GET', '/api/me'); // jeton CSRF
  r = await call('POST', '/api/auth/admin-unlock', { password: process.env.ADMIN_GATE_PASSWORD ?? 'kalea2K26Fn' });
  check('Porte administrateur ouverte (200)', r.res.status === 200, r.text.slice(0, 160));
  r = await call('POST', `/api/admin/orders/${cartOrder.id}/refund`, { reason: 'Test panier' });
  check('Remboursement accepté (200)', r.res.status === 200, r.text.slice(0, 200));

  // Retour au compte joueur pour vérifier la révocation.
  jar.clear();
  await call('GET', '/api/me');
  r = await call('POST', '/api/auth/login', { email, password: 'PanierTest2026!' });
  check('Reconnexion au compte joueur (200)', r.res.status === 200, r.text.slice(0, 160));
  r = await call('GET', '/api/account/overview');
  const authenticated = r.res.status === 200 && Array.isArray(r.json?.packs);
  const stillOwned = new Set((r.json?.packs ?? []).map((p) => p.id));
  check('Remboursement → les 2 packs retirés du compte',
    authenticated && !stillOwned.has(a.id) && !stillOwned.has(b.id),
    authenticated ? JSON.stringify([...stillOwned]) : `session absente (${r.res.status})`);

  console.log(`\nRésultat : ${checks - failures}/${checks} vérifications réussies${failures ? ` — ${failures} échec(s)` : ''}\n`);
  if (failures) process.exitCode = 1;
}

main().catch((error) => {
  console.error('  ✘ Erreur fatale :', error);
  process.exitCode = 1;
});
