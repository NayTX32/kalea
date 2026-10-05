/**
 * KALEA — accès base de données (SQLite via node:sqlite, zéro dépendance).
 * Fournit une couche fine : requêtes préparées, transactions, seeds.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id                   TEXT PRIMARY KEY,
  email                TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash        TEXT,
  display_name         TEXT NOT NULL,
  role                 TEXT NOT NULL DEFAULT 'user',
  status               TEXT NOT NULL DEFAULT 'active',
  discord_id           TEXT UNIQUE,
  discord_username     TEXT,
  discord_avatar       TEXT,
  discord_access_token TEXT,
  discord_expires_at   INTEGER,
  game_player_id       TEXT,
  locale               TEXT NOT NULL DEFAULT 'fr',
  last_login_at        INTEGER,
  created_at           INTEGER NOT NULL,
  updated_at           INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_token   TEXT NOT NULL,
  ip           TEXT,
  user_agent   TEXT,
  created_at   INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS packs (
  id               TEXT PRIMARY KEY,
  slug             TEXT NOT NULL UNIQUE,
  name             TEXT NOT NULL,
  emoji            TEXT NOT NULL DEFAULT '🎁',
  tagline          TEXT NOT NULL DEFAULT '',
  description      TEXT NOT NULL DEFAULT '',
  image_url        TEXT NOT NULL DEFAULT '',
  price_cents      INTEGER NOT NULL,
  currency         TEXT NOT NULL DEFAULT 'EUR',
  badge            TEXT NOT NULL DEFAULT '',
  features         TEXT NOT NULL DEFAULT '[]',
  discord_role_id  TEXT NOT NULL DEFAULT '',
  discord_role_name TEXT NOT NULL DEFAULT '',
  game_rewards     TEXT NOT NULL DEFAULT '{}',
  active           INTEGER NOT NULL DEFAULT 1,
  sort_order       INTEGER NOT NULL DEFAULT 0,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  id                  TEXT PRIMARY KEY,
  order_number        TEXT NOT NULL UNIQUE,
  user_id             TEXT NOT NULL REFERENCES users(id),
  pack_id             TEXT NOT NULL REFERENCES packs(id),
  pack_snapshot       TEXT NOT NULL,
  amount_cents        INTEGER NOT NULL,
  currency            TEXT NOT NULL DEFAULT 'EUR',
  status              TEXT NOT NULL DEFAULT 'pending',
  provider            TEXT NOT NULL DEFAULT 'demo',
  checkout_session_id TEXT,
  payment_intent_id   TEXT,
  provider_refund_id  TEXT,
  idempotency_key     TEXT NOT NULL UNIQUE,
  failure_reason      TEXT,
  refund_reason       TEXT,
  refunded_cents      INTEGER NOT NULL DEFAULT 0,
  paid_at             INTEGER,
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);

CREATE TABLE IF NOT EXISTS payment_events (
  id           TEXT PRIMARY KEY,
  order_id     TEXT REFERENCES orders(id),
  provider     TEXT NOT NULL,
  event_id     TEXT NOT NULL,
  type         TEXT NOT NULL,
  status       TEXT NOT NULL,
  amount_cents INTEGER,
  message      TEXT,
  raw          TEXT,
  received_at  INTEGER NOT NULL,
  UNIQUE(provider, event_id)
);
CREATE INDEX IF NOT EXISTS idx_payment_events_order ON payment_events(order_id);

CREATE TABLE IF NOT EXISTS deliveries (
  id         TEXT PRIMARY KEY,
  order_id   TEXT NOT NULL UNIQUE REFERENCES orders(id),
  user_id    TEXT NOT NULL,
  tx_id      TEXT NOT NULL UNIQUE,
  status     TEXT NOT NULL DEFAULT 'pending',
  steps      TEXT NOT NULL DEFAULT '[]',
  attempts   INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_deliveries_status ON deliveries(status);

CREATE TABLE IF NOT EXISTS grants (
  id         TEXT PRIMARY KEY,
  order_id   TEXT NOT NULL REFERENCES orders(id),
  user_id    TEXT NOT NULL,
  pack_id    TEXT NOT NULL,
  tx_id      TEXT NOT NULL,
  kind       TEXT NOT NULL,
  key        TEXT NOT NULL,
  label      TEXT NOT NULL DEFAULT '',
  value      TEXT NOT NULL DEFAULT '',
  status     TEXT NOT NULL DEFAULT 'granted',
  created_at INTEGER NOT NULL,
  revoked_at INTEGER,
  UNIQUE(order_id, kind, key)
);
CREATE INDEX IF NOT EXISTS idx_grants_user ON grants(user_id);

CREATE TABLE IF NOT EXISTS user_packs (
  user_id    TEXT NOT NULL,
  pack_id    TEXT NOT NULL,
  order_id   TEXT NOT NULL,
  active     INTEGER NOT NULL DEFAULT 1,
  granted_at INTEGER NOT NULL,
  revoked_at INTEGER,
  PRIMARY KEY (user_id, pack_id)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id          TEXT PRIMARY KEY,
  at          INTEGER NOT NULL,
  actor_id    TEXT,
  actor_email TEXT,
  action      TEXT NOT NULL,
  target      TEXT,
  ip          TEXT,
  meta        TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_logs(at);

CREATE TABLE IF NOT EXISTS tickets (
  id         TEXT PRIMARY KEY,
  ref        TEXT NOT NULL UNIQUE,
  user_id    TEXT,
  name       TEXT NOT NULL,
  email      TEXT NOT NULL,
  subject    TEXT NOT NULL,
  category   TEXT NOT NULL DEFAULT 'autre',
  message    TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'open',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
`;

/* ------------------------------------------------------------------ */
/*  Connexion                                                          */
/* ------------------------------------------------------------------ */

let handle = null;

export function getDb() {
  if (handle) return handle;
  const file = config.dbFile;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  handle = new DatabaseSync(file);
  handle.exec(SCHEMA);
  return handle;
}

export function closeDb() {
  if (handle) {
    try { handle.close(); } catch { /* déjà fermé */ }
    handle = null;
  }
}

/** Normalise les valeurs pour node:sqlite (pas de boolean/undefined/object). */
function bind(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value instanceof Date) return value.getTime();
  return value;
}
const bindAll = (args) => args.map(bind);

export function get(sql, ...params) {
  return getDb().prepare(sql).get(...bindAll(params)) ?? null;
}
export function all(sql, ...params) {
  return getDb().prepare(sql).all(...bindAll(params));
}
export function run(sql, ...params) {
  const res = getDb().prepare(sql).run(...bindAll(params));
  return { changes: Number(res.changes), lastInsertRowid: res.lastInsertRowid };
}
export function exec(sql) {
  getDb().exec(sql);
}

/** Exécute le callback dans une transaction SQLite (rollback en cas d'erreur). */
export function transaction(fn) {
  const db = getDb();
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* rien */ }
    throw error;
  }
}

/* ------------------------------------------------------------------ */
/*  Utilitaires                                                        */
/* ------------------------------------------------------------------ */

export const now = () => Date.now();

const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';
/** Identifiant court, lisible et unique (ex: ord_3k9x…). */
export function newId(prefix = 'id') {
  const time = Date.now().toString(32).padStart(9, '0');
  const bytes = crypto.randomBytes(10);
  let random = '';
  for (const b of bytes) random += ALPHABET[b % ALPHABET.length];
  return `${prefix}_${time}${random}`;
}

export const parseJson = (value, fallback) => {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return fallback; }
};

export const toRow = (value) => JSON.stringify(value ?? null);

export function nowIso(ms = Date.now()) {
  return new Date(ms).toISOString();
}
