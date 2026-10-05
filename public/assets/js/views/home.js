/**
 * KALEA — vue Accueil.
 */
import { get } from '../api.js';
import { state } from '../state.js';
import { esc, reveal, countUp, accordion, icon } from '../ui.js';
import { packCard, buyPack } from './shop.js';

const LOGO = `
<img class="hero-logo" src="/assets/img/logo.png" alt="Logo KALEA" width="112" height="112" />`;

export async function homeView() {
  let packs = [];
  try {
    const data = await get('/api/packs');
    packs = data.packs ?? [];
  } catch { packs = []; }

  const payments = state.config?.payments ?? {};
  const methods = payments.methods ?? [];
  const featured = packs.find((p) => p.badge === 'Populaire') ?? packs[1];

  const html = `
    <!-- ============================== HERO ============================== -->
    <section class="hero">
      <div class="container hero-inner">
        <div>
          ${LOGO}
          <div class="eyebrow">Boutique officielle du jeu</div>
          <h1 class="h1">Débloquez votre <span class="grad-text">jeu</span> en quelques secondes.</h1>
          <p class="lead" style="margin-top:18px">
            KALEA vend les packs officiels du jeu. Vous payez en toute sécurité, le système
            vérifie le paiement, attribue votre rôle Discord et envoie vos récompenses
            directement sur votre compte en jeu — automatiquement.
          </p>
          <div class="hero-actions">
            <a class="btn btn-primary btn-lg" href="/boutique" data-link>Voir la boutique →</a>
            <a class="btn btn-ghost btn-lg" href="/packs" data-link>Comparer les packs</a>
          </div>
          <div class="hero-stats">
            <div class="hero-stat"><div class="num grad-text" data-count="${packs.length}">0</div><div class="lbl">Packs disponibles</div></div>
            <div class="hero-stat"><div class="num grad-text" data-count="${Math.max(methods.length, 1)}">0</div><div class="lbl">Moyens de paiement</div></div>
            <div class="hero-stat"><div class="num grad-text" data-count="100" data-suffix=" %">0</div><div class="lbl">Livraison automatique</div></div>
          </div>
        </div>

        <aside class="hero-panel reveal">
          <div class="row-between">
            <strong>Flux d'achat</strong>
            <span class="badge badge-paid">Temps réel</span>
          </div>
          <div class="step-track" style="margin-top:18px">
            <div class="step-item ok"><span class="dot">1</span><div><strong>Commande créée</strong><div class="tiny">ID unique + clé d'idempotence</div></div></div>
            <div class="step-item ok"><span class="dot">2</span><div><strong>Paiement hébergé</strong><div class="tiny">PayPal / carte · aucune donnée bancaire</div></div></div>
            <div class="step-item ok"><span class="dot">3</span><div><strong>Webhook vérifié</strong><div class="tiny">Signature HMAC contrôlée côté serveur</div></div></div>
            <div class="step-item running"><span class="dot">4</span><div><strong>Livraison</strong><div class="tiny">Rôle Discord + récompenses en jeu</div></div></div>
          </div>
          <div class="notice notice-info" style="margin-top:18px">
            <span>🔒</span>
            <div class="small">Chaque transaction porte un identifiant unique : une récompense ne peut jamais être délivrée deux fois.</div>
          </div>
        </aside>
      </div>
    </section>

    <!-- ========================= MOYENS DE PAIEMENT ========================= -->
    <section class="section-sm" style="padding-top:0">
      <div class="container">
        <p class="center tiny" style="margin-bottom:16px;letter-spacing:.16em;text-transform:uppercase">
          Paiement sécurisé — ${esc(payments.activeLabel ?? 'prestataire professionnel')}
        </p>
        <div class="pay-marquee">
          <div class="pay-track">
            ${[...methods, ...methods].map((m) => `<span class="pay-chip">${esc(m)}</span>`).join('') || '<span class="pay-chip">Paiement sécurisé</span>'}
          </div>
        </div>
      </div>
    </section>

    <!-- ============================ AVANTAGES ============================ -->
    <section class="section">
      <div class="container">
        <div class="center" style="max-width:720px;margin:0 auto 46px">
          <div class="eyebrow" style="justify-content:center">Pourquoi KALEA</div>
          <h2 class="h2">Une boutique pensée pour les <span class="grad-text">joueurs</span></h2>
          <p class="lead" style="margin:16px auto 0;text-align:center">
            Frontend, backend, base de données, Discord, API du jeu : tout est connecté,
            sécurisé et automatisé.
          </p>
        </div>
        <div class="grid grid-4">
          <div class="card card-hover reveal">
            <div class="card-title">${icon('zap', { size: 19 })} Livraison instantanée</div>
            <p class="muted small">Dès la confirmation du paiement, le rôle Discord et les récompenses sont attribués, sans intervention manuelle.</p>
          </div>
          <div class="card card-hover reveal">
            <div class="card-title">${icon('card', { size: 19 })} Paiement hébergé</div>
            <p class="muted small">PayPal, carte bancaire et moyens locaux selon votre pays. Aucune donnée bancaire n'est stockée par KALEA.</p>
          </div>
          <div class="card card-hover reveal">
            <div class="card-title">${icon('bot', { size: 19 })} Discord OAuth2</div>
            <p class="muted small">Connectez votre compte Discord en un clic : le bot attribue automatiquement le rôle du pack acheté.</p>
          </div>
          <div class="card card-hover reveal">
            <div class="card-title">${icon('shield-check', { size: 19 })} Sécurité de production</div>
            <p class="muted small">Webhooks signés, CSRF, rate limiting, validation serveur, permissions admin et logs complets.</p>
          </div>
        </div>
      </div>
    </section>

    <!-- ============================== PACKS ============================== -->
    <section class="section" style="padding-top:20px">
      <div class="container">
        <div class="row-between wrap" style="margin-bottom:34px">
          <div>
            <div class="eyebrow">Nos offres</div>
            <h2 class="h2">Les packs <span class="grad-text">KALEA</span></h2>
          </div>
          <a class="btn btn-ghost" href="/packs" data-link>Comparer en détail →</a>
        </div>
        <div class="grid grid-3">
          ${packs.map((p) => packCard(p, { featured: p.id === featured?.id })).join('')}
        </div>
      </div>
    </section>

    <!-- ============================== ÉTAPES ============================== -->
    <section class="section">
      <div class="container">
        <div class="center" style="max-width:680px;margin:0 auto 54px">
          <div class="eyebrow" style="justify-content:center">Comment ça marche</div>
          <h2 class="h2">Quatre étapes, <span class="grad-text">zéro friction</span></h2>
        </div>
        <div class="steps">
          <div class="step reveal"><h4>Choisissez</h4><p>Sélectionnez un pack dans la boutique et lancez la commande.</p></div>
          <div class="step reveal"><h4>Payez</h4><p>Redirection vers la page sécurisée du prestataire (PayPal / carte).</p></div>
          <div class="step reveal"><h4>Confirmation</h4><p>Le webhook signé est vérifié côté serveur : la commande passe à « Payée ».</p></div>
          <div class="step reveal"><h4>Recevez</h4><p>Rôle Discord attribué + récompenses envoyées à l'API du jeu.</p></div>
        </div>
      </div>
    </section>

    <!-- ========================== INTÉGRATIONS =========================== -->
    <section class="section" style="padding-top:0">
      <div class="container">
        <div class="grid grid-2">
          <div class="card reveal">
            <div class="row" style="gap:14px">
              <div class="pack-emoji">🤖</div>
              <div><div class="card-title">Discord OAuth2 + Bot</div><div class="tiny">Attribution et retrait automatiques des rôles</div></div>
            </div>
            <p class="muted small" style="margin-top:16px">
              Le joueur connecte son compte Discord, KALEA identifie son serveur et le bot
              attribue le rôle correspondant au pack. En cas de remboursement complet, le rôle
              est retiré automatiquement (option configurable).
            </p>
            <a class="btn btn-ghost btn-sm" href="/mon-compte" data-link style="margin-top:16px">Connecter mon Discord</a>
          </div>

          <div class="card reveal">
            <div class="row" style="gap:14px">
              <div class="pack-emoji">🎮</div>
              <div><div class="card-title">API du jeu signée</div><div class="tiny">HMAC-SHA256 · ID de transaction unique</div></div>
            </div>
            <p class="muted small" style="margin-top:16px">Chaque achat confirmé pousse les récompenses vers votre serveur de jeu :</p>
            <code class="code" style="margin-top:12px">POST /v1/rewards/grant
X-Kalea-Tx: tx_ord_9f3k…
{
  "player":   { "id": "joueur-42" },
  "rewards":  { "skins": [...],
                "currency": { "amount": 2500 },
                "permissions": [...] }
}</code>
            <a class="btn btn-ghost btn-sm" href="/faq" data-link style="margin-top:14px">Voir la documentation</a>
          </div>
        </div>
      </div>
    </section>

    <!-- ============================== CTA ================================ -->
    <section class="section-sm">
      <div class="container">
        <div class="card reveal" style="text-align:center;padding:56px 28px;background:linear-gradient(140deg,rgba(124,92,255,0.22),rgba(34,211,238,0.08))">
          <h2 class="h2">Prêt à passer au niveau supérieur ?</h2>
          <p class="lead" style="margin:14px auto 26px;text-align:center">
            Rejoignez les joueurs qui ont déjà débloqué leur locker, leur pack de base ou leur rôle Moder.
          </p>
          <div class="row" style="justify-content:center;flex-wrap:wrap">
            <a class="btn btn-primary btn-lg" href="/boutique" data-link>Acheter un pack</a>
            <a class="btn btn-ghost btn-lg" href="/faq" data-link>Questions fréquentes</a>
          </div>
        </div>
      </div>
    </section>`;

  return {
    title: 'Boutique officielle',
    html,
    mount(root) {
      reveal(root);
      accordion(root);
      root.querySelectorAll('[data-count]').forEach((el) => {
        countUp(el, Number(el.dataset.count), { suffix: el.dataset.suffix ?? '' });
      });
      root.querySelectorAll('[data-buy]').forEach((button) => {
        button.addEventListener('click', () => {
          const pack = packs.find((p) => p.id === button.dataset.buy);
          if (pack) buyPack(pack, button);
        });
      });
    },
  };
}
