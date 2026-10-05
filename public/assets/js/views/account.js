/**
 * KALEA — vues « Mon compte », suivi de commande et page de paiement de démonstration.
 */
import { get, post, patch } from '../api.js';
import { state, setUser, isLogged } from '../state.js';
import { esc, fmtEUR, fmtDate, fmtRelative, badge, reveal, toastSuccess, toastError, loadingButton, emptyState, modal, confirmDialog, qs, icon } from '../ui.js';
import { navigate } from '../router.js';

/* ------------------------------- Helpers ------------------------------- */

function userHeader(user) {
  const initial = (user.displayName ?? '?').charAt(0).toUpperCase();
  return `
    <div class="row wrap" style="gap:18px;align-items:center">
      <div class="avatar" style="width:66px;height:66px;border-radius:18px;font-size:1.5rem">
        ${user.avatar ? `<img src="${esc(user.avatar)}" alt="" />` : esc(initial)}
      </div>
      <div class="grow">
        <h1 class="h3">${esc(user.displayName)}</h1>
        <div class="row wrap" style="gap:8px;margin-top:8px">
          <span class="badge">${esc(user.email)}</span>
          ${user.role === 'admin' ? '<span class="badge badge-paid">Administrateur</span>' : ''}
          ${user.discord?.linked ? `<span class="badge badge-paid">Discord : ${esc(user.discord.username ?? 'lié')}</span>` : '<span class="badge badge-pending">Discord non connecté</span>'}
          ${user.gamePlayerId ? `<span class="badge badge-paid">Jeu : ${esc(user.gamePlayerId)}</span>` : '<span class="badge badge-pending">Identifiant de jeu absent</span>'}
        </div>
      </div>
      <div class="row wrap" style="gap:10px">
        ${user.role === 'admin' ? '<a class="btn btn-ghost btn-sm" href="/admin" data-link>Dashboard</a>' : ''}
        <button class="btn btn-danger btn-sm" id="btnLogout">Déconnexion</button>
      </div>
    </div>`;
}

function deliverySteps(delivery) {
  if (!delivery) return '<p class="tiny">Aucune livraison enregistrée pour le moment.</p>';
  const icons = { ok: '✓', already: '=', skipped: '–', failed: '!', pending: '…', running: '…' };
  return `<div class="step-track">${delivery.steps.map((s) => `
    <div class="step-item ${esc(s.status)}">
      <span class="dot">${icons[s.status] ?? '·'}</span>
      <div class="grow">
        <strong>${esc(s.label ?? s.key)}</strong>
        <div class="tiny">${esc(s.error ?? s.reason ?? s.hint ?? (s.status === 'ok' ? 'Livré' : ''))}</div>
      </div>
      ${badge(s.status)}
    </div>`).join('')}</div>`;
}

/* ----------------------------- Mon compte ------------------------------ */

export async function accountView({ query }) {
  if (!isLogged()) return { title: 'Connexion', html: '' };
  let data;
  try {
    data = await get('/api/account/overview');
  } catch (error) {
    return { title: 'Mon compte', html: `<div class="container section">${emptyState('⚠️', 'Impossible de charger votre compte', error.message)}</div>` };
  }
  const { user, orders, packs, grants, deliveries } = data;
  setUser(user);

  if (query.get('discord') === 'ok') {
    setTimeout(() => toastSuccess('Votre compte Discord est maintenant connecté à KALEA.', 'Discord connecté'), 400);
  }

  const activeOrders = orders.filter((o) => ['pending', 'processing', 'failed'].includes(o.status));

  const html = `
    <section class="section-sm">
      <div class="container">
        ${userHeader(user)}

        ${activeOrders.length ? `
        <div class="notice notice-warn" style="margin-top:22px">
          <span>⏳</span>
          <div class="small">
            <strong>${activeOrders.length} commande(s) en attente.</strong>
            ${activeOrders.map((o) => `<a href="/commande/${o.id}" data-link style="text-decoration:underline"> ${o.number} — ${o.pack?.name ?? ''} (${o.amount} €)</a>`).join(' · ')}
          </div>
        </div>` : ''}

        <div class="grid grid-2" style="margin-top:26px;align-items:start">
          <!-- Profil -->
          <div class="card reveal">
            <div class="card-title">👤 Profil</div>
            <form id="profileForm" class="stack" style="margin-top:16px" novalidate>
              <div class="field">
                <label class="label" for="pName">Pseudo</label>
                <input class="input" id="pName" name="displayName" value="${esc(user.displayName)}" required />
              </div>
              <div class="field">
                <label class="label" for="pEmail">Adresse e-mail</label>
                <input class="input" id="pEmail" name="email" type="email" value="${esc(user.email)}" required />
              </div>
              <div class="field">
                <label class="label" for="pGame">Identifiant du jeu</label>
                <input class="input" id="pGame" name="gamePlayerId" value="${esc(user.gamePlayerId ?? '')}" placeholder="ex. joueur-42" />
                <span class="hint">Ouvrez le menu Profil dans le jeu pour le retrouver. Indispensable pour la livraison des récompenses.</span>
              </div>
              <div class="form-error" id="profileError"></div>
              <button class="btn btn-primary btn-sm" type="submit">Enregistrer</button>
            </form>
            <div class="divider"></div>
            <button class="btn btn-ghost btn-sm" id="btnPassword">Changer mon mot de passe</button>
          </div>

          <!-- Discord -->
          <div class="card reveal">
            <div class="card-title">🤖 Intégrations</div>
            <div class="stack" style="margin-top:16px">
              <div class="row-between wrap">
                <div>
                  <strong>Compte Discord</strong>
                  <div class="tiny">${user.discord?.linked ? `Lié à ${esc(user.discord.username ?? user.discord.id)}` : 'Requis pour recevoir votre rôle automatiquement'}</div>
                </div>
                ${user.discord?.linked
                  ? '<button class="btn btn-ghost btn-sm" id="btnUnlink">Déconnecter</button>'
                  : `<a class="btn btn-discord btn-sm" href="/api/auth/discord?return=/mon-compte">Connecter Discord</a>`}
              </div>
              <div class="divider" style="margin:6px 0"></div>
              <div class="row-between wrap">
                <div>
                  <strong>API du jeu</strong>
                  <div class="tiny">${data.gameConfigured ? 'Connectée — livraison automatique active' : 'Non configurée (GAME_API_URL) — livraison en attente'}</div>
                </div>
                <span class="badge ${data.gameConfigured ? 'badge-paid' : 'badge-pending'}">${data.gameConfigured ? 'Active' : 'Inactive'}</span>
              </div>
              <div class="divider" style="margin:6px 0"></div>
              <div class="row-between wrap">
                <div><strong>Packs actifs</strong><div class="tiny">${packs.length} pack(s) sur votre compte</div></div>
                <span class="badge badge-paid">${packs.length}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Packs actifs -->
        <div class="section-sm" style="padding-bottom:0">
          <div class="row-between wrap" style="margin-bottom:16px">
            <h2 class="h3">Vos packs actifs</h2>
            <a class="btn btn-ghost btn-sm" href="/boutique" data-link>Ajouter un pack</a>
          </div>
          ${packs.length ? `<div class="grid grid-3">
            ${packs.map((p) => `
              <div class="pack-card reveal" style="padding:24px">
                <div class="row" style="gap:14px">
                  <div class="pack-emoji" style="width:50px;height:50px;font-size:1.5rem">${esc(p.emoji)}</div>
                  <div><div class="pack-name" style="font-size:1.15rem">${esc(p.name)}</div><div class="tiny">Depuis ${fmtDate(p.grantedAt, { withTime: false })}</div></div>
                </div>
                <ul class="pack-features">
                  ${(p.features ?? []).slice(0, 4).map((f) => `<li><span class="tick">✓</span><span>${esc(f)}</span></li>`).join('')}
                </ul>
                <div class="row wrap" style="gap:8px">
                  <button class="btn btn-ghost btn-sm" data-redeliver="${esc(p.orderId)}">Relancer la livraison</button>
                  <a class="btn btn-ghost btn-sm" href="/commande/${esc(p.orderId)}" data-link>Voir</a>
                </div>
              </div>`).join('')}
          </div>` : `<div class="empty"><div class="ico">🎒</div><div class="card-title">Aucun pack actif</div>
            <p class="muted small">Vos packs achetés apparaîtront ici après confirmation du paiement.</p>
            <a class="btn btn-primary btn-sm" href="/boutique" data-link style="margin-top:16px">Voir la boutique</a></div>`}
        </div>

        <!-- Historique -->
        <div class="section-sm" style="padding-bottom:0">
          <h2 class="h3" style="margin-bottom:16px">Historique des commandes</h2>
          ${orders.length ? `
          <div class="table-wrap reveal">
            <table>
              <thead><tr><th>Commande</th><th>Pack</th><th>Montant</th><th>Statut</th><th>Livraison</th><th>Date</th><th></th></tr></thead>
              <tbody>
                ${orders.map((o) => `
                  <tr>
                    <td class="mono small">${esc(o.number)}</td>
                    <td>${esc(o.pack?.emoji ?? '')} ${esc(o.pack?.name ?? '—')}</td>
                    <td><strong>${esc(o.amount)} €</strong></td>
                    <td>${badge(o.status)}</td>
                    <td>${o.delivery ? badge(o.delivery.status) : '<span class="tiny">—</span>'}</td>
                    <td class="tiny">${fmtDate(o.createdAt)}</td>
                    <td class="actions"><a class="btn btn-ghost btn-sm" href="/commande/${esc(o.id)}" data-link>Voir</a></td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>` : emptyState('receipt', 'Aucune commande pour l’instant', 'Vos achats apparaîtront ici.')}
        </div>

        <!-- Récompenses -->
        <div class="section-sm" style="padding-bottom:0">
          <h2 class="h3" style="margin-bottom:8px">Récompenses obtenues</h2>
          <p class="muted small" style="margin-bottom:16px">
            Chaque récompense est liée à une transaction unique — impossible de la recevoir deux fois.
          </p>
          ${grants.length ? `
          <div class="table-wrap reveal">
            <table>
              <thead><tr><th>Récompense</th><th>Type</th><th>Transaction</th><th>Statut</th><th>Date</th></tr></thead>
              <tbody>
                ${grants.map((g) => `
                  <tr>
                    <td>${esc(g.label || g.key)}</td>
                    <td class="tiny">${esc(g.kind)}</td>
                    <td class="mono tiny">${esc(g.txId)}</td>
                    <td>${badge(g.status)}</td>
                    <td class="tiny">${fmtDate(g.createdAt)}</td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>` : emptyState('🎁', 'Aucune récompense enregistrée', 'Elles apparaîtront après la livraison de votre premier pack.')}
        </div>
      </div>
    </section>`;

  return {
    title: 'Mon compte',
    html,
    mount(root) {
      reveal(root);

      root.querySelector('#btnLogout')?.addEventListener('click', async () => {
        try { await post('/api/auth/logout'); } catch { /* déjà déconnecté */ }
        setUser(null);
        toastSuccess('Vous êtes déconnecté.', 'À bientôt');
        navigate('/');
      });

      const profileForm = root.querySelector('#profileForm');
      profileForm?.addEventListener('submit', async (event) => {
        event.preventDefault();
        const errorEl = root.querySelector('#profileError');
        errorEl.textContent = '';
        const data = Object.fromEntries(new FormData(profileForm).entries());
        const restore = loadingButton(profileForm.querySelector('button'), 'Enregistrement…');
        try {
          const res = await patch('/api/account', data);
          setUser(res.user);
          toastSuccess('Vos informations ont été mises à jour.', 'Profil');
          if (res.backfill?.granted?.length) {
            toastSuccess(`${res.backfill.granted.length} récompense(s) rattrapée(s) automatiquement.`, 'Livraison');
          }
          navigate('/mon-compte', { replace: true });
        } catch (error) {
          restore();
          errorEl.textContent = error.message;
          toastError(error.message);
        }
      });

      root.querySelector('#btnPassword')?.addEventListener('click', () => {
        modal({
          title: 'Changer mon mot de passe',
          body: `
            <div class="stack">
              <div class="field"><label class="label" for="mCur">Mot de passe actuel</label>
                <input class="input" id="mCur" type="password" autocomplete="current-password" /></div>
              <div class="field"><label class="label" for="mNew">Nouveau mot de passe</label>
                <input class="input" id="mNew" type="password" autocomplete="new-password" />
                <span class="hint">8 caractères minimum, avec au moins une lettre et un chiffre.</span></div>
              <div class="form-error" id="mErr"></div>
            </div>`,
          actions: [
            { label: 'Annuler', className: 'btn-ghost' },
            {
              label: 'Mettre à jour', className: 'btn-primary',
              onClick: async ({ close }) => {
                const currentPassword = root.querySelector('#mCur')?.value;
                const newPassword = root.querySelector('#mNew')?.value;
                try {
                  await post('/api/account/password', { currentPassword, newPassword });
                  toastSuccess('Mot de passe modifié.', 'Sécurité');
                  close();
                } catch (error) {
                  root.querySelector('#mErr').textContent = error.message;
                  return false;
                }
                return false;
              },
            },
          ],
        });
      });

      root.querySelector('#btnUnlink')?.addEventListener('click', async () => {
        const ok = await confirmDialog('Votre rôle Discord ne sera pas retiré, mais plus aucun rôle ne pourra être attribué automatiquement.');
        if (!ok) return;
        try {
          await post('/api/auth/discord/unlink');
          setUser({ ...state.user, discord: { linked: false, id: null, username: null } });
          toastSuccess('Compte Discord déconnecté.');
          navigate('/mon-compte', { replace: true });
        } catch (error) { toastError(error.message); }
      });

      root.querySelectorAll('[data-redeliver]').forEach((button) => {
        button.addEventListener('click', async () => {
          const restore = loadingButton(button, 'Livraison…');
          try {
            const res = await post(`/api/orders/${button.dataset.redeliver}/deliver`);
            const failed = (res.result?.delivery?.steps ?? []).filter((s) => s.status === 'failed');
            if (res.result?.status === 'already_delivered') toastSuccess('Vos récompenses sont déjà toutes attribuées.', 'Livraison');
            else if (failed.length) toastError(`Livraison partielle : ${failed.map((f) => f.label ?? f.key).join(', ')}`, 'Livraison');
            else toastSuccess('Récompenses envoyées avec succès.', 'Livraison');
            navigate('/mon-compte', { replace: true });
          } catch (error) {
            restore();
            toastError(error.message);
          }
        });
      });
    },
  };
}

/* --------------------------- Suivi de commande -------------------------- */

export async function orderView({ params }) {
  if (!isLogged()) return { title: 'Commande', html: '' };
  let order = null;
  try {
    order = (await get(`/api/orders/${params.id}`)).order;
  } catch (error) {
    return { title: 'Commande', html: `<div class="container section">${emptyState('receipt', 'Commande introuvable', error.message)}</div>` };
  }

  const query = new URLSearchParams(location.search);
  const paid = order.status === 'paid';
  const payable = ['pending', 'processing', 'failed'].includes(order.status);

  const html = `
    <section class="section-sm">
      <div class="container" style="max-width:900px">
        <a class="btn btn-ghost btn-sm" href="/mon-compte" data-link>← Retour à mon compte</a>

        <div class="card" style="margin-top:20px">
          <div class="row-between wrap">
            <div>
              <div class="eyebrow" style="margin-bottom:8px">Commande ${esc(order.number)}</div>
              <h1 class="h3">${esc(order.pack?.emoji ?? '')} ${esc(order.pack?.name ?? 'Pack KALEA')}</h1>
              <div class="row wrap" style="gap:8px;margin-top:12px">
                ${badge(order.status)}
                <span class="badge">${esc(order.amount)} €</span>
                <span class="badge">${esc(order.provider)}</span>
                <span class="badge">Créée ${fmtRelative(order.createdAt)}</span>
              </div>
            </div>
            <div class="pack-price"><span class="amount">${esc(order.amount)}</span><span class="cur">€</span></div>
          </div>

          ${query.get('result') === 'success' && !paid ? `
            <div class="notice notice-info" style="margin-top:20px"><span>⏳</span>
              <div class="small">Paiement transmis au prestataire. Nous attendons la confirmation sécurisée du serveur…</div></div>` : ''}
          ${query.get('result') === 'canceled' ? `
            <div class="notice notice-warn" style="margin-top:20px"><span>↩️</span>
              <div class="small">Paiement annulé. Vous pouvez relancer la commande quand vous voulez.</div></div>` : ''}
          ${order.status === 'failed' ? `
            <div class="notice notice-danger" style="margin-top:20px"><span>✕</span>
              <div class="small"><strong>Paiement échoué.</strong> ${esc(order.failureReason ?? '')} — aucun montant n'a été encaissé.</div></div>` : ''}
          ${order.status === 'refunded' ? `
            <div class="notice notice-warn" style="margin-top:20px"><span>↩</span>
              <div class="small"><strong>Commande remboursée.</strong> ${esc(order.refundReason ?? '')} Les récompenses ont été retirées.</div></div>` : ''}

          <div class="row wrap" style="gap:12px;margin-top:22px">
            ${payable ? `<button class="btn btn-primary" id="btnPay">${order.status === 'failed' ? 'Réessayer le paiement' : 'Payer maintenant'}</button>` : ''}
            ${paid ? `<button class="btn btn-ghost" id="btnDeliver">Relancer la livraison</button>` : ''}
            <a class="btn btn-ghost" href="/boutique" data-link>Retour à la boutique</a>
          </div>
        </div>

        <div class="card" style="margin-top:22px">
          <div class="card-title">Statut de la livraison</div>
          <div id="deliveryBox" style="margin-top:16px">
            ${order.delivery ? deliverySteps(order.delivery) : '<p class="tiny">La livraison démarre dès la confirmation du paiement.</p>'}
          </div>
          ${order.delivery?.txId ? `<p class="tiny mono" style="margin-top:14px">Transaction : ${esc(order.delivery.txId)}</p>` : ''}
        </div>

        <div class="card" style="margin-top:22px">
          <div class="card-title">Détails</div>
          <div class="table-wrap" style="margin-top:14px;border:none">
            <table style="min-width:auto">
              <tbody>
                <tr><td class="muted">Montant</td><td><strong>${esc(order.amount)} €</strong></td></tr>
                <tr><td class="muted">Paiement</td><td>${esc(order.provider)} · ${esc(order.statusLabel)}</td></tr>
                <tr><td class="muted">Payée le</td><td>${order.paidAt ? fmtDate(order.paidAt) : '—'}</td></tr>
                <tr><td class="muted">Commande</td><td class="mono tiny">${esc(order.id)}</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>`;

  return {
    title: `Commande ${order.number}`,
    html,
    mount(root) {
      reveal(root);
      root.querySelector('#btnPay')?.addEventListener('click', async (event) => {
        const restore = loadingButton(event.currentTarget, 'Redirection…');
        try {
          const { checkout } = await post(`/api/orders/${order.id}/checkout`);
          window.location.href = checkout.url;
        } catch (error) { restore(); toastError(error.message); }
      });
      root.querySelector('#btnDeliver')?.addEventListener('click', async (event) => {
        const restore = loadingButton(event.currentTarget, 'Livraison…');
        try {
          await post(`/api/orders/${order.id}/deliver`);
          toastSuccess('Livraison relancée. Les récompenses déjà attribuées ne sont pas dupliquées.', 'Livraison');
          navigate(`/commande/${order.id}`, { replace: true });
        } catch (error) { restore(); toastError(error.message); }
      });

      // Actualisation automatique tant que la commande n'est pas terminée.
      if (!['paid', 'refunded', 'canceled', 'expired'].includes(order.status)) {
        let ticks = 0;
        const timer = setInterval(async () => {
          ticks += 1;
          if (ticks > 20) { clearInterval(timer); return; }
          try {
            const fresh = (await get(`/api/orders/${order.id}`)).order;
            if (fresh.status !== order.status) {
              clearInterval(timer);
              toastSuccess(`Statut mis à jour : ${fresh.statusLabel}`, 'Commande');
              navigate(`/commande/${order.id}`, { replace: true });
            }
          } catch { /* ignore */ }
        }, 3000);
        return () => clearInterval(timer);
      }
      return undefined;
    },
  };
}

/* --------------------- Page de paiement de démonstration ------------------ */

export async function demoPayView({ params }) {
  if (!isLogged()) return { title: 'Paiement', html: '' };
  let order;
  try { order = (await get(`/api/orders/${params.id}`)).order; }
  catch (error) { return { title: 'Paiement', html: `<div class="container section">${emptyState('card', 'Commande introuvable', error.message)}</div>` }; }

  if (order.status === 'paid') {
    navigate(`/commande/${order.id}`, { replace: true });
    return { title: 'Paiement', html: '' };
  }

  const html = `
    <section class="section">
      <div class="container" style="max-width:640px">
        <div class="center" style="margin-bottom:24px">
          <div class="eyebrow" style="justify-content:center">Page de paiement sécurisée</div>
          <h1 class="h2">Paiement <span class="grad-text">KALEA</span></h1>
          <p class="muted small" style="margin-top:10px">Mode démonstration — aucun paiement réel n'est effectué.</p>
        </div>

        <div class="card">
          <div class="row-between">
            <div>
              <strong>${esc(order.pack?.emoji ?? '')} ${esc(order.pack?.name ?? 'Pack')}</strong>
              <div class="tiny">Commande ${esc(order.number)}</div>
            </div>
            <div class="pack-price"><span class="amount" style="font-size:2rem">${esc(order.amount)}</span><span class="cur">€</span></div>
          </div>

          <div class="divider"></div>

          <div class="stack">
            <div class="notice notice-info"><span>🔒</span>
              <div class="small">En production, cette page est remplacée par la page hébergée du prestataire (PayPal / carte). KALEA ne manipule aucune donnée bancaire.</div></div>

            <button class="btn btn-primary btn-block btn-lg" data-outcome="succeeded">✓ Payer ${esc(order.amount)} € (succès)</button>
            <button class="btn btn-ghost btn-block" data-outcome="failed">✕ Simuler un paiement refusé</button>
            <button class="btn btn-ghost btn-block" data-outcome="canceled">↩ Annuler la commande</button>
          </div>

          <p class="tiny center" style="margin-top:18px">
            Le paiement est confirmé par un webhook signé, vérifié côté serveur, puis les récompenses sont livrées automatiquement.
          </p>
        </div>

        <div class="center" style="margin-top:20px">
          <a class="btn btn-ghost btn-sm" href="/commande/${esc(order.id)}" data-link>Retour à la commande</a>
        </div>
      </div>
    </section>`;

  return {
    title: 'Paiement',
    html,
    mount(root) {
      reveal(root);
      root.querySelectorAll('[data-outcome]').forEach((button) => {
        button.addEventListener('click', async () => {
          const restore = loadingButton(button, 'Traitement…');
          try {
            const res = await post(`/api/demo/orders/${order.id}/pay`, { outcome: button.dataset.outcome });
            if (res.status === 'paid') {
              toastSuccess('Paiement confirmé ! Vos récompenses sont en cours de livraison.', 'Paiement accepté');
              navigate(`/commande/${order.id}?result=success`);
            } else if (res.status === 'failed') {
              toastError('Paiement refusé (simulation). Vous pouvez réessayer.', 'Paiement échoué');
              navigate(`/commande/${order.id}?result=failed`);
            } else {
              toastSuccess('Commande annulée.', 'Annulé');
              navigate(`/commande/${order.id}?result=canceled`);
            }
          } catch (error) {
            restore();
            toastError(error.message);
          }
        });
      });
    },
  };
}
