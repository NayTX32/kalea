/**
 * KALEA — vue Accueil.
 *
 * Structure volontairement resserrée (une seule fois le récit « 4 étapes »,
 * plus de bloc technique destiné aux développeurs) : héros, moyens de paiement,
 * avantages, packs, Discord & récompenses, appel à l'action.
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
            Choisissez votre pack, payez en toute sécurité : votre rôle Discord et vos
            récompenses en jeu arrivent <strong>automatiquement</strong>, sans attente
            ni intervention manuelle.
          </p>
          <div class="hero-actions">
            <a class="btn btn-primary btn-lg" href="/boutique" data-link>Voir la boutique ${icon('arrow-right', { size: 17 })}</a>
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
            <span class="badge badge-paid">${icon('activity', { size: 14 })} Temps réel</span>
          </div>
          <div class="step-track" style="margin-top:18px">
            <div class="step-item ok"><span class="dot">1</span><div><strong>Commande créée</strong><div class="tiny">Votre panier est réservé immédiatement</div></div></div>
            <div class="step-item ok"><span class="dot">2</span><div><strong>Paiement sécurisé</strong><div class="tiny">Aucune donnée bancaire stockée par KALEA</div></div></div>
            <div class="step-item ok"><span class="dot">3</span><div><strong>Confirmation</strong><div class="tiny">Le paiement est vérifié côté serveur</div></div></div>
            <div class="step-item running"><span class="dot">4</span><div><strong>Recevez tout</strong><div class="tiny">Rôle Discord + récompenses en jeu</div></div></div>
          </div>
          <div class="notice notice-info" style="margin-top:18px">
            ${icon('lock', { size: 18 })}
            <div class="small">Chaque commande est unique : vos récompenses ne peuvent jamais être délivrées deux fois.</div>
          </div>
        </aside>
      </div>
    </section>

    <!-- ========================= MOYENS DE PAIEMENT ========================= -->
    <section class="section-sm" style="padding-top:0">
      <div class="container">
        <div class="pay-row center">
          <span class="pay-label">${icon('shield-check', { size: 16 })} Paiement sécurisé${payments.activeLabel ? ` — ${esc(payments.activeLabel)}` : ''}</span>
          <div class="pay-chips">
            ${methods.map((m) => `<span class="pay-chip">${esc(m)}</span>`).join('') || '<span class="pay-chip">Paiement sécurisé</span>'}
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
            Vous payez, on s'occupe du reste : rôle, récompenses et suivi de commande
            sont gérés automatiquement.
          </p>
        </div>
        <div class="grid grid-4">
          <div class="card card-hover reveal">
            <div class="card-title">${icon('zap', { size: 19 })} Livraison instantanée</div>
            <p class="muted small">Dès la confirmation du paiement, votre rôle et vos récompenses sont attribués — sans intervention manuelle.</p>
          </div>
          <div class="card card-hover reveal">
            <div class="card-title">${icon('card', { size: 19 })} Paiement sécurisé</div>
            <p class="muted small">PayPal, carte bancaire et moyens locaux selon votre pays. Aucune donnée bancaire n'est stockée par KALEA.</p>
          </div>
          <div class="card card-hover reveal">
            <div class="card-title">${icon('discord', { size: 19 })} Connexion Discord</div>
            <p class="muted small">Un clic pour lier votre compte Discord : le bot attribue automatiquement le rôle du pack acheté.</p>
          </div>
          <div class="card card-hover reveal">
            <div class="card-title">${icon('shield-check', { size: 19 })} Achat protégé</div>
            <p class="muted small">Commande traçable de bout en bout, paiement vérifié et remboursement possible depuis votre compte.</p>
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
          <a class="btn btn-ghost" href="/packs" data-link>Comparer en détail ${icon('arrow-right', { size: 16 })}</a>
        </div>
        <div class="grid grid-3">
          ${packs.map((p) => packCard(p, { featured: p.id === featured?.id })).join('')}
        </div>
      </div>
    </section>

    <!-- ======================== DISCORD & RÉCOMPENSES ====================== -->
    <section class="section">
      <div class="container">
        <div class="center" style="max-width:720px;margin:0 auto 46px">
          <div class="eyebrow" style="justify-content:center">Discord &amp; récompenses</div>
          <h2 class="h2">Acheté, puis <span class="grad-text">livré</span> automatiquement</h2>
          <p class="lead" style="margin:16px auto 0;text-align:center">
            Tout se passe tout seul après le paiement : vous n'avez rien à réclamer.
          </p>
        </div>
        <div class="grid grid-2">
          <div class="card card-hover reveal">
            <div class="card-title">${icon('discord', { size: 20 })} Votre rôle Discord, immédiatement</div>
            <p class="muted small" style="margin-top:14px">
              Connectez votre compte Discord une seule fois : le bot vous attribue le rôle
              correspondant à votre pack (Base, Full Locker ou Moder). En cas de
              remboursement, le rôle est retiré automatiquement.
            </p>
            <a class="btn btn-ghost btn-sm" href="/connexion" data-link style="margin-top:18px">Connecter mon Discord</a>
          </div>

          <div class="card card-hover reveal">
            <div class="card-title">${icon('gift', { size: 20 })} Vos récompenses en jeu</div>
            <p class="muted small" style="margin-top:14px">
              Skins, devise et permissions sont envoyés directement sur votre compte de jeu
              dès la confirmation du paiement — une seule fois, jamais en attente.
            </p>
            <a class="btn btn-ghost btn-sm" href="/faq" data-link style="margin-top:18px">Comment ça marche ?</a>
          </div>
        </div>
      </div>
    </section>

    <!-- ============================== CTA ================================ -->
    <section class="section-sm">
      <div class="container">
        <div class="card reveal cta-card">
          <div class="cta-glow" aria-hidden="true"></div>
          <h2 class="h2">Prêt à passer au niveau supérieur ?</h2>
          <p class="lead" style="margin:14px auto 26px;text-align:center">
            Rejoignez les joueurs qui ont déjà débloqué leur locker, leur pack de base ou leur rôle Moder.
          </p>
          <div class="row" style="justify-content:center;flex-wrap:wrap;position:relative">
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
