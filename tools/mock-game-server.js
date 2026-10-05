/**
 * KALEA — Serveur de jeu simulé (outil de test / démonstration).
 *
 * Il joue le rôle du serveur du jeu : il reçoit les récompenses signées
 * envoyées par KALEA, vérifie la signature HMAC et refuse les transactions
 * déjà traitées (idempotence par ID de transaction unique).
 *
 *   node tools/mock-game-server.js
 *   Puis, dans le .env de KALEA :
 *     GAME_API_URL=http://localhost:4100
 *     GAME_API_SECRET=kalea-demo-secret
 *     GAME_API_KEY=kalea-demo-key
 *     GAME_API_REQUIRED=true
 */
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.GAME_PORT ?? 4100);
const SECRET = process.env.GAME_API_SECRET ?? 'kalea-demo-secret';

/** Base simple : joueurs + transactions traitées. */
const state = { players: new Map(), transactions: new Set(), log: [] };
const STORE = path.join(ROOT, 'data', 'mock-game.json');

function loadStore() {
  try {
    if (!fs.existsSync(STORE)) return;
    const data = JSON.parse(fs.readFileSync(STORE, 'utf8'));
    for (const [id, player] of data.players ?? []) state.players.set(id, player);
    for (const tx of data.transactions ?? []) state.transactions.add(tx);
  } catch (error) {
    console.warn('Chargement du store impossible :', error.message);
  }
}
function saveStore() {
  try {
    fs.mkdirSync(path.dirname(STORE), { recursive: true });
    fs.writeFileSync(STORE, JSON.stringify({
      players: [...state.players.entries()],
      transactions: [...state.transactions],
      log: state.log.slice(-200),
    }, null, 2));
  } catch { /* rien */ }
}
loadStore();

function verify(rawBody, timestampHeader, signatureHeader) {
  const ts = Number(timestampHeader);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(Date.now() - ts) > 5 * 60_000) return false;
  const expected = crypto.createHmac('sha256', SECRET).update(`${ts}.${rawBody}`).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signatureHeader ?? ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

function grant(playerId, rewards, meta = {}) {
  const player = state.players.get(playerId) ?? { id: playerId, skins: [], items: [], permissions: [], features: [], currency: {}, profile: {} };
  const added = [];
  for (const list of ['skins', 'items', 'permissions', 'features']) {
    for (const entry of rewards[list] ?? []) {
      const id = typeof entry === 'string' ? entry : (entry.id ?? entry.name);
      if (!player[list].includes(id)) { player[list].push(id); added.push(`${list}:${id}`); }
    }
  }
  if (rewards.currency) {
    const { type = 'coins', amount = 0 } = rewards.currency;
    player.currency[type] = (player.currency[type] ?? 0) + amount;
    added.push(`currency:${type}+${amount}`);
  }
  if (rewards.profile) player.profile = { ...player.profile, ...rewards.profile };
  state.players.set(playerId, player);
  return { player, added };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const rawBody = await readBody(req);

  // Santé (sans signature)
  if (req.method === 'GET' && url.pathname === '/health') {
    return json(res, 200, { ok: true, service: 'mock-game', players: state.players.size, transactions: state.transactions.size });
  }

  if (!verify(rawBody, req.headers['x-kalea-timestamp'], req.headers['x-kalea-signature'])) {
    console.warn('❌ Signature invalide sur', url.pathname);
    return json(res, 401, { error: 'Signature invalide' });
  }

  if (req.method === 'POST' && url.pathname === '/v1/rewards/grant') {
    const payload = JSON.parse(rawBody || '{}');
    const txId = req.headers['x-kalea-tx'] || payload.transactionId;

    // Idempotence : une transaction unique ne délivre qu'une fois.
    if (state.transactions.has(txId)) {
      console.log(`↩️  Transaction déjà traitée : ${txId}`);
      return json(res, 200, { ok: true, alreadyApplied: true, transactionId: txId });
    }
    const playerId = payload.player?.id;
    if (!playerId) return json(res, 400, { error: 'player.id manquant' });

    const { player, added } = grant(playerId, payload.rewards ?? {});
    state.transactions.add(txId);
    state.log.push({ at: Date.now(), type: 'grant', txId, playerId, added });
    saveStore();
    console.log(`✅ ${added.length} récompense(s) → joueur ${playerId} (tx ${txId})`);
    return json(res, 200, { ok: true, alreadyApplied: false, transactionId: txId, granted: added, player });
  }

  if (req.method === 'POST' && url.pathname === '/v1/rewards/revoke') {
    const payload = JSON.parse(rawBody || '{}');
    const playerId = payload.player?.id;
    const player = state.players.get(playerId);
    if (player) {
      for (const list of ['skins', 'items', 'permissions', 'features']) {
        const removing = (payload.rewards[list] ?? []).map((e) => (typeof e === 'string' ? e : (e.id ?? e.name)));
        player[list] = player[list].filter((v) => !removing.includes(v));
      }
      if (payload.rewards.currency) {
        const { type = 'coins', amount = 0 } = payload.rewards.currency;
        player.currency[type] = Math.max(0, (player.currency[type] ?? 0) - amount);
      }
      state.players.set(playerId, player);
    }
    state.log.push({ at: Date.now(), type: 'revoke', playerId });
    saveStore();
    console.log(`🗑️  Récompenses retirées du joueur ${playerId}`);
    return json(res, 200, { ok: true });
  }

  if (req.method === 'GET' && url.pathname.startsWith('/players/')) {
    const playerId = decodeURIComponent(url.pathname.split('/')[2]);
    return json(res, 200, { player: state.players.get(playerId) ?? { id: playerId, skins: [], items: [], permissions: [], features: [], currency: {}, profile: {} } });
  }

  return json(res, 404, { error: 'Route inconnue' });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('  🎮 Serveur de jeu simulé KALEA');
  console.log(`  ───────────────────────────────────────────`);
  console.log(`  URL      : http://localhost:${PORT}`);
  console.log(`  Secret   : ${SECRET}`);
  console.log(`  Endpoints: POST /v1/rewards/grant, POST /v1/rewards/revoke, GET /players/:id`);
  console.log('');
  console.log('  Configurez dans le .env de KALEA :');
  console.log(`    GAME_API_URL=http://localhost:${PORT}`);
  console.log(`    GAME_API_SECRET=${SECRET}`);
  console.log('    GAME_API_KEY=kalea-demo-key');
  console.log('    GAME_API_REQUIRED=true');
  console.log('');
});
