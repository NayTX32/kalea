/**
 * KALEA — vues Connexion / Inscription (e-mail + Discord OAuth2).
 */
import { post } from '../api.js';
import { state, setUser } from '../state.js';
import { esc, toastSuccess, toastError, loadingButton, icon } from '../ui.js';
import { navigate } from '../router.js';

export function authView({ query }) {
  const next = query.get('next') ?? '/mon-compte';
  const mode = query.get('mode') === 'inscription' ? 'register' : 'login';
  const discordReady = Boolean(state.config?.discord?.oauth);
  const demo = Boolean(state.config?.payments?.demo);
  // Retours du callback Discord : refus, échec ou succès.
  const oauthError = query.get('error');
  const oauthOk = query.get('discord') === 'ok';
  const html = `
    <section class="section">
      <div class="container" style="max-width:520px">
        <div class="center" style="margin-bottom:28px">
          <div class="eyebrow" style="justify-content:center">Compte KALEA</div>
          <h1 class="h2" id="authTitle">${mode === 'login' ? 'Bon retour parmi <span class="grad-text">nous</span>' : 'Créez votre <span class="grad-text">compte</span>'}</h1>
          <p class="muted small" style="margin-top:10px">
            Suivez vos commandes, connectez votre Discord et recevez vos récompenses.
          </p>
        </div>

        <div class="center" style="margin-bottom:22px">
          <div class="tabs" role="tablist">
            <button class="tab ${mode === 'login' ? 'active' : ''}" data-tab="login" role="tab">Connexion</button>
            <button class="tab ${mode === 'register' ? 'active' : ''}" data-tab="register" role="tab">Inscription</button>
          </div>
        </div>

        <div class="card">
          ${oauthError ? `
          <div class="notice notice-warn" style="margin-bottom:16px" role="alert">
            ${icon('alert', { size: 20 })}
            <div class="small">${esc(oauthError)}</div>
          </div>` : ''}
          ${oauthOk ? `
          <div class="notice notice-info" style="margin-bottom:16px" role="status">
            ${icon('check-circle', { size: 20 })}
            <div class="small">Connexion Discord réussie — bienvenue !</div>
          </div>` : ''}
          <a class="btn btn-discord btn-block" href="/api/auth/discord?return=${encodeURIComponent(next)}">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style="margin-right:2px">
              <path d="M19.27 5.33A16.6 16.6 0 0 0 15.1 4.03a.07.07 0 0 0-.07.03c-.18.32-.38.74-.52 1.07a15.3 15.3 0 0 0-4.5 0c-.14-.34-.35-.75-.53-1.07a.07.07 0 0 0-.07-.03c-1.47.25-2.88.68-4.17 1.3a.06.06 0 0 0-.03.02C2.5 9.4 1.77 13.37 2.13 17.3c0 .02.01.04.03.05a16.7 16.7 0 0 0 5.03 2.55.07.07 0 0 0 .08-.03c.39-.53.73-1.1 1.02-1.69a.07.07 0 0 0-.04-.1 11 11 0 0 1-1.57-.75.07.07 0 0 1 0-.11l.31-.29a.07.07 0 0 1 .07-.01c3.29 1.5 6.85 1.5 10.1 0a.07.07 0 0 1 .08 0l.32.3a.07.07 0 0 1 0 .1c-.5.3-1.02.55-1.57.75a.07.07 0 0 0-.04.1c.3.6.64 1.16 1.02 1.69a.07.07 0 0 0 .08.03 16.6 16.6 0 0 0 5.04-2.55.07.07 0 0 0 .03-.05c.44-4.53-.73-8.47-3.1-11.95a.06.06 0 0 0-.03-.02ZM8.52 15.04c-1 0-1.82-.92-1.82-2.05s.8-2.05 1.82-2.05c1.03 0 1.85.93 1.83 2.05 0 1.13-.8 2.05-1.83 2.05Zm6.73 0c-1 0-1.82-.92-1.82-2.05s.8-2.05 1.82-2.05c1.03 0 1.84.93 1.83 2.05 0 1.13-.8 2.05-1.83 2.05Z"/>
            </svg>
            Continuer avec Discord
          </a>
          <p class="tiny center" style="margin-top:10px">
            ${discordReady ? 'Connexion sécurisée OAuth2 — vos rôles sont attribués automatiquement.'
              : 'Connexion instantanée via Discord (mode démonstration, sans application réelle).'}
          </p>
          <div class="row" style="margin:18px 0;gap:12px">
            <div class="grow divider" style="margin:0"></div><span class="tiny">ou par e-mail</span><div class="grow divider" style="margin:0"></div>
          </div>

          <form id="authForm" class="stack" novalidate>
            <div class="field" id="nameField" ${mode === 'login' ? 'hidden' : ''}>
              <label class="label" for="aName">Pseudo</label>
              <input class="input" id="aName" name="displayName" placeholder="Votre pseudo en jeu" autocomplete="nickname" />
            </div>
            <div class="field">
              <label class="label" for="aEmail">Adresse e-mail</label>
              <input class="input" id="aEmail" name="email" type="email" placeholder="vous@exemple.fr" autocomplete="email" required />
            </div>
            <div class="field">
              <label class="label" for="aPassword">Mot de passe</label>
              <input class="input" id="aPassword" name="password" type="password" placeholder="8 caractères minimum, avec un chiffre" autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}" required />
            </div>
            <div class="form-error" id="authError"></div>
            <button class="btn btn-primary btn-block" type="submit" id="authSubmit">
              ${mode === 'login' ? 'Se connecter' : 'Créer mon compte'}
            </button>
          </form>

          <p class="tiny center" style="margin-top:16px">
            En continuant, vous acceptez les conditions de vente et la politique de confidentialité de KALEA.
          </p>
        </div>

        ${demo ? `
        <div class="notice notice-info" style="margin-top:20px">
          ${icon('flask', { size: 20 })}
          <div class="small"><strong>Mode démonstration :</strong> aucun prestataire de paiement n'est configuré. Le tunnel de paiement simulé (webhook signé inclus) est actif pour vos tests.</div>
        </div>` : ''}
      </div>
    </section>`;

  return {
    title: mode === 'login' ? 'Connexion' : 'Inscription',
    html,
    mount(root) {
      const form = root.querySelector('#authForm');
      const errorEl = root.querySelector('#authError');
      const nameField = root.querySelector('#nameField');
      const title = root.querySelector('#authTitle');
      const submit = root.querySelector('#authSubmit');
      let currentMode = mode;

      const switchMode = (nextMode) => {
        currentMode = nextMode;
        root.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === nextMode));
        nameField.hidden = nextMode === 'login';
        title.innerHTML = nextMode === 'login'
          ? 'Bon retour parmi <span class="grad-text">nous</span>'
          : 'Créez votre <span class="grad-text">compte</span>';
        submit.textContent = nextMode === 'login' ? 'Se connecter' : 'Créer mon compte';
        errorEl.textContent = '';
      };

      root.querySelectorAll('.tab').forEach((tab) => {
        tab.addEventListener('click', () => {
          switchMode(tab.dataset.tab);
          history.replaceState({}, '', `/connexion?mode=${tab.dataset.tab === 'register' ? 'inscription' : 'connexion'}&next=${encodeURIComponent(next)}`);
        });
      });

      form?.addEventListener('submit', async (event) => {
        event.preventDefault();
        errorEl.textContent = '';
        const data = Object.fromEntries(new FormData(form).entries());
        const restore = loadingButton(submit, currentMode === 'login' ? 'Connexion…' : 'Création…');
        try {
          const path = currentMode === 'login' ? '/api/auth/login' : '/api/auth/register';
          const res = await post(path, data);
          setUser(res.user);
          toastSuccess(currentMode === 'login' ? `Ravi de vous revoir, ${res.user.displayName} !` : 'Votre compte KALEA est créé.', 'Connecté');
          navigate(next.startsWith('/') && !next.startsWith('//') ? next : '/mon-compte');
        } catch (error) {
          restore();
          errorEl.textContent = error.message;
          toastError(error.message);
        }
      });
    },
  };
}

/* --------------------- Écran de consentement Discord ---------------------
 * Affiché quand aucune application Discord n'est configurée : on reproduit
 * l'écran d'autorisation OAuth2 (mode démonstration, 100 % local).
 * ----------------------------------------------------------------------- */

const DISCORD_MARK = `<svg width="34" height="34" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
  <path d="M19.27 5.33A16.6 16.6 0 0 0 15.1 4.03a.07.07 0 0 0-.07.03c-.18.32-.38.74-.52 1.07a15.3 15.3 0 0 0-4.5 0c-.14-.34-.35-.75-.53-1.07a.07.07 0 0 0-.07-.03c-1.47.25-2.88.68-4.17 1.3a.06.06 0 0 0-.03.02C2.5 9.4 1.77 13.37 2.13 17.3c0 .02.01.04.03.05a16.7 16.7 0 0 0 5.03 2.55.07.07 0 0 0 .08-.03c.39-.53.73-1.1 1.02-1.69a.07.07 0 0 0-.04-.1 11 11 0 0 1-1.57-.75.07.07 0 0 1 0-.11l.31-.29a.07.07 0 0 1 .07-.01c3.29 1.5 6.85 1.5 10.1 0a.07.07 0 0 1 .08 0l.32.3a.07.07 0 0 1 0 .1c-.5.3-1.02.55-1.57.75a.07.07 0 0 0-.04.1c.3.6.64 1.16 1.02 1.69a.07.07 0 0 0 .08.03 16.6 16.6 0 0 0 5.04-2.55.07.07 0 0 0 .03-.05c.44-4.53-.73-8.47-3.1-11.95a.06.06 0 0 0-.03-.02ZM8.52 15.04c-1 0-1.82-.92-1.82-2.05s.8-2.05 1.82-2.05c1.03 0 1.85.93 1.83 2.05 0 1.13-.8 2.05-1.83 2.05Zm6.73 0c-1 0-1.82-.92-1.82-2.05s.8-2.05 1.82-2.05c1.03 0 1.84.93 1.83 2.05 0 1.13-.8 2.05-1.83 2.05Z"/>
</svg>`;

export function discordConsentView({ query }) {
  const returnTo = query.get('return') ?? '/mon-compte';
  const safeReturn = returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/mon-compte';
  const discordReady = Boolean(state.config?.discord?.oauth);

  const html = `
    <section class="section gate-section">
      <div class="container" style="max-width:470px">
        <div class="discord-card">
          <div class="discord-head">
            <span class="discord-icon">${DISCORD_MARK}</span>
            <div>
              <div class="discord-app">KALEA</div>
              <div class="tiny muted">Boutique officielle</div>
            </div>
          </div>

          <h1 class="h3 center" style="margin-top:6px">
            <strong>KALEA</strong> souhaite accéder à votre compte Discord
          </h1>

          ${discordReady ? `
            <div class="notice notice-info" style="margin-top:20px"><span>🔐</span>
              <div class="small">L'application Discord est configurée : la fenêtre d'autorisation officielle va s'ouvrir.</div>
            </div>
            <a class="btn btn-discord btn-block" style="margin-top:20px"
               href="/api/auth/discord?return=${encodeURIComponent(safeReturn)}">Continuer vers Discord</a>
          ` : `
            <div class="discord-perms">
              <div class="discord-perm"><span>👤</span>
                <div><strong>Votre identité</strong><div class="tiny muted">Pseudo, avatar et identifiant Discord</div></div>
              </div>
              <div class="discord-perm"><span>🏰</span>
                <div><strong>Appartenance au serveur KALEA</strong><div class="tiny muted">Pour attribuer vos rôles (Pack de Base, Full Locker, Moder)</div></div>
              </div>
              <div class="discord-perm"><span>🔗</span>
                <div><strong>Liaison au compte KALEA</strong><div class="tiny muted">Vos achats et récompenses vous suivent</div></div>
              </div>
            </div>

            <form id="discordForm" class="stack" style="margin-top:22px" novalidate>
              <div class="field">
                <label class="label" for="dName">Votre pseudo Discord</label>
                <input class="input" id="dName" name="username" value="${esc(state.user?.displayName ?? 'JoueurKalea')}"
                       minlength="2" maxlength="32" required />
              </div>
              <div class="form-error" id="discordError"></div>
              <button class="btn btn-discord btn-block" type="submit" id="discordSubmit">Autoriser</button>
              <button class="btn btn-ghost btn-block" type="button" id="discordDeny">Refuser</button>
            </form>

            <p class="tiny center" style="margin-top:16px">
              🧪 Mode démonstration : aucune donnée ne sort de votre machine. Renseignez
              <code>DISCORD_CLIENT_ID</code> / <code>DISCORD_CLIENT_SECRET</code> pour la vraie connexion OAuth2.
            </p>
          `}

          <div class="gate-sep"><span></span><em>ou</em><span></span></div>
          <a class="btn btn-ghost btn-block" href="/connexion?next=${encodeURIComponent(safeReturn)}" data-link>Retour à la connexion</a>
        </div>
      </div>
    </section>`;

  return {
    title: 'Connexion Discord',
    html,
    mount(root) {
      root.querySelector('#discordDeny')?.addEventListener('click', () => {
        toastError('Connexion Discord annulée.', 'Refusé');
        navigate(`/connexion?next=${encodeURIComponent(safeReturn)}`);
      });

      const form = root.querySelector('#discordForm');
      form?.addEventListener('submit', async (event) => {
        event.preventDefault();
        const errorEl = root.querySelector('#discordError');
        errorEl.textContent = '';
        const data = Object.fromEntries(new FormData(form).entries());
        const restore = loadingButton(root.querySelector('#discordSubmit'), 'Autorisation…');
        try {
          const res = await post('/api/auth/discord/demo', { ...data, returnTo: safeReturn });
          setUser(res.user);
          toastSuccess(`Bienvenue ${res.user.displayName} ! Compte Discord lié.`, 'Connecté avec Discord');
          navigate(safeReturn);
        } catch (error) {
          restore();
          errorEl.textContent = error.message;
          toastError(error.message);
        }
      });
    },
  };
}
