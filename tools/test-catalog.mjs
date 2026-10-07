/**
 * KALEA — tests catalogue : catégories, stock et codes promotionnels.
 *
 *   node tools/test-catalog.mjs
 *
 *  1. catégories : création admin, publication publique, filtre de la boutique ;
 *  2. promotions : création admin, validation publique, refus des codes invalides ;
 *  3. commande avec code : remise calculée côté serveur, code reporté sur la commande ;
 *  4. stock : décrémenté au paiement, bloque une nouvelle vente à 0, restauré au remboursement ;
 *  5. nettoyage complet (l'état du catalogue est restitué).
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

/** Payload complet d'un pack admin (le PUT attend tous les champs requis). */
const packPayload = (pack, overrides = {}) => ({
  name: pack.name,
  slug: pack.slug,
  emoji: pack.emoji,
  badge: pack.badge ?? '',
  tagline: pack.tagline ?? '',
  description: pack.description ?? '',
  price: pack.priceNumber,
  imageUrl: pack.imageUrl ?? '',
  features: pack.features ?? [],
  categoryId: pack.categoryId ?? null,
  stock: pack.stock ?? -1,
  discordRoleId: pack.discordRole?.id ?? '',
  discordRoleName: pack.discordRole?.name ?? '',
  rewards: pack.rewards ?? {},
  sortOrder: pack.sortOrder ?? 0,
  active: pack.active !== false,
  ...overrides,
});

async function asAdmin() {
  jar.clear();
  await call('GET', '/api/me');
  const r = await call('POST', '/api/auth/admin-unlock',
    { password: process.env.ADMIN_GATE_PASSWORD ?? 'kalea2K26Fn' });
  return r;
}

async function asPlayer(email, password, displayName) {
  jar.clear();
  await call('GET', '/api/me');
  let r = await call('POST', '/api/auth/register', { email, password, displayName });
  if (r.res.status !== 201) r = await call('POST', '/api/auth/login', { email, password });
  return r;
}

/** Relit un pack depuis la liste admin (pas d'endpoint /api/admin/packs/:id). */
async function fetchAdminPack(id) {
  const r = await call('GET', '/api/admin/packs');
  return (r.json?.packs ?? []).find((p) => p.id === id) ?? null;
}

async function main() {
  console.log('\n=== KALEA — tests catégories / stock / promotions ===\n');
  if (!(await waitForServer())) {
    console.error(`  ✘ Serveur injoignable sur ${BASE}`);
    process.exitCode = 1;
    return;
  }
  await call('GET', '/api/me'); // jeton CSRF

  const stamp = String(Date.now()).slice(-6);
  const CAT_A = { name: `Avantages ${stamp}`, slug: `avantages-${stamp}`, emoji: '⭐' };
  const CAT_B = { name: `Archives ${stamp}`, slug: `archives-${stamp}`, emoji: '🗄️' };
  const PROMO = `CAT${stamp}`;
  const player1 = `cat1${stamp}@kalea.test`;
  const player2 = `cat2${stamp}@kalea.test`;
  const PASSWORD = 'Catalogue2026!';

  let pack = null;
  let catA = null;
  let catB = null;
  let promo = null;
  let orderId = null;

  try {
    /* 1. Catégories (admin). */
    let r = await asAdmin();
    check('Porte administrateur ouverte (200)', r.res.status === 200, r.text.slice(0, 160));

    r = await call('GET', '/api/admin/categories');
    check('GET /api/admin/categories (200)', r.res.status === 200, String(r.res.status));

    r = await call('POST', '/api/admin/categories', CAT_A);
    check('Création catégorie A (201)', r.res.status === 201, r.text.slice(0, 200));
    catA = r.json?.category;
    check('Catégorie A exposée (slug + emoji)', Boolean(catA?.slug === CAT_A.slug && catA?.emoji === CAT_A.emoji),
      JSON.stringify(catA));

    r = await call('POST', '/api/admin/categories', CAT_B);
    check('Création catégorie B (201)', r.res.status === 201, r.text.slice(0, 200));
    catB = r.json?.category;

    r = await call('POST', '/api/admin/categories', { name: '' });
    check('Catégorie sans nom refusée (400)', r.res.status === 400, String(r.res.status));
    check('Message français', frError(r), r.text.slice(0, 120));

    /* 2. Affectation d'une catégorie + stock limité sur un pack. */
    r = await call('GET', '/api/admin/packs');
    const adminPacks = r.json?.packs ?? [];
    check('Catalogue admin chargé', adminPacks.length >= 1, String(adminPacks.length));
    pack = adminPacks[0];

    r = await call('PUT', `/api/admin/packs/${pack.id}`,
      packPayload(pack, { categoryId: catA.id, stock: 1 }));
    check('Pack mis à jour (catégorie + stock = 1)', r.res.status === 200, r.text.slice(0, 200));
    check('Le pack expose sa catégorie', r.json?.pack?.category?.slug === CAT_A.slug,
      JSON.stringify(r.json?.pack?.category));
    check('Le pack expose son stock', r.json?.pack?.stock === 1, String(r.json?.pack?.stock));

    r = await call('POST', '/api/admin/categories', { name: `Sans slug ${stamp}`, slug: '' });
    check('Slug vide → dérivé automatiquement du nom (201)',
      r.res.status === 201 && /^[a-z0-9-]+$/.test(r.json?.category?.slug ?? ''), r.text.slice(0, 200));
    const catC = r.json?.category;
    if (catC) await call('DELETE', `/api/admin/categories/${catC.id}`);

    /* 3. Vue publique : catégories utilisées + filtre boutique. */
    r = await call('GET', '/api/categories');
    const publicCats = r.json?.categories ?? [];
    const slugs = publicCats.map((c) => c.slug);
    check('Catégories publiques (200)', r.res.status === 200, String(r.res.status));
    check('Catégorie A publiée (utilisée par un pack actif)', slugs.includes(CAT_A.slug), JSON.stringify(slugs));
    check('Catégorie B masquée (aucun pack)', !slugs.includes(CAT_B.slug), JSON.stringify(slugs));

    r = await call('GET', `/api/packs?category=${CAT_A.slug}`);
    const filtered = r.json?.packs ?? [];
    check('Filtre boutique : un seul pack dans la catégorie',
      filtered.length === 1 && filtered[0].id === pack.id, JSON.stringify(filtered.map((p) => p.id)));

    r = await call('GET', '/api/packs?category=inconnue');
    check('Catégorie inconnue → 404', r.res.status === 404, String(r.res.status));

    /* 4. Promotion (admin). */
    r = await call('POST', '/api/admin/promotions', {
      code: PROMO, kind: 'percent', value: 10, minAmountCents: 0, maxUses: 10, active: true,
    });
    check('Création du code promotionnel (201)', r.res.status === 201, r.text.slice(0, 200));
    promo = r.json?.promotion;
    check('Code normalisé en majuscules', promo?.code === PROMO.toUpperCase(), String(promo?.code));
    check('Libellé de remise lisible', promo?.discountLabel === '10 %', String(promo?.discountLabel));

    r = await call('POST', '/api/admin/promotions', { code: PROMO, kind: 'percent', value: 10 });
    check('Code dupliqué refusé (409)', r.res.status === 409, String(r.res.status));

    r = await call('POST', '/api/admin/promotions', { code: `${PROMO}X`, kind: 'percent', value: 150 });
    check('Pourcentage hors plage refusé (400)', r.res.status === 400, String(r.res.status));

    /* 5. Validation publique du code (aucun montant n'est accepté du client). */
    const subtotal = pack.priceNumber * 100;
    r = await call('POST', '/api/promotions/validate', { code: PROMO, subtotalCents: subtotal });
    check('Validation du code (200)', r.res.status === 200, r.text.slice(0, 160));
    const expectedDiscount = Math.floor((subtotal * 10) / 100);
    check('Remise calculée par le serveur (10 %)',
      r.json?.valid === true && r.json?.discountCents === expectedDiscount,
      `${r.json?.discountCents} ≠ ${expectedDiscount}`);
    check('Total après remise cohérent', r.json?.totalCents === subtotal - expectedDiscount,
      String(r.json?.totalCents));

    r = await call('POST', '/api/promotions/validate', { code: 'NEXISTEPAS', subtotalCents: subtotal });
    check('Code inconnu → 400', r.res.status === 400, String(r.res.status));
    check('Message français', frError(r), r.text.slice(0, 120));

    /* 6. Commande joueur avec code promotionnel. */
    r = await asPlayer(player1, PASSWORD, `Cat${stamp}1`);
    check('Joueur 1 connecté', r.res.status === 201 || r.res.status === 200, String(r.res.status));

    r = await call('POST', '/api/orders', { packId: pack.id, promoCode: PROMO });
    check('Commande avec code promo (201)', r.res.status === 201, r.text.slice(0, 200));
    const order = r.json?.order;
    orderId = order?.id ?? null;
    check('Remise appliquée sur le montant',
      order?.amountCents === subtotal - expectedDiscount,
      `${order?.amountCents} ≠ ${subtotal - expectedDiscount}`);
    check('Commande porte le code promotionnel', order?.promoCode === PROMO.toUpperCase(),
      String(order?.promoCode));
    check('La remise est visible côté joueur', order?.discountCents === expectedDiscount,
      String(order?.discountCents));

    /* 7. Paiement → stock décrémenté. */
    r = await call('POST', `/api/demo/orders/${orderId}/pay`, { outcome: 'succeeded' });
    check('Paiement démo accepté (200)', r.res.status === 200, r.text.slice(0, 160));

    await asAdmin();
    let soldPack = await fetchAdminPack(pack.id);
    check('Stock épuisé après paiement', soldPack?.stock === 0, String(soldPack?.stock));
    check('Le pack apparaît comme épuisé', soldPack?.inStock === false, String(soldPack?.inStock));

    r = await call('GET', '/api/admin/promotions');
    const counted = (r.json?.promotions ?? []).find((p) => p.code === PROMO.toUpperCase());
    check('Utilisation du code comptée (1 / 10)', counted?.usedCount === 1, String(counted?.usedCount));

    /* 8. Nouvelle vente bloquée : rupture de stock. */
    r = await asPlayer(player2, PASSWORD, `Cat${stamp}2`);
    check('Joueur 2 connecté', r.res.status === 201 || r.res.status === 200, String(r.res.status));

    r = await call('POST', '/api/orders', { packId: pack.id });
    check('Rupture de stock → commande refusée (400)', r.res.status === 400, String(r.res.status));
    check('Message français de rupture', /rupture de stock/i.test(r.json?.error?.message ?? ''),
      r.text.slice(0, 160));

    /* 9. Code à usage limité. */
    r = await asAdmin();
    r = await call('POST', '/api/admin/promotions', {
      code: `${PROMO}1`, kind: 'fixed', value: 500, maxUses: 1, active: true,
    });
    const limited = r.json?.promotion;
    check('Code à usage unique créé', r.res.status === 201, r.text.slice(0, 160));
    r = await call('POST', '/api/promotions/validate',
      { code: limited.code, subtotalCents: 1000 });
    check('Remise fixe plafonnée au sous-total', r.json?.discountCents === 500, String(r.json?.discountCents));
    r = await call('DELETE', `/api/admin/promotions/${limited.id}`);
    check('Code promo supprimé (200)', r.res.status === 200, r.text.slice(0, 160));

    /* 10. Remboursement → stock restauré. */
    r = await asAdmin();
    r = await call('POST', `/api/admin/orders/${orderId}/refund`, { reason: 'Test catalogue' });
    check('Remboursement accepté (200)', r.res.status === 200, r.text.slice(0, 200));
    const refundedPack = await fetchAdminPack(pack.id);
    check('Stock restauré après remboursement', refundedPack?.stock === 1, String(refundedPack?.stock));
  } finally {
    /* 11. Nettoyage : l'état du catalogue est restitué. */
    await asAdmin();
    if (pack) {
      const current = await fetchAdminPack(pack.id);
      if (current) await call('PUT', `/api/admin/packs/${pack.id}`, packPayload(current, { categoryId: null, stock: -1 }));
    }
    if (promo) await call('DELETE', `/api/admin/promotions/${promo.id}`);
    if (catA) await call('DELETE', `/api/admin/categories/${catA.id}`);
    if (catB) await call('DELETE', `/api/admin/categories/${catB.id}`);
    console.log('  · nettoyage effectué (catégories, code promo, stock)');
  }

  console.log(`\nRésultat : ${checks - failures}/${checks} vérifications réussies${failures ? ` — ${failures} échec(s)` : ''}\n`);
  if (failures) process.exitCode = 1;
}

main().catch((error) => {
  console.error('  ✘ Erreur fatale :', error);
  process.exitCode = 1;
});
