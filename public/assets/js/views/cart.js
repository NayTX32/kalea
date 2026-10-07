/**
 * KALEA — vue Panier : articles, quantités, total, passage en caisse.
 *
 * Le panier est stocké localement (jamais de prix) ; le montant total est
 * recalculé par le serveur au moment de la commande. Un seul paiement couvre
 * tous les articles du panier.
 */
import { get, post } from '../api.js';
import { state, isLogged, cartItems, removeFromCart, setCartQty, clearCart } from '../state.js';
import { esc, icon, fmtEUR, toastError, toastSuccess, toast, badge, emptyState, loadingButton, qs, reveal } from '../ui.js';
import { navigate } from '../router.js';

/** Lignes du panier résolues contre le catalogue. */
async function loadLines() {
  if (!state.packs?.length) {
    try {
      const data = await get('/api/packs');
      state.packs = data.packs ?? [];
    } catch { state.packs = []; }
  }
  const packs = state.packs ?? [];
  return cartItems().map((row) => ({
    ...row,
    pack: packs.find((pack) => pack.id === row.packId || pack.slug === row.packId) ?? null,
  })).filter((line) => line.pack);
}

/* ---------------------------- Passage en caisse ---------------------------- */

async function checkoutCart(button) {
  const items = cartItems();
  if (!items.length) {
    toastError('Votre panier est vide.', 'Panier vide');
    return;
  }
  if (!isLogged()) {
    toastError('Connectez-vous pour finaliser votre commande.', 'Connexion requise');
    navigate(`/connexion?next=${encodeURIComponent('/panier')}`);
    return;
  }
  const restore = loadingButton(button, 'Redirection…');
  try {
    let promoCode = null;
    try { promoCode = localStorage.getItem('kalea_promo') || null; } catch { promoCode = null; }
    const signature = items.map((row) => row.packId).sort().join('-');
    const idempotencyKey = `cart_${state.user.id}_${signature}`;
    const { order } = await post('/api/orders', { items, idempotencyKey, promoCode });
    if (order.status === 'paid') {
      clearCart();
      toastSuccess('Vous possédez déjà ce panier. Vos récompenses ont été vérifiées.', 'Déjà payé');
      navigate(`/commande/${order.id}`);
      return;
    }
    const { checkout } = await post(`/api/orders/${order.id}/checkout`);
    clearCart(); // le panier devient une commande
    window.location.href = checkout.url;
  } catch (error) {
    restore();
    toastError(error.message);
  }
}

/* -------------------------------- Rendu ---------------------------------- */

export async function cartView() {
  const lines = await loadLines();

  if (!lines.length) {
    return {
      title: 'Panier',
      html: `
        <section class="section">
          <div class="container" style="max-width:760px">
            <div class="eyebrow">Panier</div>
            <h1 class="h2" style="margin-bottom:24px">Votre panier est vide<span class="grad-text">.</span></h1>
            ${emptyState('cart', 'Aucun article pour le moment', 'Parcourez la boutique et ajoutez un pack : il apparaîtra ici, prêt à être réglé en un seul paiement.')}
            <div class="row center" style="margin-top:22px;justify-content:center">
              <a class="btn btn-primary" href="/boutique" data-link>${icon('gift', { size: 17 })} Découvrir la boutique</a>
            </div>
          </div>
        </section>`,
    };
  }

  const total = lines.reduce((sum, line) => sum + (line.pack.priceCents ?? 0) * (line.qty ?? 1), 0);

  const linesHtml = lines.map((line) => `
    <article class="cart-line reveal" data-line="${esc(line.packId)}">
      <div class="cart-emoji">${esc(line.pack.emoji ?? '🎁')}</div>
      <div class="cart-info">
        <div class="cart-name">${esc(line.pack.name)}</div>
        <div class="muted small">${esc(line.pack.tagline ?? line.pack.description ?? '')}</div>
        <div class="cart-meta">
          <span class="cart-qty-note" title="Un pack numérique est valable une seule fois par compte">×${line.qty ?? 1} · valable une seule fois</span>
          ${line.pack.active === 0 ? badge('expired', 'Indisponible') : ''}
        </div>
      </div>
      <div class="cart-controls">
        <div class="qty-stepper" role="group" aria-label="Quantité de ${esc(line.pack.name)}">
          <button type="button" class="qty-btn" data-minus="${esc(line.packId)}" aria-label="Diminuer la quantité">${icon('minus', { size: 15 })}</button>
          <span class="qty-value">${line.qty ?? 1}</span>
          <button type="button" class="qty-btn" data-plus="${esc(line.packId)}" title="Un pack numérique est valable une seule fois par compte" aria-label="Augmenter la quantité">${icon('plus', { size: 15 })}</button>
        </div>
        <div class="cart-price">${fmtEUR((line.pack.priceCents ?? 0) * (line.qty ?? 1))}</div>
        <button type="button" class="icon-btn danger" data-remove="${esc(line.packId)}" aria-label="Retirer ${esc(line.pack.name)} du panier" title="Retirer du panier">${icon('trash', { size: 17 })}</button>
      </div>
    </article>`).join('');

  const html = `
    <section class="section-sm">
      <div class="container">
        <div class="eyebrow">Panier</div>
        <h1 class="h2">Votre panier<span class="grad-text">.</span></h1>
        <p class="lead" style="margin-top:12px">${lines.length} article${lines.length > 1 ? 's' : ''} — un seul paiement, livraison automatique à la confirmation.</p>
      </div>
    </section>

    <section class="section-sm" style="padding-top:0">
      <div class="container">
        <div class="cart-layout">
          <div class="cart-lines" id="cartLines">${linesHtml}</div>

          <aside class="cart-summary panel">
            <h2 class="h3" style="margin-bottom:16px">Récapitulatif</h2>
            <div class="sum-row"><span>Sous-total</span><strong id="cartSubtotal">${fmtEUR(total)}</strong></div>
            <div class="sum-row"><span>Livraison</span><span class="muted">Automatique et gratuite</span></div>

            <div style="margin:16px 0 4px">
              <label class="label" for="promoInput">Code promotionnel</label>
              <div class="row" style="gap:8px">
                <input class="input" id="promoInput" name="promo" placeholder="BIENVENUE10"
                  autocomplete="off" spellcheck="false"
                  style="text-transform:uppercase;flex:1 1 auto;min-width:0" />
                <button class="btn btn-ghost btn-sm" type="button" id="promoApply">Appliquer</button>
              </div>
              <div class="form-error" id="promoError"></div>
              <div class="row" id="promoApplied" hidden style="gap:8px;align-items:center;margin-top:8px">
                <span class="badge" id="promoAppliedText">—</span>
                <button class="btn btn-ghost btn-sm" type="button" id="promoRemove">Retirer</button>
              </div>
            </div>

            <div class="sum-row" id="cartDiscountRow" hidden>
              <span id="cartDiscountLabel">Remise</span><strong class="grad-text" id="cartDiscountValue">—</strong>
            </div>
            <div class="sum-sep"></div>
            <div class="sum-row total"><span>Total</span><strong id="cartTotal">${fmtEUR(total)}</strong></div>
            <p class="muted small" style="margin:14px 0 18px">
              Paiement sécurisé — aucune donnée bancaire n’est stockée. Chaque pack est valable
              une seule fois par compte.
            </p>
            <button class="btn btn-primary btn-block" id="cartCheckout" type="button">
              ${icon('lock', { size: 17 })} Payer le panier
            </button>
            <a class="btn btn-ghost btn-block" href="/boutique" data-link style="margin-top:10px">Continuer mes achats</a>
          </aside>
        </div>
      </div>
    </section>`;

  return {
    title: 'Panier',
    html,
    mount(root) {
      // Retrait d'un article (instantané + animation).
      root.querySelectorAll('[data-remove]').forEach((button) => {
        button.addEventListener('click', () => {
          const id = button.dataset.remove;
          const line = root.querySelector(`[data-line="${CSS.escape(id)}"]`);
          const name = lines.find((item) => item.packId === id)?.pack?.name ?? 'Article';
          if (line) line.classList.add('removing');
          window.setTimeout(() => {
            removeFromCart(id);
            toastSuccess(`« ${name} » retiré du panier.`, 'Panier mis à jour');
            navigate('/panier', { keepScroll: true });
          }, 220);
        });
      });

      // Quantité : un pack numérique est valable une seule fois.
      root.querySelectorAll('[data-minus]').forEach((button) => {
        button.addEventListener('click', () => {
          setCartQty(button.dataset.minus, 0);
          const name = lines.find((item) => item.packId === button.dataset.minus)?.pack?.name ?? 'Article';
          toastSuccess(`« ${name} » retiré du panier.`, 'Panier mis à jour');
          navigate('/panier', { keepScroll: true });
        });
      });
      root.querySelectorAll('[data-plus]').forEach((button) => {
        button.addEventListener('click', () => {
          toast(
            'Un pack numérique est valable une seule fois par compte : la quantité reste à 1.',
            'info',
            { title: 'Quantité fixe' },
          );
        });
      });

      /* ----------------------- Code promotionnel ----------------------- */
      const subtotal = total;
      const promoInput = qs('#promoInput', root);
      const promoError = qs('#promoError', root);
      const promoApplied = qs('#promoApplied', root);
      const promoAppliedText = qs('#promoAppliedText', root);
      const discountRow = qs('#cartDiscountRow', root);
      const discountLabel = qs('#cartDiscountLabel', root);
      const discountValue = qs('#cartDiscountValue', root);
      const totalEl = qs('#cartTotal', root);

      const readStoredPromo = () => {
        try { return localStorage.getItem('kalea_promo') || ''; } catch { return ''; }
      };
      const storePromo = (code) => {
        try { code ? localStorage.setItem('kalea_promo', code) : localStorage.removeItem('kalea_promo'); }
        catch { /* stockage indisponible : le code reste en mémoire pour cette visite */ }
      };

      const renderPromo = (code, cents) => {
        const applied = Boolean(code) && cents > 0;
        if (discountRow) discountRow.hidden = !applied;
        if (promoApplied) promoApplied.hidden = !applied;
        if (!totalEl) return;
        if (applied) {
          if (discountLabel) discountLabel.textContent = `Remise ${code}`;
          if (discountValue) discountValue.textContent = `− ${fmtEUR(cents)}`;
          if (promoAppliedText) promoAppliedText.textContent = `« ${code} » : − ${fmtEUR(cents)}`;
          totalEl.textContent = fmtEUR(Math.max(0, subtotal - cents));
        } else {
          totalEl.textContent = fmtEUR(subtotal);
        }
      };

      /** Valide un code auprès du serveur (le montant est toujours recalculé là-bas). */
      async function applyPromo(code, { notify = true } = {}) {
        const value = String(code ?? '').trim();
        if (!value) {
          storePromo(null);
          if (promoError) promoError.textContent = '';
          renderPromo(null, 0);
          return null;
        }
        try {
          const res = await post('/api/promotions/validate', { code: value, subtotalCents: subtotal });
          if (!res?.valid) throw new Error('Ce code promotionnel n’est pas applicable.');
          storePromo(res.code);
          if (promoInput) promoInput.value = res.code;
          if (promoError) promoError.textContent = '';
          renderPromo(res.code, res.discountCents);
          if (notify) toastSuccess(`Code « ${res.code} » appliqué : − ${fmtEUR(res.discountCents)}.`, 'Promotion');
          return res;
        } catch (error) {
          storePromo(null);
          renderPromo(null, 0);
          if (promoError) promoError.textContent = error.message;
          if (notify) toastError(error.message, 'Code promotionnel');
          return null;
        }
      }

      qs('#promoApply', root)?.addEventListener('click', () => applyPromo(promoInput?.value));
      promoInput?.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') { event.preventDefault(); applyPromo(promoInput.value); }
      });
      qs('#promoRemove', root)?.addEventListener('click', () => {
        storePromo(null);
        if (promoInput) promoInput.value = '';
        if (promoError) promoError.textContent = '';
        renderPromo(null, 0);
        toast('Code promotionnel retiré.', 'info');
      });

      const storedPromo = readStoredPromo();
      if (storedPromo && promoInput) {
        promoInput.value = storedPromo;
        applyPromo(storedPromo, { notify: false }); // silencieux si le code a expiré
      } else {
        renderPromo(null, 0);
      }

      qs('#cartCheckout', root)?.addEventListener('click', (event) => checkoutCart(event.currentTarget));
      reveal(root);
    },
  };
}
