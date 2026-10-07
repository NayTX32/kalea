/**
 * KALEA — vue Boutique (grille d'achat) + vue Packs (comparatif détaillé).
 */
import { get, post } from '../api.js';
import { state, isLogged, addToCart, inCart } from '../state.js';
import { esc, toast, toastError, toastSuccess, reveal, accordion, badge, emptyState, loadingButton, fmtEUR, icon, modal } from '../ui.js';
import { navigate } from '../router.js';

/* --------------------------- Composant pack --------------------------- */

export function packCard(pack, { featured = false, actions = true } = {}) {
  const features = (pack.features ?? []).slice(0, 6);
  const out = pack.stock === 0 || pack.inStock === false;
  const available = pack.active !== false && pack.active !== 0 && !out;
  const limited = available && pack.stock > 0;
  const added = inCart(pack.id);
  const availLabel = out ? 'Épuisé' : (limited ? `Reste ${pack.stock}` : 'Disponible');
  return `
    <article class="pack-card ${featured ? 'featured' : ''} reveal" data-pack-card="${esc(pack.id)}" data-category="${esc(pack.category?.slug ?? '')}">
      ${pack.badge ? `<span class="pack-badge">${esc(pack.badge)}</span>` : ''}
      <div class="row" style="gap:16px;align-items:flex-start">
        <div class="pack-emoji">${esc(pack.emoji ?? '🎁')}</div>
        <div>
          <div class="pack-name">${esc(pack.name)}</div>
          <div class="muted small">${esc(pack.tagline ?? '')}</div>
          ${pack.category ? `<div class="tiny" style="margin-top:4px">${esc(pack.category.emoji ?? '')} ${esc(pack.category.name)}</div>` : ''}
        </div>
      </div>
      <div class="pack-price">
        <span class="amount">${esc(pack.price)}</span><span class="cur">€</span>
        <span class="badge pack-avail ${out ? 'out' : (limited ? 'low' : '')}" style="margin-left:auto">${esc(availLabel)}</span>
      </div>
      <ul class="pack-features">
        ${features.map((f) => `<li><span class="tick">✓</span><span>${esc(f)}</span></li>`).join('')}
      </ul>
      ${actions ? `
      <div class="stack pack-actions" style="gap:10px;margin-top:auto">
        <button class="btn btn-primary btn-block ${added ? 'in-cart' : ''}" data-add="${esc(pack.id)}" ${available ? '' : 'disabled'}>
          ${added ? '✓ Dans le panier' : (available ? 'Ajouter au panier' : (out ? 'Épuisé' : 'Indisponible'))}
        </button>
        <button class="btn btn-ghost btn-block btn-sm" data-details="${esc(pack.id)}">Voir le produit</button>
      </div>` : ''}
    </article>`;
}

/* ------------------------ Achat (création + paiement) ------------------ */

export async function buyPack(pack, button) {
  if (pack.stock === 0 || pack.inStock === false) {
    toastError('Ce pack est en rupture de stock.', 'Épuisé');
    return;
  }
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

/** Passe le bouton d'une carte en état « Dans le panier » (partout dans la page). */
function markInCart(packId) {
  document.querySelectorAll(`[data-add="${CSS.escape(packId)}"]`).forEach((button) => {
    button.classList.add('in-cart');
    button.textContent = '✓ Dans le panier';
  });
}

/** Fiche produit : modale animée (détails, ajout au panier, achat immédiat). */
function showPackModal(pack) {
  const features = (pack.features ?? []).slice(0, 8);
  const out = pack.stock === 0 || pack.inStock === false;
  const available = pack.active !== false && pack.active !== 0 && !out;
  const stockLine = out
    ? 'Ce pack est actuellement en rupture de stock.'
    : (pack.stock > 0 ? `Plus que ${pack.stock} unité(s) disponible(s).` : 'Stock illimité, disponible immédiatement.');
  const body = `
    <div class="row" style="gap:16px;align-items:center;margin-bottom:14px">
      <div class="pack-emoji">${esc(pack.emoji ?? '🎁')}</div>
      <div>
        <div class="h4">${esc(pack.name)}</div>
        <div class="muted small">${esc(pack.tagline ?? '')}</div>
        ${pack.category ? `<div class="tiny" style="margin-top:4px">${esc(pack.category.emoji ?? '')} ${esc(pack.category.name)}</div>` : ''}
      </div>
      <div class="pack-price" style="margin-left:auto">
        <span class="amount">${esc(pack.price)}</span><span class="cur">€</span>
      </div>
    </div>
    ${pack.description ? `<p class="muted">${esc(pack.description)}</p>` : ''}
    <ul class="pack-features" style="margin-top:12px">
      ${features.map((f) => `<li><span class="tick">✓</span><span>${esc(f)}</span></li>`).join('')}
    </ul>
    <p class="muted small" style="margin-top:12px">${icon('cube', { size: 15 })} ${esc(stockLine)}</p>
    ${pack.rewardSummary ? `<p class="muted small">${icon('gift', { size: 15 })} ${esc(pack.rewardSummary)}</p>` : ''}
    ${pack.discordRole?.name ? `<p class="muted small">${icon('discord', { size: 15 })} Donne le rôle Discord « ${esc(pack.discordRole.name)} ».</p>` : ''}
    <p class="muted small" style="margin-top:12px">${icon('shield-check', { size: 15 })} Paiement sécurisé — livraison automatique dès la confirmation, jamais de double attribution.</p>`;

  modal({
    title: 'Détails du produit',
    body,
    actions: [
      {
        label: available ? 'Ajouter au panier' : (out ? 'Épuisé' : 'Indisponible'),
        className: 'btn-primary',
        onClick: () => {
          if (!available) {
            toastError(out ? 'Ce pack est en rupture de stock.' : 'Ce pack n’est plus disponible.', out ? 'Épuisé' : 'Indisponible');
            return false;
          }
          const added = addToCart(pack.id);
          markInCart(pack.id);
          toastSuccess(
            added ? `« ${pack.name} » ajouté au panier.` : `« ${pack.name} » est déjà dans votre panier.`,
            'Panier',
          );
          return undefined; // la modale se ferme, le toast confirme
        },
      },
      {
        label: 'Acheter maintenant',
        className: 'btn-ghost',
        keepOpen: true,
        onClick: async ({ button }) => { await buyPack(pack, button); return false; },
      },
    ],
  });
}

export function bindPackActions(root, packs) {
  const find = (id) => packs.find((pack) => pack.id === id || pack.slug === id);

  // Achat immédiat (utilisé par ?buy= et le comparatif).
  root.querySelectorAll('[data-buy]').forEach((button) => {
    button.addEventListener('click', () => {
      const pack = find(button.dataset.buy);
      if (pack) buyPack(pack, button);
    });
  });

  // Ajout au panier : instantané, sans rechargement de page.
  root.querySelectorAll('[data-add]').forEach((button) => {
    button.addEventListener('click', () => {
      const pack = find(button.dataset.add);
      if (!pack) return;
      if (pack.active === false || pack.active === 0) {
        toastError('Ce pack n’est plus disponible.', 'Indisponible');
        return;
      }
      if (pack.stock === 0 || pack.inStock === false) {
        toastError('Ce pack est en rupture de stock.', 'Épuisé');
        return;
      }
      const added = addToCart(pack.id);
      markInCart(pack.id);
      toastSuccess(
        added ? `« ${pack.name} » ajouté au panier.` : `« ${pack.name} » est déjà dans votre panier.`,
        'Panier',
      );
    });
  });

  // Fiche produit (« Voir le produit »).
  root.querySelectorAll('[data-details]').forEach((button) => {
    button.addEventListener('click', () => {
      const pack = find(button.dataset.details);
      if (pack) showPackModal(pack);
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
  let categories = [];
  try {
    categories = ((await get('/api/categories')).categories) ?? [];
  } catch { categories = []; }

  const methods = state.config?.payments?.methods ?? [];
  const query = new URLSearchParams(location.search);
  const highlight = query.get('buy');
  const activeCat = query.get('cat') ?? '';
  const countIn = (slug) => packs.filter((p) => p.category?.slug === slug).length;

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
        ${categories.length ? `
        <div class="cat-filters" id="catFilters" role="group" aria-label="Filtrer par catégorie">
          <button class="cat-chip ${activeCat ? '' : 'active'}" type="button" data-cat="">Tous <span class="count">${packs.length}</span></button>
          ${categories.map((c) => `
            <button class="cat-chip ${activeCat === c.slug ? 'active' : ''}" type="button" data-cat="${esc(c.slug)}">
              ${esc(c.emoji ?? '')} ${esc(c.name)} <span class="count">${countIn(c.slug)}</span>
            </button>`).join('')}
        </div>` : ''}

        <div class="grid grid-3" id="packGrid">
          ${packs.map((p) => packCard(p, { featured: p.badge === 'Populaire' || highlight === p.id })).join('')}
        </div>
        <div class="empty" id="catEmpty" hidden>Aucun pack dans cette catégorie pour le moment.</div>

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
      bindPackActions(root, packs);
      reveal(root);

      // Filtre par catégorie (sans rechargement, URL conservée partageable).
      const cards = [...root.querySelectorAll('[data-pack-card]')];
      const emptyEl = root.querySelector('#catEmpty');
      const applyFilter = (slug) => {
        let shown = 0;
        cards.forEach((card) => {
          const match = !slug || card.dataset.category === slug;
          card.hidden = !match;
          if (match) shown += 1;
        });
        if (emptyEl) emptyEl.hidden = shown > 0;
        root.querySelectorAll('.cat-chip').forEach((chip) => {
          chip.classList.toggle('active', chip.dataset.cat === slug);
        });
        const url = new URL(location.href);
        if (slug) url.searchParams.set('cat', slug);
        else url.searchParams.delete('cat');
        history.replaceState({}, '', url);
      };
      root.querySelectorAll('.cat-chip').forEach((chip) => {
        chip.addEventListener('click', () => applyFilter(chip.dataset.cat));
      });
      if (activeCat) applyFilter(activeCat);

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
      bindPackActions(root, packs);
      reveal(root);
      accordion(root);
    },
  };
}
