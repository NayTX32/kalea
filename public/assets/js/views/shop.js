/**
 * KALEA — vue Boutique (grille d'achat) + vue Packs (comparatif détaillé).
 */
import { get, post } from '../api.js';
import { state, isLogged } from '../state.js';
import { esc, toastError, toastSuccess, reveal, accordion, badge, emptyState, loadingButton, fmtEUR, icon } from '../ui.js';
import { navigate } from '../router.js';

/* --------------------------- Composant pack --------------------------- */

export function packCard(pack, { featured = false, actions = true } = {}) {
  const features = (pack.features ?? []).slice(0, 6);
  return `
    <article class="pack-card ${featured ? 'featured' : ''} reveal">
      ${pack.badge ? `<span class="pack-badge">${esc(pack.badge)}</span>` : ''}
      <div class="row" style="gap:16px;align-items:flex-start">
        <div class="pack-emoji">${esc(pack.emoji ?? '🎁')}</div>
        <div>
          <div class="pack-name">${esc(pack.name)}</div>
          <div class="muted small">${esc(pack.tagline ?? '')}</div>
        </div>
      </div>
      <div class="pack-price">
        <span class="amount">${esc(pack.price)}</span><span class="cur">€</span>
        <span class="badge" style="margin-left:auto">Paiement unique</span>
      </div>
      <ul class="pack-features">
        ${features.map((f) => `<li><span class="tick">✓</span><span>${esc(f)}</span></li>`).join('')}
      </ul>
      ${actions ? `
      <div class="stack" style="gap:10px;margin-top:auto">
        <button class="btn btn-primary btn-block" data-buy="${esc(pack.id)}">Acheter — ${esc(pack.price)} €</button>
        <a class="btn btn-ghost btn-block btn-sm" href="/packs" data-link>Détails du pack</a>
      </div>` : ''}
    </article>`;
}

/* ------------------------ Achat (création + paiement) ------------------ */

export async function buyPack(pack, button) {
  if (!isLogged()) {
    toastError('Connectez-vous pour acheter un pack.', 'Connexion requise');
    navigate(`/connexion?next=${encodeURIComponent(`/boutique?buy=${pack.id}`)}`);
    return;
  }
  const restore = button ? loadingButton(button, 'Redirection…') : () => {};
  try {
    const idempotencyKey = `web_${pack.id}_${state.user.id}_${Math.random().toString(36).slice(2, 10)}`;
    const { order } = await post('/api/orders', { packId: pack.id, idempotencyKey });
    if (order.status === 'paid') {
      toastSuccess('Vous possédez déjà ce pack. Vos récompenses ont été vérifiées.', 'Déjà payé');
      navigate(`/commande/${order.id}`);
      return;
    }
    const { checkout } = await post(`/api/orders/${order.id}/checkout`);
    window.location.href = checkout.url;
  } catch (error) {
    restore();
    toastError(error.message);
  }
}

function bindBuyButtons(root, packs) {
  root.querySelectorAll('[data-buy]').forEach((button) => {
    button.addEventListener('click', () => {
      const pack = packs.find((p) => p.id === button.dataset.buy || p.slug === button.dataset.buy);
      if (pack) buyPack(pack, button);
    });
  });
}

async function loadPacks() {
  if (state.packs.length) return state.packs;
  const data = await get('/api/packs');
  state.packs = data.packs ?? [];
  return state.packs;
}

/* ------------------------------- Boutique ------------------------------ */

export async function shopView() {
  let packs = [];
  try {
    packs = await loadPacks();
  } catch (error) {
    return { title: 'Boutique', html: `<div class="container section">${emptyState('alert', 'Boutique indisponible', error.message)}</div>` };
  }

  const methods = state.config?.payments?.methods ?? [];
  const query = new URLSearchParams(location.search);
  const highlight = query.get('buy');

  const html = `
    <section class="section-sm">
      <div class="container">
        <div class="eyebrow">Boutique officielle</div>
        <h1 class="h2">Choisissez votre pack<span class="grad-text">.</span></h1>
        <p class="lead" style="margin-top:14px">
          Paiement sécurisé, livraison automatique : votre rôle Discord et vos récompenses en jeu
          sont attribués dès la confirmation du paiement — jamais de double attribution.
        </p>
      </div>
    </section>

    <section class="section-sm" style="padding-top:0">
      <div class="container">
        <div class="grid grid-3" id="packGrid">
          ${packs.map((p) => packCard(p, { featured: p.badge === 'Populaire' || highlight === p.id })).join('')}
        </div>

        <div class="pay-row center" style="margin-top:42px">
          <span class="pay-label">${icon('shield-check', { size: 16 })} Paiement sécurisé</span>
          <div class="pay-chips">
            ${methods.map((m) => `<span class="pay-chip">${esc(m)}</span>`).join('') || '<span class="pay-chip">Paiement sécurisé</span>'}
          </div>
        </div>
      </div>
    </section>`;

  return {
    title: 'Boutique',
    html,
    mount(root) {
      bindBuyButtons(root, packs);
      reveal(root);
      // Achat direct depuis ?buy=
      if (highlight) {
        const pack = packs.find((p) => p.id === highlight);
        if (pack) setTimeout(() => buyPack(pack, root.querySelector(`[data-buy="${pack.id}"]`)), 350);
      }
    },
  };
}

/* -------------------------------- Packs -------------------------------- */

export async function packsView() {
  let packs = [];
  try { packs = await loadPacks(); } catch { packs = []; }

  const allFeatures = [...new Set(packs.flatMap((p) => p.features ?? []))];

  const html = `
    <section class="section-sm">
      <div class="container">
        <div class="eyebrow">Catalogue complet</div>
        <h1 class="h2">Comparez les <span class="grad-text">packs</span></h1>
        <p class="lead" style="margin-top:14px">
          Trois offres, un même principe : vous payez, tout est livré automatiquement.
        </p>
      </div>
    </section>

    <section class="section-sm" style="padding-top:0">
      <div class="container">
        <div class="grid grid-3">
          ${packs.map((p) => packCard(p, { featured: p.badge === 'Populaire' })).join('')}
        </div>
      </div>
    </section>

    <section class="section-sm">
      <div class="container">
        <div class="eyebrow">Comparatif</div>
        <h2 class="h3" style="margin-bottom:20px">Ce que vous obtenez</h2>
        <div class="table-wrap reveal">
          <table>
            <thead>
              <tr>
                <th>Avantage</th>
                ${packs.map((p) => `<th>${esc(p.emoji)} ${esc(p.name)}</th>`).join('')}
              </tr>
            </thead>
            <tbody>
              ${allFeatures.map((feature) => `
                <tr>
                  <td>${esc(feature)}</td>
                  ${packs.map((p) => `<td>${(p.features ?? []).includes(feature) ? '<span class="badge badge-paid">Inclus</span>' : '<span class="tiny">—</span>'}</td>`).join('')}
                </tr>`).join('')}
              <tr>
                <td><strong>Prix</strong></td>
                ${packs.map((p) => `<td><strong class="grad-text">${esc(p.price)} €</strong></td>`).join('')}
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <section class="section-sm">
      <div class="container">
        <div class="grid grid-2">
          <div class="card reveal">
            <div class="card-title">${icon('gift', { size: 19 })} Contenu livré automatiquement</div>
            <ul class="pack-features" style="margin-top:12px">
              <li><span class="tick">✓</span><span>Rôle Discord associé au pack</span></li>
              <li><span class="tick">✓</span><span>Skins, objets et monnaie virtuelle</span></li>
              <li><span class="tick">✓</span><span>Permissions et fonctionnalités en jeu</span></li>
              <li><span class="tick">✓</span><span>Historique et statut dans « Mon compte »</span></li>
            </ul>
          </div>
          <div class="card reveal">
            <div class="card-title">${icon('help', { size: 19 })} Une question avant d'acheter ?</div>
            <p class="muted small" style="margin-top:10px">
              Paiement, livraison, remboursement ou rôle Discord : notre équipe répond
              à toutes vos questions, généralement en quelques minutes.
            </p>
            <a class="btn btn-ghost btn-sm" href="/support" data-link style="margin-top:16px">Contacter le support</a>
          </div>
        </div>
      </div>
    </section>`;

  return {
    title: 'Packs',
    html,
    mount(root) {
      bindBuyButtons(root, packs);
      reveal(root);
      accordion(root);
    },
  };
}
