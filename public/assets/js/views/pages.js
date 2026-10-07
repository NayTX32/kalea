/**
 * KALEA — vues FAQ, Support et 404.
 */
import { get, post } from '../api.js';
import { state, isLogged } from '../state.js';
import { esc, reveal, accordion, toastSuccess, toastError, emptyState, loadingButton, badge, icon } from '../ui.js';
import { navigate } from '../router.js';

/* --------------------------------- FAQ --------------------------------- */

export async function faqView() {
  let items = [];
  try { items = (await get('/api/faq')).items ?? []; } catch { items = []; }

  const html = `
    <section class="section-sm">
      <div class="container" style="max-width:880px">
        <div class="eyebrow">Aide</div>
        <h1 class="h2">Questions <span class="grad-text">fréquentes</span></h1>
        <p class="lead" style="margin-top:14px">
          Tout ce qu'il faut savoir sur l'achat, la livraison des récompenses et la sécurité de KaleaShop.
        </p>
      </div>
    </section>

    <section class="section-sm" style="padding-top:0">
      <div class="container" style="max-width:880px">
        <div class="eyebrow">Achats & livraison</div>
        <div style="margin-bottom:34px">
          ${items.slice(0, 5).map((item) => `
            <div class="acc">
              <button class="acc-head">${esc(item.q)}<span class="ico">+</span></button>
              <div class="acc-body"><div class="acc-body-inner">${esc(item.a)}</div></div>
            </div>`).join('')}
        </div>

        <div class="eyebrow">Paiement & sécurité</div>
        <div style="margin-bottom:34px">
          ${items.slice(5).map((item) => `
            <div class="acc">
              <button class="acc-head">${esc(item.q)}<span class="ico">+</span></button>
              <div class="acc-body"><div class="acc-body-inner">${esc(item.a)}</div></div>
            </div>`).join('')}
        </div>

        <div class="grid grid-2" style="margin-top:36px">
          <div class="card reveal">
            <div class="card-title">🔐 Sécurité</div>
            <ul class="pack-features" style="margin-top:12px">
              <li><span class="tick">✓</span><span>HTTPS et cookies de session sécurisés</span></li>
              <li><span class="tick">✓</span><span>Webhooks de paiement vérifiés par signature HMAC</span></li>
              <li><span class="tick">✓</span><span>Validation de toutes les données côté serveur</span></li>
              <li><span class="tick">✓</span><span>Rate limiting et protection CSRF</span></li>
              <li><span class="tick">✓</span><span>Secrets uniquement côté serveur</span></li>
              <li><span class="tick">✓</span><span>Journal complet des transactions</span></li>
            </ul>
          </div>
          <div class="card reveal">
            <div class="card-title">${icon('card', { size: 19 })} Votre paiement</div>
            <p class="muted small" style="margin-top:12px">
              KaleaShop utilise un prestataire professionnel de paiement. Les moyens proposés
              dépendent de votre pays : PayPal, carte bancaire (Visa, Mastercard, Amex, CB),
              Apple Pay, Google Pay, SEPA, virement et moyens locaux.
            </p>
            <p class="muted small" style="margin-top:12px">
              <strong>Aucune donnée bancaire n'est stockée sur KaleaShop.</strong> Les paiements
              échoués, annulés et remboursés sont gérés automatiquement.
            </p>
            <div class="pill-group" style="margin-top:16px">
              ${(state.config?.payments?.methods ?? []).map((m) => `<span class="badge">${esc(m)}</span>`).join('')}
            </div>
          </div>
        </div>

        <div class="card reveal" style="margin-top:30px;text-align:center">
          <div class="card-title">Vous ne trouvez pas votre réponse ?</div>
          <p class="muted small" style="margin-top:8px">Notre équipe répond sous 24 h ouvrées.</p>
          <div class="row" style="justify-content:center;margin-top:18px;flex-wrap:wrap">
            <a class="btn btn-primary" href="/support" data-link>Contacter le support</a>
            <a class="btn btn-ghost" href="/mon-compte" data-link>Voir mes commandes</a>
          </div>
        </div>
      </div>
    </section>`;

  return {
    title: 'FAQ',
    html,
    mount(root) { accordion(root); reveal(root); },
  };
}

/* ------------------------------- Support ------------------------------- */

export async function supportView() {
  let categories = ['achat', 'paiement', 'livraison', 'discord', 'jeu', 'compte', 'autre'];
  try { categories = (await get('/api/support/categories')).categories ?? categories; } catch { /* défaut */ }
  const user = state.user;
  const email = user?.email ?? '';
  const name = user?.displayName ?? '';

  const html = `
    <section class="section-sm">
      <div class="container">
        <div class="eyebrow">Support KaleaShop</div>
        <h1 class="h2">Comment pouvons-nous <span class="grad-text">vous aider</span> ?</h1>
        <p class="lead" style="margin-top:14px">
          Problème de livraison, paiement, rôle Discord ou compte : décrivez votre situation,
          nous traitons chaque demande individuellement.
        </p>
      </div>
    </section>

    <section class="section-sm" style="padding-top:0">
      <div class="container">
        <div class="grid" style="grid-template-columns:1.4fr 1fr;gap:26px">
          <div class="card reveal">
            <div class="card-title">Ouvrir une demande</div>
            <p class="muted small" style="margin-top:6px">Réponse par e-mail sous 24 h ouvrées.</p>
            <form id="supportForm" class="stack" style="margin-top:22px" novalidate>
              <div class="form-grid">
                <div class="field">
                  <label class="label" for="sName">Nom</label>
                  <input class="input" id="sName" name="name" value="${esc(name)}" placeholder="Votre pseudo" required />
                </div>
                <div class="field">
                  <label class="label" for="sEmail">E-mail</label>
                  <input class="input" id="sEmail" name="email" type="email" value="${esc(email)}" placeholder="vous@exemple.fr" required />
                </div>
              </div>
              <div class="form-grid">
                <div class="field">
                  <label class="label" for="sCategory">Catégorie</label>
                  <select class="select" id="sCategory" name="category">
                    ${categories.map((c) => `<option value="${esc(c)}">${esc(c.charAt(0).toUpperCase() + c.slice(1))}</option>`).join('')}
                  </select>
                </div>
                <div class="field">
                  <label class="label" for="sSubject">Sujet</label>
                  <input class="input" id="sSubject" name="subject" placeholder="Résumé du problème" required />
                </div>
              </div>
              <div class="field">
                <label class="label" for="sMessage">Message</label>
                <textarea class="textarea" id="sMessage" name="message" placeholder="Décrivez votre problème : numéro de commande, état du paiement, pack concerné…" required></textarea>
              </div>
              <div class="form-error" id="supportError"></div>
              <button class="btn btn-primary" type="submit">Envoyer la demande</button>
            </form>
          </div>

          <div class="stack">
            <div class="card reveal">
              <div class="card-title">⚡ Livraison non reçue ?</div>
              <p class="muted small" style="margin-top:8px">
                Connectez votre Discord et renseignez votre identifiant de jeu dans
                « Mon compte », puis cliquez sur « Relancer la livraison » : les récompenses
                déjà attribuées ne sont jamais dupliquées.
              </p>
              <a class="btn btn-ghost btn-sm" href="/mon-compte" data-link style="margin-top:14px">Mon compte</a>
            </div>
            <div class="card reveal">
              <div class="card-title">${icon('receipt', { size: 19 })} Suivre ma commande</div>
              <p class="muted small" style="margin-top:8px">
                Toutes vos commandes, statuts de paiement et étapes de livraison sont visibles
                dans votre historique.
              </p>
              <a class="btn btn-ghost btn-sm" href="/mon-compte" data-link style="margin-top:14px">Historique</a>
            </div>
            <div class="card reveal">
              <div class="card-title">${icon('message', { size: 19 })} Communauté</div>
              <p class="muted small" style="margin-top:8px">Le serveur Discord est le plus rapide pour une question générale.</p>
              <a class="btn btn-discord btn-sm" id="supportDiscord" href="${esc(state.config?.discord?.invite ?? '#')}" target="_blank" rel="noopener" style="margin-top:14px">Rejoindre le Discord</a>
            </div>
          </div>
        </div>
      </div>
    </section>`;

  return {
    title: 'Support',
    html,
    mount(root) {
      reveal(root);
      const form = root.querySelector('#supportForm');
      const errorEl = root.querySelector('#supportError');
      form?.addEventListener('submit', async (event) => {
        event.preventDefault();
        errorEl.textContent = '';
        const data = Object.fromEntries(new FormData(form).entries());
        const button = form.querySelector('button[type="submit"]');
        const restore = loadingButton(button, 'Envoi…');
        try {
          const res = await post('/api/support/tickets', data);
          form.reset();
          toastSuccess(`Votre demande ${res.ref} a été enregistrée.`, 'Demande envoyée');
          navigate('/faq');
        } catch (error) {
          restore();
          errorEl.textContent = error.message;
          toastError(error.message);
        }
      });
    },
  };
}

/* --------------------------------- 404 --------------------------------- */

export function notFoundView() {
  return {
    title: 'Page introuvable',
    html: `
      <section class="section">
        <div class="container center" style="max-width:640px">
          <div style="font-size:5rem;font-weight:900;letter-spacing:-.05em" class="grad-text">404</div>
          <h1 class="h2" style="margin-top:6px">Cette page n'existe pas</h1>
          <p class="lead" style="margin:16px auto 28px;text-align:center">
            Le lien est peut-être obsolète. Retrouvez tous les packs dans la boutique officielle.
          </p>
          <div class="row" style="justify-content:center;flex-wrap:wrap">
            <a class="btn btn-primary" href="/" data-link>Retour à l'accueil</a>
            <a class="btn btn-ghost" href="/boutique" data-link>Voir la boutique</a>
          </div>
        </div>
      </section>`,
  };
}
