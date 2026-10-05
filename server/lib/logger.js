/** KALEA — journalisation structurée (console + table audit_logs). */
import { newId, run, all, now } from '../db.js';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const MIN = LEVELS[process.env.LOG_LEVEL] ?? LEVELS.info;

function write(level, message, meta = {}) {
  if (LEVELS[level] < MIN) return;
  const line = {
    time: new Date().toISOString(),
    level,
    msg: message,
    ...(Object.keys(meta).length ? meta : {}),
  };
  const out = level === 'error' ? console.error : console.log;
  out(JSON.stringify(line));
}

export const log = {
  debug: (msg, meta) => write('debug', msg, meta),
  info: (msg, meta) => write('info', msg, meta),
  warn: (msg, meta) => write('warn', msg, meta),
  error: (msg, meta) => write('error', msg, meta),
};

/** Écrit une entrée d'audit consultable dans le dashboard admin. */
export function audit(action, { actor = null, target = null, ip = null, meta = {} } = {}) {
  try {
    run(
      `INSERT INTO audit_logs (id, at, actor_id, actor_email, action, target, ip, meta)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      newId('log'), now(), actor?.id ?? null, actor?.email ?? null,
      action, target, ip, JSON.stringify(meta ?? {}),
    );
  } catch (error) {
    log.error('audit_write_failed', { error: error.message, action });
  }
}

/** Journal des événements applicatifs (dashboard admin → onglet Logs). */
export function queryLogs({ action = '', limit = 100, offset = 0 } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const safeOffset = Math.max(Number(offset) || 0, 0);
  if (action) {
    return all(
      'SELECT * FROM audit_logs WHERE action LIKE ? ORDER BY at DESC LIMIT ? OFFSET ?',
      `%${action}%`, safeLimit, safeOffset,
    );
  }
  return all('SELECT * FROM audit_logs ORDER BY at DESC LIMIT ? OFFSET ?', safeLimit, safeOffset);
}
