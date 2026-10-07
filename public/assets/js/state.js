/** KALEA — état global partagé par l'application côté client. */
export const state = {
  user: null,
  config: null,
  packs: [],
  /** Panier : [{ packId, qty }] — hydraté depuis le stockage local au 1er usage. */
  cart: null,
  booted: false,
};

export const isLogged = () => Boolean(state.user);
export const isAdmin = () => state.user?.role === 'admin';

/** Modifie l'utilisateur courant et notifie l'interface (en-tête, navigation). */
export function setUser(user) {
  state.user = user;
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('kalea:state'));
  }
}

export const payments = () => state.config?.payments ?? { methods: [], active: 'demo', demo: true };

/* -------------------------------- Panier --------------------------------
 * Stockage local uniquement : le panier ne contient AUCUN prix (ils sont
 * toujours relevés côté serveur au moment de la commande).
 */

const CART_KEY = 'kalea_cart';

/** Lit le panier local (une fois, puis l'état fait foi). */
export function loadCart() {
  if (Array.isArray(state.cart)) return state.cart;
  let rows = [];
  try { rows = JSON.parse(localStorage.getItem(CART_KEY) ?? '[]'); } catch { rows = []; }
  state.cart = Array.isArray(rows)
    ? rows.filter((row) => row && typeof row.packId === 'string' && row.packId)
    : [];
  return state.cart;
}

function persist(items) {
  state.cart = items;
  try { localStorage.setItem(CART_KEY, JSON.stringify(items)); } catch { /* stockage indisponible */ }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('kalea:cart', { detail: items }));
  }
}

export const cartItems = () => loadCart();
export const cartCount = () => loadCart().reduce((total, row) => total + (row.qty ?? 1), 0);
export const inCart = (packId) => loadCart().some((row) => row.packId === packId);

/**
 * Ajoute un pack au panier.
 * Un pack numérique est valable une seule fois par compte : la quantité
 * reste donc à 1 (le serveur refuse toute autre valeur).
 * @returns {boolean} true si l'article a été ajouté, false s'il y était déjà.
 */
export function addToCart(packId) {
  const items = loadCart();
  if (items.some((row) => row.packId === packId)) return false;
  persist([...items, { packId, qty: 1 }]);
  return true;
}

export function removeFromCart(packId) {
  persist(loadCart().filter((row) => row.packId !== packId));
}

/** Fixe la quantité (bornée à 1 : qty ≤ 0 retire l'article). */
export function setCartQty(packId, qty) {
  if (!qty || qty <= 0) { removeFromCart(packId); return; }
  persist(loadCart().map((row) => (row.packId === packId ? { ...row, qty: 1 } : row)));
}

export function clearCart() { persist([]); }
