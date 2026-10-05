/**
 * KALEA — boîte à outils d'interface : échappement, rendu, toasts, modales,
 * formatage français, badges de statut, animations d'apparition.
 */
import { icon as svgIcon, hasIcon } from './icons.js';

/** Icônes SVG vectorielles (re-exportées pour les vues). */
export { icon, hasIcon } from './icons.js';

export const esc = (value) => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Crée un élément à partir d'une chaîne HTML. */
export function h(html) {
  const template = document.createElement('template');
  template.innerHTML = String(html).trim();
  return template.content.firstElementChild;
}

export const qs = (sel, root = document) => root.querySelector(sel);
export const qsa = (sel, root = document) => [...root.querySelectorAll(sel)];

/* ------------------------------ Formatage ------------------------------ */

export const fmtEUR = (cents) =>
  new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format((Number(cents) || 0) / 100);

export const fmtMoney = (value) =>
  new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(Number(value) || 0);

export const fmtDate = (ts, { withTime = true } = {}) => {
  if (!ts) return '—';
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit', month: 'short', year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  }).format(new Date(Number(ts)));
};

export const fmtRelative = (ts) => {
  if (!ts) return '—';
  const diff = Date.now() - Number(ts);
  const min = Math.round(diff / 60000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const hours = Math.round(min / 60);
  if (hours < 24) return `il y a ${hours} h`;
  const days = Math.round(hours / 24);
  if (days < 30) return `il y a ${days} j`;
  return fmtDate(ts, { withTime: false });
};

/* -------------------------------- Badges -------------------------------- */

const STATUS_LABELS = {
  pending: 'En attente',
  processing: 'Paiement en cours',
  paid: 'Payée',
  failed: 'Échouée',
  canceled: 'Annulée',
  expired: 'Expirée',
  refunded: 'Remboursée',
  delivered: 'Livrée',
  delivering: 'Livraison…',
  partial: 'Livraison partielle',
  blocked: 'Bloquée',
  reverted: 'Révoquée',
  open: 'Ouvert',
  pending_ticket: 'En attente',
  closed: 'Fermé',
  active: 'Actif',
  banned: 'Banni',
  granted: 'Accordée',
  revoked: 'Retirée',
  ok: 'Réussi',
  already: 'Déjà attribué',
  skipped: 'Non applicable',
  running: 'En cours',
  error: 'Erreur',
  duplicate: 'Doublon ignoré',
  ignored: 'Ignoré',
  received: 'Reçu',
  processed: 'Traitée',
};

export const statusLabel = (status) => STATUS_LABELS[status] ?? status ?? '—';

export function badge(status, label = null) {
  const cls = String(status ?? '').replace(/[^a-z_]/gi, '');
  return `<span class="badge badge-${cls}"><span class="badge-dot"></span>${esc(label ?? statusLabel(status))}</span>`;
}

/* -------------------------------- Toasts -------------------------------- */

export function toast(message, type = 'info', { title = null, duration = 4600 } = {}) {
  const root = qs('#toasts');
  if (!root) return;
  const icon = type === 'success' ? '✓' : type === 'error' ? '!' : 'i';
  const node = h(`
    <div class="toast ${type}" role="status">
      <div class="toast-icon">${icon}</div>
      <div>
        ${title ? `<div class="toast-title">${esc(title)}</div>` : ''}
        <div class="toast-msg">${esc(message)}</div>
      </div>
    </div>`);
  root.appendChild(node);
  const remove = () => {
    node.classList.add('out');
    setTimeout(() => node.remove(), 380);
  };
  const timer = setTimeout(remove, duration);
  node.addEventListener('click', () => { clearTimeout(timer); remove(); });
  while (root.children.length > 4) root.firstElementChild.remove();
}

export const toastSuccess = (m, t) => toast(m, 'success', { title: t });
export const toastError = (m, t) => toast(m, 'error', { title: t ?? 'Erreur' });

/* ------------------------------- Modales -------------------------------- */

export function modal({ title, body = '', actions = [], size = '' }) {
  const root = qs('#modalRoot');
  const backdrop = h(`
    <div class="modal-backdrop" role="dialog" aria-modal="true">
      <div class="modal ${size}">
        <div class="row-between" style="margin-bottom:14px">
          <div class="modal-title">${esc(title)}</div>
          <button class="btn btn-sm btn-ghost" data-close aria-label="Fermer">✕</button>
        </div>
        <div class="modal-body">${body}</div>
        ${actions.length ? '<div class="modal-actions"></div>' : ''}
      </div>
    </div>`);
  const actionsRoot = qs('.modal-actions', backdrop);
  const close = () => {
    backdrop.style.animation = 'fadeIn 0.2s reverse';
    setTimeout(() => backdrop.remove(), 180);
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);

  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop || e.target.closest('[data-close]')) close();
  });

  for (const action of actions) {
    const btn = h(`<button class="btn ${action.className ?? 'btn-ghost'}">${esc(action.label)}</button>`);
    btn.addEventListener('click', async () => {
      if (action.onClick) {
        const result = await action.onClick({ close, button: btn });
        if (result === false) return;
      }
      if (action.keepOpen !== true) close();
    });
    actionsRoot?.appendChild(btn);
  }
  root.appendChild(backdrop);
  return { close, root: backdrop };
}

export function confirmDialog(message, { title = 'Confirmation', confirmLabel = 'Confirmer', danger = false } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => { if (!settled) { settled = true; resolve(value); } };
    const instance = modal({
      title,
      body: `<p class="muted">${esc(message)}</p>`,
      actions: [
        { label: 'Annuler', className: 'btn-ghost', onClick: () => done(false) },
        { label: confirmLabel, className: danger ? 'btn-danger' : 'btn-primary', onClick: () => done(true) },
      ],
    });
    instance.root.addEventListener('remove', () => done(false));
    const observer = new MutationObserver(() => {
      if (!document.body.contains(instance.root)) { done(false); observer.disconnect(); }
    });
    observer.observe(qs('#modalRoot'), { childList: true });
  });
}

/* -------------------------------- Divers -------------------------------- */

export function loadingButton(button, label = 'Chargement…') {
  const original = button.innerHTML;
  button.disabled = true;
  button.innerHTML = `<span class="spinner" style="width:15px;height:15px;border-width:2px"></span> ${esc(label)}`;
  return () => { button.disabled = false; button.innerHTML = original; };
}

/** Anime l'apparition des blocs marqués `.reveal`. */
export function reveal(root = document) {
  const items = qsa('.reveal', root);
  if (!('IntersectionObserver' in window)) {
    items.forEach((el) => el.classList.add('in'));
    return;
  }
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry, i) => {
      if (entry.isIntersecting) {
        setTimeout(() => entry.target.classList.add('in'), i * 70);
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -40px' });
  items.forEach((el) => observer.observe(el));
}

/** Compteur animé pour les statistiques. */
export function countUp(el, target, { prefix = '', suffix = '', duration = 1100 } = {}) {
  const start = performance.now();
  const from = 0;
  const step = (now) => {
    const p = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - p, 3);
    const value = from + (target - from) * eased;
    el.textContent = `${prefix}${Number.isInteger(target) ? Math.round(value) : value.toFixed(1)}${suffix}`;
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

export function accordion(root) {
  qsa('.acc', root).forEach((item) => {
    const head = qs('.acc-head', item);
    const body = qs('.acc-body', item);
    if (!head || !body) return;
    head.addEventListener('click', () => {
      const open = item.classList.toggle('open');
      body.style.maxHeight = open ? `${body.scrollHeight}px` : '0px';
      qsa('.acc', root).forEach((other) => {
        if (other !== item && other.classList.contains('open')) {
          other.classList.remove('open');
          const otherBody = qs('.acc-body', other);
          if (otherBody) otherBody.style.maxHeight = '0px';
        }
      });
    });
  });
}

export const skeleton = (height = 16) =>
  `<div class="skeleton" style="height:${height}px;width:100%"></div>`;

/**
 * Applique le thème de fond choisi dans /admin/parametres.
 * `value` : un préréglage (`nebuleuse`, `aurore`, `embras`, `mono`) ou une
 * URL d'image (`https://…`, `/assets/…`, `data:image/…`).
 */
export function applyTheme(value) {
  const theme = typeof value === 'string' ? value : (value?.background ?? 'nebuleuse');
  const isImage = /^(https?:\/\/|\/|data:image\/)/i.test(theme.trim());
  const root = document.documentElement;
  root.dataset.bg = isImage ? 'image' : theme;
  if (isImage) root.style.setProperty('--bg-image', `url("${theme.replace(/["\\)]/g, '')}")`);
  else root.style.removeProperty('--bg-image');
}

/**
 * État vide : accepte un nom d'icône SVG (`icon('package')`) ou, pour la
 * rétrocompatibilité, un emoji / un fragment HTML brut.
 */
export function emptyState(glyph, title, subtitle = '', action = '') {
  const art = hasIcon(glyph)
    ? svgIcon(glyph, { size: 32, cls: 'ico-empty' })
    : esc(glyph);
  return `<div class="empty"><div class="ico">${art}</div><div class="card-title">${esc(title)}</div>
    ${subtitle ? `<p class="muted small">${esc(subtitle)}</p>` : ''}${action}</div>`;
}
