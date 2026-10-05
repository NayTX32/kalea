/** Vérifie que /api/auth/discord/callback redirige toujours vers /connexion avec un message français. */
const BASE = process.env.BASE_URL ?? 'http://localhost:4000';
let ko = 0;
const check = (label, ok, detail) => {
  console.log(`  ${ok ? '✔' : '✘'} ${label}${ok ? '' : ` → ${detail}`}`);
  if (!ok) ko += 1;
};

async function call(path, cookie) {
  const res = await fetch(`${BASE}${path}`, {
    headers: cookie ? { Cookie: cookie } : {},
    redirect: 'manual',
  });
  return { status: res.status, location: res.headers.get('location') ?? '' };
}

const oauth = (state) => `kalea_oauth=${encodeURIComponent(JSON.stringify({ state, returnTo: '/mon-compte' }))}`;

const cases = [
  ['sans cookie de session OAuth', null, 'state=x', 'session Discord a expiré'],
  ['state falsifié (CSRF)', oauth('abc'), 'state=autre', 'vérification de sécurité'],
  ['utilisateur refuse l’autorisation', oauth('abc'), 'state=abc&error=access_denied', 'refusé'],
  ['code absent + secret manquant', oauth('abc'), 'state=abc', 'non configurée'],
];

console.log('=== Callback Discord OAuth2 ===');
for (const [label, cookie, query, attendu] of cases) {
  const { status, location } = await call(`/api/auth/discord/callback?${query}`, cookie);
  const ok = status === 302 && location.startsWith('/connexion?error=')
    && decodeURIComponent(location).includes(attendu);
  check(label, ok, `status=${status} location=${location}`);
}

console.log(ko === 0 ? '\n✔ Callback sécurisé : toutes les erreurs sont gérées.' : `\n✘ ${ko} échec(s).`);
process.exitCode = ko === 0 ? 0 : 1;
