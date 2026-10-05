/** KALEA — état global partagé par l'application côté client. */
export const state = {
  user: null,
  config: null,
  packs: [],
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
