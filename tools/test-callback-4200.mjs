/**
 * KALEA — vérifie que l'URI enregistrée chez Discord (http://localhost:4200/callback)
 * atteint bien le site : port d'écoute actif + redirections correctes.
 * Lancement : node tools/test-callback-4200.mjs
 */
const MAIN = process.env.MAIN_URL ?? 'http://localhost:4000';
const CB = process.env.CALLBACK_URL ?? 'http://localhost:4200';
let ko = 0;
const check = (label, ok, detail) => {
  console.log(`  ${ok ? '✔' : '✘'} ${label}${ok ? '' : ` → ${detail}`}`);
  if (!ok) ko += 1;
};

const oauth = (state) => `kalea_oauth=${encodeURIComponent(JSON.stringify({ state, returnTo: '/mon-compte' }))}`;

async function call(base, path, cookie) {
  try {
    const res = await fetch(`${base}${path}`, {
      headers: cookie ? { Cookie: cookie } : {},
      redirect: 'manual',
    });
    return { status: res.status, location: res.headers.get('location') ?? '' };
  } catch (error) {
    return { status: 0, location: error.message };
  }
}

console.log('=== Callback Discord sur localhost:4200 ===');

// 1. Les deux ports répondent.
const healthMain = await call(MAIN, '/api/health');
const healthCb = await call(CB, '/api/health');
check('site joignable sur :4000', healthMain.status === 200, `status=${healthMain.status}`);
check('écouteur de callback actif sur :4200', healthCb.status === 200, `status=${healthCb.status} ${healthCb.location}`);

// 2. L'URI Discord /callback exécute réellement la route OAuth.
const cases = [
  ['sans cookie → message français', null, 'state=x', 'session Discord a expiré'],
  ['state falsifié (CSRF) bloqué', oauth('abc'), 'state=autre', 'vérification de sécurité'],
  ['refus utilisateur géré', oauth('abc'), 'state=abc&error=access_denied', 'refusé'],
  ['secret manquant signalé', oauth('abc'), 'state=abc', 'non configurée'],
];
for (const [label, cookie, query, attendu] of cases) {
  const { status, location } = await call(CB, `/callback?${query}`, cookie);
  const decoded = decodeURIComponent(location);
  const ok = status === 302 && decoded.startsWith(`${MAIN}/connexion?error=`) && decoded.includes(attendu);
  check(label, ok, `status=${status} location=${location}`);
}

// 3. La route d'API équivalente fonctionne aussi (double alias).
const api = await call(MAIN, '/api/auth/discord/callback?state=x');
check('alias /api/auth/discord/callback actif', api.status === 302 && decodeURIComponent(api.location).includes('expiré'), `status=${api.status}`);

// 4. Le bouton « Se connecter avec Discord » renvoie une URL de consentement.
const start = await call(MAIN, '/api/auth/discord?return=/mon-compte');
check('démarrage OAuth disponible', start.status === 302 && start.location.length > 0, `status=${start.status}`);

console.log(ko === 0 ? '\n✔ localhost:4200/callback opérationnel.' : `\n✘ ${ko} échec(s).`);
process.exitCode = ko === 0 ? 0 : 1;
