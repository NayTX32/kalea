/**
 * KALEA — configuration serveur.
 * Lit le fichier .env (parser maison, aucune dépendance) puis expose
 * une configuration typée et validée. Les secrets ne quittent jamais
 * ce module côté serveur.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');

/** Parser .env minimal compatible "KEY=value" et commentaires. */
function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  const raw = fs.readFileSync(file, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadDotEnv(path.join(ROOT, '.env'));

const env = (key, fallback = '') => (process.env[key] ?? fallback).trim();
const num = (key, fallback) => {
  const v = Number(env(key));
  return Number.isFinite(v) && v > 0 ? v : fallback;
};
const bool = (key, fallback) => {
  const v = env(key);
  if (v === '') return fallback;
  return /^(1|true|yes|on)$/i.test(v);
};

const NODE_ENV = env('NODE_ENV', 'development');
const PORT = num('PORT', 4000);
/**
 * Second port d'écoute (défaut 4200) : c'est celui enregistré dans l'application
 * Discord (http://localhost:4200/callback). Le site reste servi sur PORT.
 * Mettre DISCORD_CALLBACK_PORT=0 pour le désactiver.
 */
const CALLBACK_PORT = Number(env('DISCORD_CALLBACK_PORT', '4200')) || 0;
const BASE_URL = env('BASE_URL', `http://localhost:${PORT}`).replace(/\/+$/, '');

/** Secret de session : fourni en prod, auto-généré en dev (invalide au redémarrage). */
function sessionSecret() {
  const provided = env('SESSION_SECRET');
  if (provided) return provided;
  if (NODE_ENV === 'production') {
    throw new Error('SESSION_SECRET est obligatoire en production. Générez-le : openssl rand -hex 32');
  }
  // Dev : secret volatile stocké sur disque pour garder les sessions au redémarrage.
  const file = path.join(ROOT, 'data', '.dev-session-secret');
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
    const secret = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(file, secret, { mode: 0o600 });
    return secret;
  } catch {
    return 'kalea-dev-only-secret';
  }
}

const stripeKey = env('STRIPE_SECRET_KEY');
const stripeConfigured = /^sk_(test|live)_/.test(stripeKey);
const paypalConfigured = Boolean(env('PAYPAL_CLIENT_ID') && env('PAYPAL_CLIENT_SECRET'));
const providerSetting = env('PAYMENT_PROVIDER', 'auto').toLowerCase();

let paymentProvider = 'demo';
if (providerSetting === 'stripe') {
  if (!stripeConfigured) throw new Error('PAYMENT_PROVIDER=stripe mais STRIPE_SECRET_KEY est vide.');
  paymentProvider = 'stripe';
} else if (providerSetting === 'paypal') {
  if (!paypalConfigured) throw new Error('PAYMENT_PROVIDER=paypal mais PAYPAL_CLIENT_ID / SECRET sont vides.');
  paymentProvider = 'paypal';
} else if (providerSetting === 'demo') {
  paymentProvider = 'demo';
} else {
  // auto : PayPal en priorité, sinon Stripe, sinon mode démo.
  paymentProvider = paypalConfigured ? 'paypal' : (stripeConfigured ? 'stripe' : 'demo');
}

/** Secret dédié aux webhooks simulés (dérivé du secret de session). */
function hmacDevSecret() {
  const base = process.env.SESSION_SECRET || process.env.PAYMENTS_DEMO_SECRET || 'kalea-demo-webhook-secret';
  return crypto.createHmac('sha256', 'kalea-demo-webhooks').update(base).digest('hex');
}

export const config = {
  nodeEnv: NODE_ENV,
  isProd: NODE_ENV === 'production',
  port: PORT,
  /** Second écouteur : reçoit la redirection Discord (…/callback). */
  callbackPort: CALLBACK_PORT,
  baseUrl: BASE_URL,
  root: ROOT,
  dataDir: path.resolve(ROOT, env('DATABASE_URL', 'data/kalea.db').includes('/') || env('DATABASE_URL', 'data/kalea.db').includes('\\')
    ? path.dirname(env('DATABASE_URL', 'data/kalea.db'))
    : 'data'),
  dbFile: path.resolve(ROOT, env('DATABASE_URL', 'data/kalea.db')),
  session: {
    secret: sessionSecret(),
    ttlMs: num('SESSION_TTL', 604800) * 1000,
    cookieName: 'kalea_session',
    csrfCookie: 'kalea_csrf',
  },
  payments: {
    provider: paymentProvider,
    configuredStripe: stripeConfigured,
    stripeSecretKey: stripeKey,
    stripeWebhookSecret: env('STRIPE_WEBHOOK_SECRET'),
    stripePublishableKey: env('STRIPE_PUBLISHABLE_KEY'),
    stripeTestMode: bool('STRIPE_TEST_MODE', true),
    paypalClientId: env('PAYPAL_CLIENT_ID'),
    paypalSecret: env('PAYPAL_CLIENT_SECRET'),
    paypalMode: env('PAYPAL_MODE', 'sandbox').toLowerCase() === 'live' ? 'live' : 'sandbox',
    get paypalConfigured() {
      return Boolean(this.paypalClientId && this.paypalSecret);
    },
    /** Secret de signature des webhooks du prestataire de démonstration. */
    demoSecret: hmacDevSecret(),
  },
  discord: {
    clientId: env('DISCORD_CLIENT_ID'),
    clientSecret: env('DISCORD_CLIENT_SECRET'),
    botToken: env('DISCORD_BOT_TOKEN'),
    guildId: env('DISCORD_GUILD_ID'),
    redirectUri: env('DISCORD_REDIRECT_URI', `${BASE_URL}/api/auth/discord/callback`),
    roleBase: env('DISCORD_ROLE_BASE'),
    roleFullLocker: env('DISCORD_ROLE_FULLLOCKER'),
    roleModer: env('DISCORD_ROLE_MODER'),
    removeOnRefund: bool('REMOVE_ROLE_ON_REFUND', true),
    get oauthConfigured() {
      return Boolean(this.clientId && this.clientSecret);
    },
    get botConfigured() {
      return Boolean(this.botToken && this.guildId);
    },
  },
  game: {
    url: env('GAME_API_URL').replace(/\/+$/, ''),
    secret: env('GAME_API_SECRET'),
    apiKey: env('GAME_API_KEY'),
    required: bool('GAME_API_REQUIRED', false),
    get outboundConfigured() {
      return Boolean(this.url && this.secret);
    },
    get inboundConfigured() {
      return Boolean(this.apiKey);
    },
  },
  admin: {
    email: env('ADMIN_EMAIL', 'admin@kalea.gg'),
    password: env('ADMIN_PASSWORD'),
    /** Mot de passe unique de la porte d'accès /admin (comparé à temps constant). */
    gatePassword: env('ADMIN_GATE_PASSWORD', 'kalea2K26Fn'),
  },
  security: {
    rateLimitEnabled: bool('RATE_LIMIT_ENABLED', true),
    rateLimitAuth: num('RATE_LIMIT_AUTH', 10),
    rateLimitApi: num('RATE_LIMIT_API', 240),
  },
};

export default config;
