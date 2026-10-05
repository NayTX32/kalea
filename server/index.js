/**
 * KALEA — point d'entrée du serveur.
 *   node server/index.js
 * Zéro dépendance externe : Node.js >= 22.5 (node:sqlite inclus).
 */
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { config } from './config.js';
import { getDb, closeDb } from './db.js';
import { seed } from './services/seed.js';
import { buildRouter, securityHeaders } from './routes/index.js';
import { createServer } from './lib/http.js';
import { pruneSessions } from './middleware/session.js';
import { log } from './lib/logger.js';
import { paymentsStatus } from './services/payments/index.js';
import { discordStatus } from './services/discord.js';
import { gameStatus } from './services/gameapi.js';

/**
 * Empreinte des fichiers statiques : injectée dans l'URL des assets
 * (/__a/<empreinte>/assets/…) pour qu'un déploiement ne soit jamais lu
 * depuis un cache de navigateur périmé.
 */
function computeAssetVersion() {
  if (process.env.ASSET_VERSION) return process.env.ASSET_VERSION;
  const hash = createHash('sha1');
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else {
        try {
          const stat = fs.statSync(full);
          hash.update(`${entry.name}:${stat.size}:${Math.round(stat.mtimeMs)};`);
        } catch { /* fichier disparu pendant le scan */ }
      }
    }
  };
  try { walk(path.join(config.root, 'public')); } catch { hash.update(String(Date.now())); }
  return hash.digest('hex').slice(0, 12);
}

// 1. Base de données + données initiales.
getDb();
seed();

// 2. Routes + serveur HTTP.
const router = buildRouter();
const handler = createServer({
  router,
  assetVersion: computeAssetVersion(),
  publicDir: path.join(config.root, 'public'),
  securityHeaders,
  onRequest: (ctx) => {
    if (ctx.path.startsWith('/api/')) {
      const ms = Date.now() - ctx.startedAt;
      const level = ctx.statusCode >= 500 ? 'error' : ctx.statusCode >= 400 ? 'warn' : 'info';
      log[level]('http', {
        method: ctx.method,
        path: ctx.path,
        status: ctx.statusCode,
        ms,
        user: ctx.user?.id ?? null,
        ip: ctx.ip,
      });
    }
  },
});

const server = http.createServer(handler);
await new Promise((resolve, reject) => {
  const onError = (error) => reject(error);
  server.once('error', onError);
  server.listen(config.port, '0.0.0.0', () => {
    server.off('error', onError);
    resolve();
  });
}).catch((error) => {
  log.error('server_start_failed', { error: error.message, port: config.port });
  throw error;
});

// 3. Tâches de fond.
pruneSessions();
const sweeper = setInterval(() => {
  try { pruneSessions(); } catch { /* rien */ }
}, 15 * 60_000);
sweeper.unref?.();

/* ----------------------------- Bannière ----------------------------- */
const payments = paymentsStatus();
const discord = discordStatus();
const game = gameStatus();
const line = (label, value, ok = true) => `  │  ${label.padEnd(22)}${String(value).padEnd(39)}${ok ? '' : ''} │`;

console.log('');
console.log('  ╔═══════════════════════════════════════════════════════════════╗');
console.log('  ║                                                               ║');
console.log('  ║   ██  ██  ███████ ██   ██ ██    ██                            ║');
console.log('  ║   ██  ██  ██      ██  ██  ██   ██                             ║');
console.log('  ║   ██████  █████   █████   ██   ██                             ║');
console.log('  ║   ██  ██  ██      ██  ██  ██   ██                             ║');
console.log('  ║   ██  ██  ███████ ██   ██ ██████                              ║');
console.log('  ║                                                               ║');
console.log('  ║   Boutique officielle — serveur démarré                       ║');
console.log('  ╠═══════════════════════════════════════════════════════════════╣');
console.log(line('Site', `http://localhost:${config.port}`, true));
console.log(line('Paiement', `${payments.active.toUpperCase()}${payments.demo ? '  (mode démo)' : ''}`));
console.log(line('Discord OAuth', discord.oauth ? 'configuré' : 'non configuré', discord.oauth));
console.log(line('Bot Discord', discord.bot ? 'configuré' : 'non configuré', discord.bot));
console.log(line('API du jeu', game.configured ? game.url : 'non configurée', game.configured));
console.log(line('Base de données', path.relative(config.root, config.dbFile)));
console.log(line('Environnement', config.nodeEnv));
console.log('  ╚═══════════════════════════════════════════════════════════════╝');
console.log('');

log.info('server_started', { port: config.port, provider: payments.active, env: config.nodeEnv });

/* --------------------------- Arrêt propre --------------------------- */
const shutdown = () => {
  log.info('server_stopping');
  clearInterval(sweeper);
  server.close(() => {
    closeDb();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 3000).unref?.();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('unhandledRejection', (reason) => log.error('unhandled_rejection', { reason: String(reason) }));
process.on('uncaughtException', (error) => log.error('uncaught_exception', { error: error.message, stack: error.stack }));
