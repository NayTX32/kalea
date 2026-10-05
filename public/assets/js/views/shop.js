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

        <div class="card reveal" style="margin-top:44px">
          <div class="row-between wrap">
            <div>
              <div class="card-title">Moyens de paiement acceptés</div>
              <p class="muted small">Selon votre pays : ${esc(methods.join(' · ') || 'paiement sécurisé')}</p>
            </div>
            <span class="badge badge-paid">Aucune donnée bancaire stockée</span>
          </div>
          <div class="pay-marquee" style="margin-top:20px">
            <div class="pay-track">
              ${[...methods, ...methods].map((m) => `<span class="pay-chip">${esc(m)}</span>`).join('')}
            </div>
          </div>
        </div>
      </div>
    </section>

    <section class="section-sm">
      <div class="container">
        <div class="grid grid-3">
          <div class="card card-hover reveal">
            <div class="card-title">${icon('shield-check', { size: 19 })} Paiement hébergé</div>
            <p class="muted small">La saisie se fait chez le prestataire (PayPal / Stripe). KALEA ne voit jamais votre numéro de carte.</p>
          </div>
          <div class="card card-hover reveal">
            <div class="card-title">${icon('zap', { size: 19 })} Livraison automatique</div>
            <p class="muted small">Webhook signé vérifié côté serveur → commande « Payée » → rôle Discord + récompenses envoyées au jeu.</p>
          </div>
          <div class="card card-hover reveal">
            <div class="card-title">${icon('lock', { size: 19 })} Anti double attribution</div>
            <p class="muted small">Chaque transaction porte un ID unique. Une même récompense ne peut être délivrée qu'une seule fois.</p>
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
          Trois offres, un même principe : vous payez, le système délivre. Ajoutez un nouveau pack
          depuis le dashboard admin, il apparaît ici automatiquement.
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
            <div class="card-title">🎁 Contenu livré automatiquement</div>
            <ul class="pack-features" style="margin-top:12px">
              <li><span class="tick">✓</span><span>Rôle Discord associé au pack</span></li>
              <li><span class="tick">✓</span><span>Skins, objets et monnaie virtuelle</span></li>
              <li><span class="tick">✓</span><span>Permissions et fonctionnalités en jeu</span></li>
              <li><span class="tick">✓</span><span>Historique et statut dans « Mon compte »</span></li>
            </ul>
          </div>
          <div class="card reveal">
            <div class="card-title">${icon('cube', { size: 19 })} Extensible</div>
            <p class="muted small" style="margin-top:10px">
              Chaque pack est configurable sans toucher au code : prix, description, image,
              rôle Discord, récompenses et fonctionnalités de jeu sont éditables depuis le
              dashboard administrateur.
            </p>
            <a class="btn btn-ghost btn-sm" href="/admin/packs" data-link style="margin-top:16px">Ouvrir le dashboard</a>
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
