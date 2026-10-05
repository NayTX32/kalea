/**
 * KALEA — jeu d'icônes SVG vectorielles (style trait, 24×24).
 *
 * Aucune dépendance : chaque icône est une chaîne SVG injectée dans le DOM.
 * Elles remplacent les emoji de l'interface pour un rendu net à toutes les
 * densités, colorable avec `currentColor` et cohérent avec le design system.
 *
 *   import { icon } from './icons.js';
 *   icon('shield')                       // <svg …>…</svg>
 *   icon('zap', { size: 22, cls: 'big' })
 */

const PATHS = {
  /* --- Pilotage ---------------------------------------------------------- */
  dashboard: '<rect x="3" y="3" width="7.5" height="7.5" rx="2"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="2"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="2"/>',
  chart: '<path d="M3.5 3.5v17h17"/><path d="M7 15.5l3.8-4.7 3 2.7 4.7-6.4"/><circle cx="18.5" cy="7.1" r="1.4"/>',
  activity: '<path d="M3 12h4l2.5-7 4 14 2.5-7H21"/>',

  /* --- Ventes ------------------------------------------------------------ */
  cube: '<path d="M12 2.8l8.5 4.6v9.2L12 21.2 3.5 16.6V7.4z"/><path d="M3.5 7.4L12 12l8.5-4.6M12 12v9.2"/>',
  receipt: '<path d="M6 3h12v18l-3-1.8-3 1.8-3-1.8L6 21z"/><path d="M9.2 8.5h5.6M9.2 12.5h5.6"/>',
  card: '<rect x="2.5" y="5" width="19" height="14" rx="3"/><path d="M2.5 9.8h19"/><path d="M6.5 14.8h4"/>',
  coins: '<ellipse cx="12" cy="6.5" rx="7.5" ry="3.2"/><path d="M4.5 6.5v5c0 1.8 3.4 3.2 7.5 3.2s7.5-1.4 7.5-3.2v-5"/><path d="M4.5 11.5v5c0 1.8 3.4 3.2 7.5 3.2s7.5-1.4 7.5-3.2v-5"/>',

  /* --- Livraison --------------------------------------------------------- */
  package: '<path d="M20.5 7.8v8.4L12 21.4l-8.5-5.2V7.8L12 2.6z"/><path d="M3.5 7.8L12 13l8.5-5.2M12 13v8.4"/><path d="M7.8 5.2l8.4 5.2"/>',
  truck: '<path d="M2.5 6.5h11v10h-11z"/><path d="M13.5 10h3.6l3.4 3.3v3.2h-7z"/><circle cx="7" cy="18.5" r="2"/><circle cx="17" cy="18.5" r="2"/>',
  alert: '<path d="M12 3.6l9.2 15.8H2.8z"/><path d="M12 9.6v4.2"/><circle cx="12" cy="16.6" r=".9" fill="currentColor" stroke="none"/>',
  gamepad: '<path d="M7.2 7.5h9.6a4.8 4.8 0 0 1 4.7 5.6l-.5 3.1a3 3 0 0 1-5.4 1.3L14 15.8h-4l-1.6 1.7a3 3 0 0 1-5.4-1.3l-.5-3.1a4.8 4.8 0 0 1 4.7-5.6z"/><path d="M7.4 11.2v2.4M6.2 12.4h2.4"/><circle cx="15.6" cy="11.6" r=".95" fill="currentColor" stroke="none"/><circle cx="17.6" cy="13.8" r=".95" fill="currentColor" stroke="none"/>',
  bot: '<rect x="3.5" y="8" width="17" height="11.5" rx="3.5"/><path d="M12 8V4.4M9.4 4.4h5.2"/><circle cx="9" cy="13" r="1.1" fill="currentColor" stroke="none"/><circle cx="15" cy="13" r="1.1" fill="currentColor" stroke="none"/><path d="M9.5 16.4h5"/>',

  /* --- Communauté -------------------------------------------------------- */
  users: '<circle cx="9.2" cy="8" r="3.4"/><path d="M3.2 19.6a6 6 0 0 1 12 0"/><path d="M16.4 5.2a3.4 3.4 0 0 1 0 5.6"/><path d="M17.6 14.4a5.6 5.6 0 0 1 3.2 5.2"/>',
  message: '<path d="M20.5 14.6a3.4 3.4 0 0 1-3.4 3.4H8.4L4 21.4l1.2-4.3A7.6 7.6 0 0 1 2.6 12C2.6 7.5 6.8 4 11.8 4s8.7 3.5 8.7 8z"/>',
  discord: '<path d="M9.3 6.3a13.6 13.6 0 0 1 5.4 0M8.6 6.6C5.9 8.1 4 11.3 4 15.4c0 0 2.6 2.4 6.5 2.6l1-1.6M15.4 6.6c2.7 1.5 4.6 4.7 4.6 8.8 0 0-2.6 2.4-6.5 2.6l-1-1.6"/><path d="M8.9 16.2c2.1 1 4.1 1 6.2 0"/><circle cx="9.4" cy="12.4" r="1.2" fill="currentColor" stroke="none"/><circle cx="14.6" cy="12.4" r="1.2" fill="currentColor" stroke="none"/>',
  heart: '<path d="M12 20.2s-7.6-4.5-7.6-9.6A4.4 4.4 0 0 1 12 7.7a4.4 4.4 0 0 1 7.6 2.9c0 5.1-7.6 9.6-7.6 9.6z"/>',
  star: '<path d="M12 3.4l2.7 5.5 6 .9-4.3 4.2 1 6-5.4-2.8-5.4 2.8 1-6L3.3 9.8l6-.9z"/>',

  /* --- Système ----------------------------------------------------------- */
  scroll: '<path d="M14 3.4H7.6A2.2 2.2 0 0 0 5.4 5.6v12.8a2.2 2.2 0 0 0 2.2 2.2h8.8a2.2 2.2 0 0 0 2.2-2.2V7.4z"/><path d="M14 3.4v4h4.2"/><path d="M8.8 12.4h6M8.8 16h4"/>',
  settings: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.6v2.6M12 18.8v2.6M2.6 12h2.6M18.8 12h2.6M5.4 5.4l1.8 1.8M16.8 16.8l1.8 1.8M18.6 5.4l-1.8 1.8M7.2 16.8l-1.8 1.8"/>',
  shield: '<path d="M12 2.8l7.6 3v5.6c0 4.6-3.2 8.3-7.6 9.8-4.4-1.5-7.6-5.2-7.6-9.8V5.8z"/>',
  'shield-check': '<path d="M12 2.8l7.6 3v5.6c0 4.6-3.2 8.3-7.6 9.8-4.4-1.5-7.6-5.2-7.6-9.8V5.8z"/><path d="M8.8 11.9l2.3 2.3 4.1-4.6"/>',
  lock: '<rect x="4.2" y="10" width="15.6" height="10.4" rx="3"/><path d="M8 10V7.4a4 4 0 0 1 8 0V10"/><circle cx="12" cy="15.2" r="1.3" fill="currentColor" stroke="none"/>',
  key: '<circle cx="8" cy="15.4" r="4"/><path d="M10.9 12.6L20 3.5M17.4 6.1l2.2 2.2M15 8.5l2.2 2.2"/>',
  zap: '<path d="M13.4 2.4L4.6 13.4h6.2l-.9 8.2 8.8-11h-6.2z" fill="currentColor" stroke="none"/>',
  flask: '<path d="M9.4 3h5.2M10.4 3v6.2L5.6 18.2A2 2 0 0 0 7.4 21.2h9.2a2 2 0 0 0 1.8-3l-4.8-9V3"/><path d="M7.8 15.2h8.4"/>',
  palette: '<path d="M12 3a9 9 0 1 0 0 18c1.3 0 2.1-.9 2.1-1.9 0-.6-.3-1-.6-1.4-.3-.4-.5-.8-.5-1.3 0-1 .8-1.9 1.9-1.9h1.3A4.8 4.8 0 0 0 21 9.7C21 6 16.9 3 12 3z"/><circle cx="7.4" cy="11.6" r="1.05" fill="currentColor" stroke="none"/><circle cx="10.4" cy="7.8" r="1.05" fill="currentColor" stroke="none"/><circle cx="15.2" cy="8" r="1.05" fill="currentColor" stroke="none"/>',

  /* --- Retours / états --------------------------------------------------- */
  check: '<path d="M4.8 12.6l4.6 4.6L19.2 6.8"/>',
  'check-circle': '<circle cx="12" cy="12" r="9"/><path d="M8.2 12.4l2.6 2.6 5-5.4"/>',
  x: '<path d="M6.4 6.4l11.2 11.2M17.6 6.4L6.4 17.6"/>',
  'x-circle': '<circle cx="12" cy="12" r="9"/><path d="M9.2 9.2l5.6 5.6M14.8 9.2l-5.6 5.6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.4"/><circle cx="12" cy="7.9" r=".95" fill="currentColor" stroke="none"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.6a2.6 2.6 0 1 1 3.5 2.4c-.7.3-1 .9-1 1.6v.5"/><circle cx="12" cy="16.9" r=".95" fill="currentColor" stroke="none"/>',
  sparkles: '<path d="M11 3.2l1.7 4.4 4.4 1.7-4.4 1.7L11 15.4 9.3 11 4.9 9.3 9.3 7.6z"/><path d="M18 14.6l.9 2.2 2.2.9-2.2.9-.9 2.2-.9-2.2-2.2-.9 2.2-.9z"/>',
  gift: '<rect x="3" y="8.4" width="18" height="4" rx="1.4"/><path d="M5 12.4v7.2a1.6 1.6 0 0 0 1.6 1.6h10.8a1.6 1.6 0 0 0 1.6-1.6v-7.2"/><path d="M12 8.4v12.8"/><path d="M12 8.4S10.6 4 8.6 4a2.1 2.1 0 0 0 0 4.4zM12 8.4S13.4 4 15.4 4a2.1 2.1 0 0 1 0 4.4z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 6.8V12l3.4 2.1"/>',

  /* --- Actions ----------------------------------------------------------- */
  plus: '<path d="M12 5.2v13.6M5.2 12h13.6"/>',
  trash: '<path d="M4.6 6.6h14.8M9.4 6.6V4.8a1.4 1.4 0 0 1 1.4-1.4h2.4a1.4 1.4 0 0 1 1.4 1.4v1.8"/><path d="M6.6 6.6l.9 12.2a1.6 1.6 0 0 0 1.6 1.5h5.8a1.6 1.6 0 0 0 1.6-1.5l.9-12.2"/><path d="M10.4 10.4v6M13.6 10.4v6"/>',
  refresh: '<path d="M20.4 11.2A8.4 8.4 0 0 0 6.2 6.6L3.6 9.1"/><path d="M3.6 4.6v4.5h4.5"/><path d="M3.6 12.8a8.4 8.4 0 0 0 14.2 4.6l2.6-2.5"/><path d="M20.4 19.4v-4.5h-4.5"/>',
  search: '<circle cx="10.8" cy="10.8" r="6.6"/><path d="M15.6 15.6l4.6 4.6"/>',
  filter: '<path d="M3.6 5.4h16.8l-6.5 7.6v5.6l-3.8 2v-7.6z"/>',
  eye: '<path d="M2.4 12s3.6-6.4 9.6-6.4S21.6 12 21.6 12s-3.6 6.4-9.6 6.4S2.4 12 2.4 12z"/><circle cx="12" cy="12" r="2.8"/>',
  'arrow-right': '<path d="M4.6 12h14.8M13.4 6l6 6-6 6"/>',
  external: '<path d="M14 4.4h5.6V10"/><path d="M19.6 4.4L11 13"/><path d="M18.2 14v4.6a1.8 1.8 0 0 1-1.8 1.8H5.4a1.8 1.8 0 0 1-1.8-1.8V7.6a1.8 1.8 0 0 1 1.8-1.8H10"/>',
  link: '<path d="M10.2 13.8a4.2 4.2 0 0 0 6.2.4l2.2-2.2a4.2 4.2 0 0 0-6-6L11.4 7.2"/><path d="M13.8 10.2a4.2 4.2 0 0 0-6.2-.4l-2.2 2.2a4.2 4.2 0 0 0 6 6l1.2-1.2"/>',
  logout: '<path d="M14.6 4.4h3.6a2 2 0 0 1 2 2v11.2a2 2 0 0 1-2 2h-3.6"/><path d="M9.6 8.2L5.8 12l3.8 3.8M5.8 12h8.6"/>',
  download: '<path d="M12 3.6v11.2M7.6 10.6L12 15l4.4-4.4"/><path d="M4.4 17.6v1.4a1.6 1.6 0 0 0 1.6 1.6h12a1.6 1.6 0 0 0 1.6-1.6v-1.4"/>',
  mail: '<rect x="2.8" y="5" width="18.4" height="14" rx="2.6"/><path d="M3.6 7.4l7.3 5.1a2 2 0 0 0 2.2 0l7.3-5.1"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3.2 12h17.6"/><path d="M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18z"/>',
  'chevron-down': '<path d="M6.4 9.4L12 15l5.6-5.6"/>',
  'chevron-right': '<path d="M9.4 6.4L15 12l-5.6 5.6"/>',
};

/** Nom d'icône disponible ? */
export const hasIcon = (name) => Object.hasOwn(PATHS, name);

/**
 * Produit le balisage SVG d'une icône.
 * @param {string} name  nom d'une icône (voir PATHS)
 * @param {{size?:number, cls?:string, stroke?:number}} [options]
 */
export function icon(name, options = {}) {
  const body = PATHS[name];
  if (!body) return '';
  const { size = 18, cls = '', stroke = 1.7 } = options;
  return `<svg class="ico${cls ? ` ${cls}` : ''}" width="${size}" height="${size}" `
    + `viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${stroke}" `
    + `stroke-linecap="round" stroke-linejoin="round" role="img" aria-hidden="true">${body}</svg>`;
}

/** Liste des noms disponibles (usage admin / documentation). */
export const iconNames = Object.keys(PATHS);
