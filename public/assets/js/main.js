/**
 * KALEA — amorçage de l'application : configuration, session, routes, chrome.
 */
import { get, post } from './api.js';
import { state } from './state.js';
import { esc, toastError, toastSuccess, qs, icon, applyTheme } from './ui.js';
import { register, startRouter, navigate, setAdminGate } from './router.js';

import { homeView } from './views/home.js';
import { shopView, packsView } from './views/shop.js';
import { faqView, supportView, notFoundView } from './views/pages.js';
import { authView, discordConsentView } from './views/auth.js';
import { accountView, orderView, demoPayView } from './views/account.js';
import {
  adminOverviewView, adminStatsView, adminPacksView, adminOrdersView,
  adminPaymentsView, adminUsersView, adminDeliveriesView, adminErrorsView,
  adminGameView, adminLogsView, adminTicketsView, adminSettingsView,
  adminGateView,
} from './views/admin.js';

/* ------------------------------ Routage -------------------------------- */

register('/', homeView);
register('/boutique', shopView);
register('/packs', packsView);
register('/faq', faqView);
register('/support', supportView);
register('/connexion', authView, { guest: true });
register('/connexion/discord', discordConsentView);
register('/mon-compte', accountView, { auth: true });
register('/commande/:id', orderView, { auth: true });
register('/paiement-demo/:id', demoPayView, { auth: true });

register('/admin', adminOverviewView, { admin: true });
register('/admin/statistiques', adminStatsView, { admin: true });
register('/admin/packs', adminPacksView, { admin: true });
register('/admin/commandes', adminOrdersView, { admin: true });
register('/admin/paiements', adminPaymentsView, { admin: true });
register('/admin/utilisateurs', adminUsersView, { admin: true });
register('/admin/livraisons', adminDeliveriesView, { admin: true });
register('/admin/erreurs', adminErrorsView, { admin: true });
register('/admin/jeu', adminGameView, { admin: true });
register('/admin/logs', adminLogsView, { admin: true });
register('/admin/tickets', adminTicketsView, { admin: true });
register('/admin/parametres', adminSettingsView, { admin: true });

register('/404', notFoundView);

// Toute route /admin* est protégée par l'écran de mot de passe administrateur.
setAdminGate(adminGateView);

/* --------------------------- Chrome (header) --------------------------- */

function renderHeader() {
  const actions = qs('#headerActions');
  const loginBtn = qs('#btnLogin');
  const adminNav = qs('#navAdmin');
  const user = state.user;

  if (adminNav) adminNav.hidden = user?.role !== 'admin';

  if (user) {
    if (loginBtn) {
      const initial = (user.displayName ?? '?').charAt(0).toUpperCase();
      loginBtn.className = 'user-chip';
      loginBtn.removeAttribute('style');
      loginBtn.setAttribute('href', '/mon-compte');
      loginBtn.innerHTML = `
        <span class="avatar" style="width:26px;height:26px;border-radius:8px;font-size:.78rem">
          ${user.avatar ? `<img src="${esc(user.avatar)}" alt="" />` : esc(initial)}
        </span>
        <span>${esc(user.displayName)}</span>`;
    }
  } else if (loginBtn) {
    loginBtn.className = 'btn btn-ghost btn-sm btn-hide-mobile';
    loginBtn.setAttribute('href', '/connexion');
    loginBtn.textContent = 'Connexion';
  }

  const cta = qs('#btnCta');
  if (cta) cta.textContent = user?.role === 'admin' ? 'Dashboard' : 'Acheter un pack';
  if (cta) cta.setAttribute('href', user?.role === 'admin' ? '/admin' : '/boutique');
}

function renderFooter() {
  const year = qs('#year');
  if (year) year.textContent = String(new Date().getFullYear());

  const cfg = state.config;
  const provider = qs('#footerProvider');
  if (provider && cfg?.payments) {
    provider.textContent = `${cfg.payments.activeLabel} · Aucune donnée bancaire stockée`;
  }
  const discord = qs('#footerDiscord');
  if (discord && cfg?.discord?.invite) discord.href = cfg.discord.invite;

  const pays = qs('#footerPays');
  if (pays && cfg?.payments?.methods) {
    pays.innerHTML = cfg.payments.methods.slice(0, 6)
      .map((m) => `<span class="badge">${esc(m)}</span>`).join('');
  }
}

/* ------------------------------- Boot ---------------------------------- */

async function boot() {
  // 1. Configuration publique + session courante (en parallèle).
  const [configResult, meResult] = await Promise.allSettled([
    get('/api/config'),
    get('/api/me'),
  ]);
  state.config = configResult.status === 'fulfilled' ? configResult.value : null;
  state.user = meResult.status === 'fulfilled' ? (meResult.value?.user ?? null) : null;

  // Fond de site choisi dans /admin/parametres (préréglage ou image).
  applyTheme(state.config?.theme?.background ?? 'nebuleuse');

  renderHeader();
  renderFooter();
  // L'en-tête suit les changements de session (connexion, déconnexion, profil).
  window.addEventListener('kalea:state', renderHeader);

  // 2. Menu mobile.
  const burger = qs('#burger');
  burger?.addEventListener('click', () => {
    const open = document.body.classList.toggle('nav-open');
    burger.setAttribute('aria-expanded', String(open));
  });

  // 3. Effet de profondeur du header.
  const header = qs('#header');
  const onScroll = () => header?.classList.toggle('scrolled', window.scrollY > 8);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // 4. État des services (footer).
  qs('#footerStatus')?.addEventListener('click', (event) => {
    event.preventDefault();
    const p = state.config?.payments ?? {};
    const d = state.config?.discord ?? {};
    const g = state.config?.game ?? {};
    toastSuccess(
      `Paiement : ${p.activeLabel} — Discord : ${d.oauth ? 'OAuth2 configuré' : 'non configuré'} — API jeu : ${g.configured ? 'connectée' : 'non configurée'}`,
      'État des services KALEA',
    );
  });

  // 5. Routeur.
  startRouter({
    element: qs('#view'),
    getState: () => state,
    onError: (error) => {
      console.error(error);
      if (error?.status === 401) {
        navigate('/connexion');
        return;
      }
      qs('#view').innerHTML = `
        <section class="section"><div class="container center" style="max-width:620px">
          <div style="color:var(--danger)">${icon('alert', { size: 54, stroke: 1.4 })}</div>
          <h1 class="h2" style="margin-top:8px">Une erreur est survenue</h1>
          <p class="lead" style="margin:14px auto 22px;text-align:center">${esc(error?.message ?? 'Erreur inattendue')}</p>
          <div class="row" style="justify-content:center">
            <button class="btn btn-primary" onclick="location.reload()">Recharger</button>
            <a class="btn btn-ghost" href="/" data-link>Retour à l’accueil</a>
          </div>
        </div></section>`;
      toastError(error?.message ?? 'Erreur inattendue');
    },
  });

  state.booted = true;
}

boot().catch((error) => {
  console.error('boot_failed', error);
  qs('#view').innerHTML = `
    <section class="section"><div class="container center">
      <h1 class="h2">KALEA n’a pas pu démarrer</h1>
      <p class="lead" style="margin:14px auto 22px;text-align:center">${esc(error.message)}</p>
      <button class="btn btn-primary" onclick="location.reload()">Réessayer</button>
    </div></section>`;
});
