/**
 * KALEA — micro-framework HTTP (routing, middlewares, JSON, statique, SPA).
 * Zéro dépendance : bâti sur le module `node:http`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { AppError } from './errors.js';
import { log } from './logger.js';
import { config } from '../config.js';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

const MAX_BODY = 1_000_000; // 1 Mo

export function parseCookies(header) {
  const out = Object.create(null);
  if (!header) return out;
  for (const part of String(header).split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (!k) continue;
    try { out[k] = decodeURIComponent(v); } catch { out[k] = v; }
  }
  return out;
}

export function serializeCookie(name, value, opts = {}) {
  const bits = [`${name}=${encodeURIComponent(value)}`];
  if (opts.maxAge !== undefined) bits.push(`Max-Age=${Math.floor(opts.maxAge)}`);
  if (opts.expires) bits.push(`Expires=${new Date(opts.expires).toUTCString()}`);
  bits.push(`Path=${opts.path ?? '/'}`);
  if (opts.domain) bits.push(`Domain=${opts.domain}`);
  if (opts.httpOnly) bits.push('HttpOnly');
  if (opts.secure) bits.push('Secure');
  bits.push(`SameSite=${opts.sameSite ?? 'Lax'}`);
  return bits.join('; ');
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new AppError('Corps de requête trop volumineux.', 413, 'payload_too_large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function createContext(req, res) {
  const host = req.headers.host ?? 'localhost';
  /* X-Forwarded-For n'est honoré que derrière un proxy de confiance
   * (TRUST_PROXY=1, obligatoire sur Render) : sinon un client pourrait
   * falsifier son adresse IP et contourner les limitations de débit. */
  const forwarded = config.security.trustProxy
    ? String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim()
    : '';
  const ip = forwarded || req.socket.remoteAddress || '0.0.0.0';
  const ctx = {
    req,
    res,
    method: req.method?.toUpperCase() ?? 'GET',
    headers: req.headers,
    ip,
    params: {},
    query: {},
    body: undefined,
    rawBody: '',
    session: null,
    user: null,
    startedAt: Date.now(),
    statusCode: 200,
    set(name, value) { res.setHeader(name, value); return ctx; },
    setCookie(name, value, opts) {
      const prev = res.getHeader('Set-Cookie');
      const cookie = serializeCookie(name, value, opts);
      res.setHeader('Set-Cookie', prev ? [].concat(prev, cookie) : [cookie]);
      return ctx;
    },
    clearCookie(name, opts = {}) {
      return ctx.setCookie(name, '', { ...opts, maxAge: 0 });
    },
    status(code) { ctx.statusCode = code; res.statusCode = code; return ctx; },
    json(data, code = 200) {
      ctx.status(code);
      const payload = JSON.stringify(data);
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Length', Buffer.byteLength(payload));
      res.end(payload);
      return ctx;
    },
    text(value, code = 200) {
      ctx.status(code);
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end(String(value));
      return ctx;
    },
    html(value, code = 200) {
      ctx.status(code);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(value);
      return ctx;
    },
    redirect(location, code = 302) {
      ctx.status(code);
      res.setHeader('Location', location);
      res.end();
      return ctx;
    },
    get(name) { return req.headers[name.toLowerCase()]; },
    wantsJson() {
      return ctx.path.startsWith('/api/') ||
        (ctx.get('accept') ?? '').includes('application/json') ||
        (ctx.get('x-requested-with') ?? '') === 'Kalea';
    },
  };
  const url = new URL(req.url ?? '/', `http://${host}`);
  ctx.path = decodeURI(url.pathname);
  ctx.query = Object.fromEntries(url.searchParams.entries());
  ctx.cookies = parseCookies(req.headers.cookie);
  return ctx;
}

/* ------------------------------ Router ------------------------------ */

function compile(pattern) {
  const keys = [];
  const normalized = String(pattern).replace(/\/+$/, '') || '/';
  const mapped = normalized.split('/').map((segment) => {
    if (segment.startsWith(':') && segment.length > 1) {
      keys.push(segment.slice(1));
      return '([^/]+)';
    }
    return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  });
  let source = mapped.join('/');
  if (!source.startsWith('/')) source = `/${source}`;
  return { regex: new RegExp(`^${source}/?$`), keys };
}

export function createRouter() {
  const routes = [];
  const compiled = new Map();

  const register = (method, pattern, handlers) => {
    const key = `${method} ${pattern}`;
    if (!compiled.has(key)) compiled.set(key, compile(pattern));
    routes.push({ method, pattern, handlers, ...compiled.get(key) });
  };

  const api = {
    use(fn) { (api.__middlewares ??= []).push(fn); return api; },
    get: (p, ...h) => (register('GET', p, h), api),
    post: (p, ...h) => (register('POST', p, h), api),
    put: (p, ...h) => (register('PUT', p, h), api),
    patch: (p, ...h) => (register('PATCH', p, h), api),
    delete: (p, ...h) => (register('DELETE', p, h), api),
    routes,
    match(method, pathname) {
      for (const route of routes) {
        if (route.method !== method && route.method !== 'ALL') continue;
        const m = route.regex.exec(pathname);
        if (m) {
          const params = {};
          route.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
          return { route, params };
        }
      }
      return null;
    },
  };
  return api;
}

async function runChain(chain, ctx) {
  let index = -1;
  const dispatch = async (i) => {
    if (i <= index) throw new Error('next() appelé plusieurs fois');
    index = i;
    const fn = chain[i];
    if (!fn) return;
    const result = fn.length >= 2 ? fn(ctx, () => dispatch(i + 1)) : fn(ctx);
    await result;
  };
  await dispatch(0);
}

function sendError(ctx, error) {
  const isApp = error instanceof AppError;
  const status = isApp ? error.status : 500;
  const payload = isApp
    ? error.toJSON()
    : { error: { message: 'Une erreur interne est survenue.', code: 'server_error' } };
  if (!isApp || status >= 500) {
    log.error('request_failed', { path: ctx.path, method: ctx.method, error: error?.message, stack: error?.stack?.split('\n').slice(0, 4).join(' | ') });
  }
  if (ctx.res.headersSent) { try { ctx.res.end(); } catch { /* rien */ } return; }
  ctx.json(payload, status);
}

/* --------------------------- Serveur HTTP --------------------------- */

export function createServer({ router, publicDir, securityHeaders, onRequest, assetVersion = '' }) {
  const notFoundApi = (ctx) => ctx.json({ error: { message: 'Route introuvable.', code: 'not_found' } }, 404);

  /**
   * Les fichiers sont servis sous /__a/<version>/ : tout le graphe de modules
   * (imports relatifs) partage le même préfixe, ce qui garantit qu'un nouveau
   * déploiement n'est jamais lu depuis le cache du navigateur.
   */
  const stripAssetVersion = (requestPath) => {
    const stripped = requestPath.replace(/^\/__a\/[^/]+(?=\/|$)/, '');
    return stripped || '/';
  };
  const injectAssetVersion = (html) => (assetVersion
    ? html.replace(/(["'])\/assets\//g, `$1/__a/${assetVersion}/assets/`)
    : html);

  const serveStatic = async (ctx) => {
    const notFound = () => {
      const page = path.join(publicDir, '404.html');
      if (fs.existsSync(page)) return ctx.html(fs.readFileSync(page, 'utf8'), 404);
      return ctx.text('404 — Page introuvable', 404);
    };
    if (ctx.method !== 'GET' && ctx.method !== 'HEAD') return notFoundApi(ctx);
    const safePath = path.normalize(stripAssetVersion(ctx.path)).replace(/^(\.\.[/\\])+/, '');
    let filePath = path.join(publicDir, safePath);
    if (!filePath.startsWith(publicDir)) return notFound();
    try {
      const stat = fs.statSync(filePath);
      if (stat.isDirectory()) filePath = path.join(filePath, 'index.html');
    } catch {
      // Fichier absent : fallback SPA pour les routes sans extension.
      if (path.extname(safePath)) return notFound();
      filePath = path.join(publicDir, 'index.html');
    }
    if (!fs.existsSync(filePath)) return notFound();
    const ext = path.extname(filePath).toLowerCase();
    let body = fs.readFileSync(filePath);
    if (path.basename(filePath) === 'index.html') {
      body = Buffer.from(injectAssetVersion(body.toString('utf8')), 'utf8');
    }
    const stat = fs.statSync(filePath);
    const etag = `W/"${stat.size.toString(36)}-${Math.round(stat.mtimeMs).toString(36)}"`;

    ctx.set('ETag', etag);
    ctx.set('Content-Type', MIME[ext] ?? 'application/octet-stream');
    // Fichiers sans empreinte de version : on revalide à chaque utilisation
    // (304 léger) pour éviter un bundle périmé après une mise à jour.
    ctx.set('Cache-Control', 'no-cache');

    const inm = ctx.get('if-none-match');
    if (inm && inm.split(',').some((value) => value.trim() === etag)) {
      ctx.status(304);
      ctx.res.end();
      return;
    }

    ctx.status(200);
    ctx.set('Content-Length', String(body.length));
    ctx.res.end(ctx.method === 'HEAD' ? undefined : body);
  };

  const serverHandler = async (req, res) => {
    const ctx = createContext(req, res);
    try {
      if (securityHeaders) securityHeaders(ctx);
      if (ctx.method === 'POST' || ctx.method === 'PUT' || ctx.method === 'PATCH' || ctx.method === 'DELETE') {
        const raw = await readBody(req);
        ctx.rawBody = raw.toString('utf8');
        const type = String(req.headers['content-type'] ?? '');
        if (ctx.rawBody && type.includes('application/json')) {
          try { ctx.body = JSON.parse(ctx.rawBody); }
          catch { throw new AppError('JSON invalide.', 400, 'invalid_json'); }
        } else if (ctx.rawBody && type.includes('application/x-www-form-urlencoded')) {
          ctx.body = Object.fromEntries(new URLSearchParams(ctx.rawBody).entries());
        } else {
          ctx.body = {};
        }
      }

      const matched = ctx.method === 'GET' || ctx.method === 'HEAD'
        ? router.match('GET', ctx.path)
        : router.match(ctx.method, ctx.path);
      const fallbackGet = !matched && (ctx.method === 'GET' || ctx.method === 'HEAD')
        ? router.match('ALL', ctx.path)
        : null;

      const chosen = matched ?? fallbackGet;
      const chain = chosen
        ? [...router.__middlewares, ...chosen.route.handlers]
        : [...(router.__middlewares ?? []), ctx.path.startsWith('/api/') ? notFoundApi : serveStatic];
      if (chosen) ctx.params = chosen.params;

      await runChain(chain, ctx);
      onRequest?.(ctx);
      if (!res.writableEnded) {
        // Un handler n'a rien renvoyé : réponse JSON vide par sécurité.
        ctx.json({ ok: true });
      }
    } catch (error) {
      sendError(ctx, error);
      onRequest?.(ctx);
    }
  };

  return serverHandler;
}


