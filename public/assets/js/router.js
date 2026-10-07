/**
 * KALEA — routeur SPA (History API) avec gardes d'accès et transitions.
 */
import { qs, qsa } from './ui.js';

const routes = [];
let viewEl = null;
let stateRef = () => ({ user: null, config: null });
let errorHandler = null;
let currentCleanup = null;
let adminGate = null;

/** Écran de contrôle (mot de passe) affiché avant toute route /admin. */
export function setAdminGate(view) {
  adminGate = view;
}

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

export function register(pattern, view, options = {}) {
  const { regex, keys } = compile(pattern);
  routes.push({ pattern, regex, keys, view, options });
}

export function navigate(path, { replace = false, keepScroll = false } = {}) {
  const target = String(path);
  if (target === location.pathname + location.search && !replace) {
    render();
    return;
  }
  history[replace ? 'replaceState' : 'pushState']({}, '', target);
  if (!keepScroll) window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
  render();
}

function match(pathname) {
  for (const route of routes) {
    const m = route.regex.exec(pathname);
    if (m) {
      const params = {};
      route.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      return { route, params };
    }
  }
  return null;
}

function setActiveNav(pathname) {
  qsa('[data-nav]').forEach((link) => {
    const target = link.dataset.nav;
    const active = target === '/' ? pathname === '/' : pathname === target || pathname.startsWith(`${target}/`);
    link.classList.toggle('active', active);
  });
}

/* --------- Barre de progression discrète pendant le chargement ----------- */
let pendingViews = 0;
function loadingBar(on) {
  const bar = qs('#routeBar');
  if (!bar) return;
  pendingViews = Math.max(0, pendingViews + (on ? 1 : -1));
  bar.classList.toggle('active', pendingViews > 0);
}

/** Squelette de chargement affiché pendant la résolution de la vue. */
function skeletonPage() {
  return `
    <div class="container section" aria-busy="true" aria-live="polite">
      <div class="skeleton" style="height:12px;width:130px"></div>
      <div class="skeleton" style="height:34px;width:min(340px,70%);margin-top:16px"></div>
      <div class="skeleton" style="height:14px;width:min(520px,90%);margin-top:14px"></div>
      <div class="grid grid-3" style="margin-top:36px">
        <div class="skeleton skeleton-card"></div>
        <div class="skeleton skeleton-card"></div>
        <div class="skeleton skeleton-card"></div>
      </div>
    </div>`;
}

export async function render() {
  const pathname = location.pathname;
  const query = new URLSearchParams(location.search);
  const state = stateRef();
  const found = match(pathname);

  if (typeof currentCleanup === 'function') {
    try { currentCleanup(); } catch { /* rien */ }
    currentCleanup = null;
  }

  if (!found) {
    await show('/404');
    return;
  }

  const { route, params } = found;
  const { options, view } = route;

  // --- Gardes d'accès ---
  if (options.auth && !state.user) {
    navigate(`/connexion?next=${encodeURIComponent(pathname + location.search)}`, { replace: true });
    return;
  }
  if (options.admin && state.user?.role !== 'admin') {
    // Zone protégée : écran de mot de passe (ou refus si compte non admin).
    if (adminGate) {
      try {
        loadingBar(true);
        await showView(adminGate, { params, query, path: pathname, state, query2: query });
      } catch (error) { errorHandler?.(error, { pathname }); }
      finally { loadingBar(false); }
      return;
    }
    navigate(state.user ? '/' : '/connexion?next=%2Fadmin', { replace: true });
    return;
  }
  if (options.guest && state.user) {
    navigate('/mon-compte', { replace: true });
    return;
  }

  try {
    loadingBar(true);
    // Squelette pendant le chargement des données de la vue (effet moderne).
    viewEl.innerHTML = skeletonPage();
    await showView(view, { params, query, path: pathname, state, query2: query });
  } catch (error) {
    errorHandler?.(error, { pathname });
  } finally {
    loadingBar(false);
  }
}

/** Injecte le résultat d'une vue dans le conteneur + animations + titre. */
async function showView(view, ctx) {
  const result = await view(ctx);
  const html = typeof result === 'string' ? result : (result?.html ?? '');
  const title = typeof result === 'object' ? result.title : null;

  viewEl.innerHTML = html;
  viewEl.classList.remove('view-enter');
  void viewEl.offsetWidth; // relance l'animation
  viewEl.classList.add('view-enter');

  document.title = title ? `${title} — KaleaShop` : 'KaleaShop — Boutique gaming officielle';
  setActiveNav(ctx.path);
  if (typeof result === 'object' && typeof result.mount === 'function') {
    currentCleanup = result.mount(viewEl) ?? null;
  }
  if (location.hash) {
    const target = qs(location.hash, viewEl);
    if (target) target.scrollIntoView({ behavior: 'smooth' });
  }
}

async function show(path) {
  const fallback = routes.find((r) => r.pattern === '/404');
  if (!fallback) {
    viewEl.innerHTML = '<div class="container section"><div class="empty"><div class="ico">¯\\_(ツ)_/¯</div><div class="card-title">Page introuvable</div></div></div>';
    return;
  }
  const result = await fallback.view({ params: {}, query: new URLSearchParams(), path });
  viewEl.innerHTML = typeof result === 'string' ? result : result.html;
  document.title = 'Page introuvable — KaleaShop';
  setActiveNav('/404');
}

export function startRouter({ element, getState, onError }) {
  viewEl = element;
  stateRef = getState;
  errorHandler = onError;

  document.addEventListener('click', (event) => {
    const link = event.target.closest('a[data-link]');
    if (!link) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const href = link.getAttribute('href');
    if (!href || href.startsWith('http') || href.startsWith('mailto:')) return;
    event.preventDefault();
    document.body.classList.remove('nav-open');
    navigate(href);
  });

  window.addEventListener('popstate', () => render());
  render();
}
