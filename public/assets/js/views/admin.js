/**
 * KALEA — dashboard administrateur (statistiques, packs, commandes,
 * paiements, utilisateurs, livraisons, logs, tickets, paramètres).
 */
import { get, post, put, del } from '../api.js';
import { state, setUser } from '../state.js';
import {
  esc, fmtEUR, fmtDate, fmtRelative, badge, reveal, toastSuccess, toastError,
  loadingButton, emptyState, modal, confirmDialog, qs, qsa, skeleton, icon, applyTheme, countUp,
} from '../ui.js';
import { navigate } from '../router.js';

/* ------------------------------ Coquille ------------------------------- */

const NAV = [
  { group: 'Pilotage', items: [
    { key: 'overview', href: '/admin', label: 'Vue d’ensemble', icon: 'dashboard' },
    { key: 'stats', href: '/admin/statistiques', label: 'Statistiques', icon: 'chart' },
  ] },
  { group: 'Ventes', items: [
    { key: 'packs', href: '/admin/packs', label: 'Packs', icon: 'cube' },
    { key: 'categories', href: '/admin/categories', label: 'Catégories', icon: 'layers' },
    { key: 'promotions', href: '/admin/promotions', label: 'Promotions', icon: 'tag' },
    { key: 'orders', href: '/admin/commandes', label: 'Commandes', icon: 'receipt' },
    { key: 'payments', href: '/admin/paiements', label: 'Paiements', icon: 'card' },
  ] },
  { group: 'Livraison', items: [
    { key: 'deliveries', href: '/admin/livraisons', label: 'Livraisons', icon: 'package' },
    { key: 'errors', href: '/admin/erreurs', label: 'Erreurs', icon: 'alert' },
    { key: 'game', href: '/admin/jeu', label: 'API du jeu', icon: 'gamepad' },
  ] } ,
  { group: 'Communauté', items: [
    { key: 'users', href: '/admin/utilisateurs', label: 'Utilisateurs', icon: 'users' },
    { key: 'tickets', href: '/admin/tickets', label: 'Support', icon: 'message' },
  ] },
  { group: 'Système', items: [
    { key: 'logs', href: '/admin/logs', label: 'Logs', icon: 'scroll' },
    { key: 'settings', href: '/admin/parametres', label: 'Paramètres', icon: 'settings' },
  ] },
];

function shell(activeKey, content) {
  return `
    <div class="admin-layout">
      <aside class="admin-side">
        ${NAV.map((group) => `
          <h5>${esc(group.group)}</h5>
          ${group.items.map((item) => `
            <a class="admin-link ${item.key === activeKey ? 'active' : ''}" href="${item.href}" data-link>
              <span class="admin-ico">${icon(item.icon, { size: 17 })}</span><span>${esc(item.label)}</span>
            </a>`).join('')}`).join('')}
      </aside>
      <div class="admin-main">${content}</div>
    </div>`;
}

const pageHeader = (title, subtitle = '', actions = '') => `
  <div class="row-between wrap" style="margin-bottom:26px">
    <div>
      <div class="eyebrow">Dashboard KaleaShop</div>
      <h1 class="h3">${esc(title)}</h1>
      ${subtitle ? `<p class="muted small" style="margin-top:6px">${subtitle}</p>` : ''}
    </div>
    <div class="row wrap" style="gap:10px">${actions}</div>
  </div>`;

/* --------------------------- Vue d'ensemble ---------------------------- */

export async function adminOverviewView() {
  let stats;
  try { stats = (await get('/api/admin/stats')).stats; }
  catch (error) { return { title: 'Dashboard', html: shell('overview', emptyState('lock', 'Accès refusé', error.message)) }; }

  const maxRev = Math.max(...stats.series.map((s) => s.revenue), 1);

  const html = shell('overview', `
    ${pageHeader('Vue d’ensemble', 'Performance de la boutique en temps réel',
      `<a class="btn btn-ghost btn-sm" href="/admin/packs" data-link>Configurer les packs</a>
       <a class="btn btn-primary btn-sm" href="/boutique" data-link>Voir la boutique</a>`)}

    <div class="grid grid-stats" style="margin-bottom:26px">
      <div class="stat-card reveal"><div class="stat-label">Chiffre d’affaires net</div>
        <div class="stat-value grad-text">${esc(stats.revenue.net)} €</div>
        <div class="stat-sub">${esc(stats.revenue.gross)} € encaissés · ${esc(stats.revenue.refunded)} € remboursés</div></div>
      <div class="stat-card reveal"><div class="stat-label">Commandes payées</div>
        <div class="stat-value"><span data-count="${stats.orders.paid}">0</span></div>
        <div class="stat-sub">${stats.orders.total} au total · ${stats.orders.pending} en attente</div></div>
      <div class="stat-card reveal"><div class="stat-label">Utilisateurs</div>
        <div class="stat-value"><span data-count="${stats.users.total}">0</span></div>
        <div class="stat-sub">${stats.users.discordLinked} avec Discord connecté</div></div>
      <div class="stat-card reveal"><div class="stat-label">Produits en vente</div>
        <div class="stat-value"><span data-count="${stats.packs.filter((p) => p.active).length}">0</span></div>
        <div class="stat-sub">${stats.packs.length} pack(s) au catalogue</div></div>
      <div class="stat-card reveal"><div class="stat-label">Livraisons</div>
        <div class="stat-value"><span data-count="${stats.deliveries.delivered}">0</span></div>
        <div class="stat-sub">${stats.deliveries.errors} erreur(s) · ${stats.deliveries.running} en cours</div></div>
    </div>

    <div class="grid" style="grid-template-columns:1.5fr 1fr;gap:22px;align-items:start">
      <div class="card reveal">
        <div class="row-between"><div class="card-title">Revenus — 14 derniers jours</div>
          <span class="badge">en €</span></div>
        <div class="bars" style="margin-top:18px">
          ${stats.series.map((s) => `
            <div class="bar" style="height:${Math.max(4, (s.revenue / maxRev) * 100)}%"
                 data-label="${esc(s.label)}" title="${esc(s.label)} : ${s.revenue.toFixed(2)} €"></div>`).join('')}
        </div>
        <div style="height:22px"></div>
      </div>

      <div class="card reveal">
        <div class="card-title">Répartition des commandes</div>
        <div class="stack" style="margin-top:16px;gap:10px">
          ${stats.orders.breakdown.length ? stats.orders.breakdown.map((b) => `
            <div class="row-between">
              <span class="muted small">${esc(b.label)}</span>
              <span>${badge(b.status, `${b.count}`)}</span>
            </div>`).join('') : '<p class="tiny">Aucune commande.</p>'}
        </div>
        <div class="divider"></div>
        <div class="card-title">Ventes par pack</div>
        <div class="stack" style="margin-top:14px;gap:10px">
          ${stats.packs.map((p) => `
            <div class="row-between">
              <span class="muted small">${esc(p.emoji)} ${esc(p.name)} ${p.active ? '' : '(inactif)'}</span>
              <span><strong>${p.units}</strong> <span class="tiny">· ${esc(p.revenue)} €</span></span>
            </div>`).join('')}
        </div>
      </div>
    </div>

    <div class="card reveal" style="margin-top:22px">
      <div class="row-between"><div class="card-title">Dernières commandes</div>
        <a class="btn btn-ghost btn-sm" href="/admin/commandes" data-link>Toutes →</a></div>
      <div class="table-wrap" style="margin-top:16px;border:none">
        <table>
          <thead><tr><th>Commande</th><th>Joueur</th><th>Pack</th><th>Montant</th><th>Statut</th><th>Date</th></tr></thead>
          <tbody>
            ${stats.recentOrders.length ? stats.recentOrders.map((o) => `
              <tr>
                <td class="mono small">${esc(o.number)}</td>
                <td>${esc(o.user)}<div class="tiny">${esc(o.email ?? '')}</div></td>
                <td>${esc(o.pack)}</td>
                <td><strong>${esc(o.amount)} €</strong></td>
                <td>${badge(o.status)}</td>
                <td class="tiny">${fmtRelative(o.createdAt)}</td>
              </tr>`).join('') : '<tr><td colspan="6" class="tiny">Aucune commande.</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>`);

  return {
    title: 'Dashboard',
    html,
    mount(root) {
      reveal(root);
      // Compteurs animés sur les cartes de statistiques.
      root.querySelectorAll('[data-count]').forEach((el) => {
        countUp(el, Number(el.dataset.count), { suffix: el.dataset.suffix ?? '' });
      });
    },
  };
}

/* ---------------------------- Statistiques ----------------------------- */

export async function adminStatsView() {
  const { stats } = await get('/api/admin/stats');
  const maxRev = Math.max(...stats.series.map((s) => s.revenue), 1);
  const maxOrders = Math.max(...stats.series.map((s) => s.orders), 1);

  const html = shell('stats', `
    ${pageHeader('Statistiques de ventes', 'Analyse détaillée du commerce')}
    <div class="grid grid-2">
      <div class="card reveal">
        <div class="card-title">Revenus (14 j)</div>
        <div class="bars" style="margin-top:16px">
          ${stats.series.map((s) => `<div class="bar" style="height:${Math.max(4, (s.revenue / maxRev) * 100)}%" data-label="${esc(s.label)}" title="${s.revenue.toFixed(2)} €"></div>`).join('')}
        </div><div style="height:22px"></div>
      </div>
      <div class="card reveal">
        <div class="card-title">Volume de commandes (14 j)</div>
        <div class="bars" style="margin-top:16px">
          ${stats.series.map((s) => `<div class="bar" style="height:${Math.max(4, (s.orders / maxOrders) * 100)}%;background:linear-gradient(180deg,#22d3ee,rgba(34,211,238,.2))" data-label="${esc(s.label)}" title="${s.orders} commande(s)"></div>`).join('')}
        </div><div style="height:22px"></div>
      </div>
    </div>

    <div class="card reveal" style="margin-top:22px">
      <div class="card-title">Performance des packs</div>
      <div class="table-wrap" style="margin-top:16px;border:none">
        <table>
          <thead><tr><th>Pack</th><th>Prix</th><th>Ventes</th><th>Revenu</th><th>Statut</th></tr></thead>
          <tbody>
            ${stats.packs.map((p) => `<tr>
              <td>${esc(p.emoji)} ${esc(p.name)}</td><td>${esc(p.price)} €</td>
              <td><strong>${p.units}</strong></td><td>${esc(p.revenue)} €</td>
              <td>${badge(p.active ? 'active' : 'expired', p.active ? 'En vente' : 'Masqué')}</td></tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>

    <div class="grid grid-4" style="margin-top:22px">
      <div class="stat-card"><div class="stat-label">Panier moyen</div>
        <div class="stat-value">${stats.orders.paid ? (Number(stats.revenue.gross.replace(',', '.')) / stats.orders.paid).toFixed(2) : '0,00'} €</div></div>
      <div class="stat-card"><div class="stat-label">Taux de réussite</div>
        <div class="stat-value">${stats.orders.total ? Math.round((stats.orders.paid / stats.orders.total) * 100) : 0} %</div></div>
      <div class="stat-card"><div class="stat-label">Remboursements</div>
        <div class="stat-value">${stats.orders.refunded}</div></div>
      <div class="stat-card"><div class="stat-label">Taux de livraison</div>
        <div class="stat-value">${stats.deliveries.delivered + stats.deliveries.errors > 0
          ? Math.round((stats.deliveries.delivered / Math.max(1, stats.deliveries.delivered + stats.deliveries.errors)) * 100) : 100} %</div></div>
    </div>`);

  return { title: 'Statistiques', html, mount(root) { reveal(root); } };
}

/* -------------------------------- Packs -------------------------------- */

function packFormFields(pack = {}) {
  const rewards = pack.rewards ?? {};
  const lines = (list = []) => (list ?? []).map((x) => (typeof x === 'string' ? x : `${x.id} | ${x.name ?? x.id}`)).join('\n');
  return `
    <div class="form-grid">
      <div class="field"><label class="label">Nom</label><input class="input" name="name" value="${esc(pack.name ?? '')}" required /></div>
      <div class="field"><label class="label">Slug (URL)</label><input class="input" name="slug" value="${esc(pack.slug ?? '')}" placeholder="mon-pack" /></div>
    </div>
    <div class="form-grid">
      <div class="field"><label class="label">Emoji</label><input class="input" name="emoji" value="${esc(pack.emoji ?? '🎁')}" /></div>
      <div class="field"><label class="label">Badge</label><input class="input" name="badge" value="${esc(pack.badge ?? '')}" placeholder="Populaire" /></div>
    </div>
    <div class="field"><label class="label">Accroche</label><input class="input" name="tagline" value="${esc(pack.tagline ?? '')}" maxlength="140" /></div>
    <div class="field"><label class="label">Description</label><textarea class="textarea" name="description" style="min-height:90px">${esc(pack.description ?? '')}</textarea></div>
    <div class="form-grid">
      <div class="field"><label class="label">Prix (€)</label><input class="input" name="price" type="number" step="0.01" min="0" value="${((pack.priceCents ?? 0) / 100).toFixed(2)}" required /></div>
      <div class="field"><label class="label">URL de l’image</label><input class="input" name="imageUrl" value="${esc(pack.imageUrl ?? '')}" placeholder="https://…" /></div>
    </div>
    <div class="form-grid">
      <div class="field"><label class="label">Catégorie</label>
        <select class="select" name="categoryId" id="categorySelect">
          <option value="">— Sans catégorie —</option>
        </select>
        <span class="hint">Classée depuis « Catégories » du menu admin.</span></div>
      <div class="field"><label class="label">Stock restant</label>
        <input class="input" name="stock" type="number" step="1" min="-1" value="${pack.stock ?? -1}" />
        <span class="hint">-1 = illimité · 0 = épuisé (vente bloquée).</span></div>
    </div>
    <div class="field"><label class="label">Avantages affichés (un par ligne)</label>
      <textarea class="textarea" name="features" style="min-height:90px">${esc((pack.features ?? []).join('\n'))}</textarea></div>

    <div class="divider"></div>
    <div class="card-title">Rôle Discord</div>
    <div class="form-grid" style="margin-top:12px">
      <div class="field"><label class="label">Rôle (sélecteur)</label>
        <select class="select" name="discordRoleId" id="roleSelect">
          <option value="">— Aucun —</option>
        </select>
        <span class="hint">Chargé depuis le serveur Discord si le bot est configuré.</span></div>
      <div class="field"><label class="label">ou identifiant brut</label>
        <input class="input" name="discordRoleIdManual" value="${esc(pack.discordRole?.id ?? '')}" placeholder="123456789012345678" /></div>
    </div>
    <div class="field"><label class="label">Nom du rôle affiché</label>
      <input class="input" name="discordRoleName" value="${esc(pack.discordRole?.name ?? '')}" placeholder="Full Locker" /></div>

    <div class="divider"></div>
    <div class="card-title">Récompenses en jeu</div>
    <div class="field" style="margin-top:12px"><label class="label">Skins (un par ligne : <span class="mono">id | Nom</span>)</label>
      <textarea class="textarea" name="skins" style="min-height:76px">${esc(lines(rewards.skins))}</textarea></div>
    <div class="field"><label class="label">Objets (un par ligne)</label>
      <textarea class="textarea" name="items" style="min-height:76px">${esc(lines(rewards.items))}</textarea></div>
    <div class="form-grid">
      <div class="field"><label class="label">Monnaie virtuelle</label>
        <input class="input" name="currencyType" value="${esc(rewards.currency?.type ?? '')}" placeholder="kalea_coins" /></div>
      <div class="field"><label class="label">Montant</label>
        <input class="input" name="currencyAmount" type="number" min="0" value="${rewards.currency?.amount ?? ''}" /></div>
    </div>
    <div class="field"><label class="label">Permissions (un par ligne)</label>
      <textarea class="textarea" name="permissions" style="min-height:76px">${esc(lines(rewards.permissions))}</textarea></div>
    <div class="field"><label class="label">Fonctionnalités (un par ligne)</label>
      <textarea class="textarea" name="gameFeatures" style="min-height:76px">${esc(lines(rewards.features))}</textarea></div>
    <div class="field"><label class="label">Profil / données joueur (JSON, optionnel)</label>
      <input class="input mono" name="profile" value="${esc(rewards.profile ? JSON.stringify(rewards.profile) : '')}" placeholder='{"role":"moder"}' /></div>

    <div class="form-grid" style="margin-top:6px">
      <div class="field"><label class="label">Ordre d’affichage</label>
        <input class="input" name="sortOrder" type="number" value="${pack.sortOrder ?? 0}" /></div>
      <div class="field"><label class="label">En vente</label>
        <select class="select" name="active"><option value="1" ${pack.active !== false ? 'selected' : ''}>Oui</option>
        <option value="0" ${pack.active === false ? 'selected' : ''}>Non</option></select></div>
    </div>
    <div class="form-error" id="packError"></div>`;
}

const parseLines = (value) => String(value ?? '')
  .split('\n').map((l) => l.trim()).filter(Boolean)
  .map((line) => {
    const [id, ...rest] = line.split('|').map((s) => s.trim());
    return rest.length ? { id, name: rest.join('|') } : id;
  });

function readPackForm(form) {
  const fd = Object.fromEntries(new FormData(form).entries());
  let profile = null;
  if (fd.profile?.trim()) {
    try { profile = JSON.parse(fd.profile); }
    catch { throw new Error('Le profil doit être un JSON valide.'); }
  }
  const rewards = {};
  const skins = parseLines(fd.skins);
  const items = parseLines(fd.items);
  const permissions = parseLines(fd.permissions);
  const features = parseLines(fd.gameFeatures);
  if (skins.length) rewards.skins = skins;
  if (items.length) rewards.items = items;
  if (permissions.length) rewards.permissions = permissions;
  if (features.length) rewards.features = features;
  if (fd.currencyType && Number(fd.currencyAmount) > 0) {
    rewards.currency = { type: fd.currencyType, amount: Math.floor(Number(fd.currencyAmount)) };
  }
  if (profile) rewards.profile = profile;

  return {
    name: fd.name,
    slug: fd.slug,
    emoji: fd.emoji,
    badge: fd.badge,
    tagline: fd.tagline,
    description: fd.description,
    price: Number(fd.price),
    imageUrl: fd.imageUrl,
    features: String(fd.features ?? '').split('\n').map((s) => s.trim()).filter(Boolean),
    categoryId: fd.categoryId || null,
    stock: fd.stock === '' || fd.stock === undefined ? -1 : Number(fd.stock),
    discordRoleId: fd.discordRoleIdManual || fd.discordRoleId || '',
    discordRoleName: fd.discordRoleName,
    rewards,
    sortOrder: Number(fd.sortOrder ?? 0),
    active: fd.active === '1',
  };
}

async function openPackModal(pack = null) {
  const rolesPromise = get('/api/admin/discord/roles').catch(() => ({ roles: [] }));
  const categoriesPromise = get('/api/admin/categories').catch(() => ({ categories: [] }));
  const instance = modal({
    title: pack ? `Modifier « ${pack.name} »` : 'Nouveau pack',
    body: `<form id="packForm">${packFormFields(pack ?? {})}</form>`,
    actions: [
      { label: 'Annuler', className: 'btn-ghost' },
      ...(pack ? [{ label: 'Supprimer', className: 'btn-danger', keepOpen: true, onClick: async ({ close }) => {
        const ok = await confirmDialog(`Supprimer « ${pack.name} » ? Les packs déjà commandés restent dans l’historique (désactivation automatique).`, { danger: true, confirmLabel: 'Supprimer' });
        if (!ok) return false;
        try {
          await del(`/api/admin/packs/${pack.id}`);
          toastSuccess('Pack supprimé.');
          close();
          navigate('/admin/packs', { replace: true });
        } catch (error) { toastError(error.message); }
        return false;
      } }] : []),
      { label: pack ? 'Enregistrer' : 'Créer le pack', className: 'btn-primary', keepOpen: true, onClick: async ({ close }) => {
        const form = instance.root.querySelector('#packForm');
        const errorEl = instance.root.querySelector('#packError');
        errorEl.textContent = '';
        let payload;
        try { payload = readPackForm(form); } catch (error) { errorEl.textContent = error.message; return false; }
        try {
          const res = pack
            ? await put(`/api/admin/packs/${pack.id}`, payload)
            : await post('/api/admin/packs', payload);
          toastSuccess(pack ? 'Pack mis à jour.' : `Pack « ${res.pack.name} » créé.`);
          close();
          navigate('/admin/packs', { replace: true });
        } catch (error) {
          errorEl.textContent = error.message;
          return false;
        }
        return false;
      } },
    ],
  });

  // Remplissage du sélecteur de rôles Discord.
  const roles = await rolesPromise;
  const select = instance.root.querySelector('#roleSelect');
  if (select) {
    for (const role of roles.roles ?? []) {
      const option = document.createElement('option');
      option.value = role.id;
      option.textContent = role.name;
      if (pack?.discordRole?.id === role.id) option.selected = true;
      select.appendChild(option);
    }
  }

  // Remplissage du sélecteur de catégories.
  const categories = await categoriesPromise;
  const categorySelect = instance.root.querySelector('#categorySelect');
  if (categorySelect) {
    for (const category of categories.categories ?? []) {
      if (!category.active) continue;
      const option = document.createElement('option');
      option.value = category.id;
      option.textContent = `${category.emoji ?? ''} ${category.name}`.trim();
      if ((pack?.categoryId ?? null) === category.id) option.selected = true;
      categorySelect.appendChild(option);
    }
    if (pack?.categoryId && !categorySelect.selectedOptions.length) {
      // La catégorie a été désactivée : on conserve la valeur pour ne rien perdre.
      const option = document.createElement('option');
      option.value = pack.categoryId;
      option.textContent = `${pack.category?.emoji ?? ''} ${pack.category?.name ?? 'Catégorie inconnue'}`.trim();
      option.selected = true;
      categorySelect.appendChild(option);
    }
  }
}

export async function adminPacksView() {
  const { packs } = await get('/api/admin/packs');
  const html = shell('packs', `
    ${pageHeader('Packs', 'Produit → Prix → Rôle Discord → Récompenses → Fonctionnalités en jeu',
      '<button class="btn btn-primary btn-sm" id="btnNewPack">+ Nouveau pack</button>')}
    ${packs.length ? `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Pack</th><th>Prix</th><th>Catégorie</th><th>Stock</th><th>Rôle Discord</th><th>Récompenses</th><th>Statut</th><th>Ordre</th><th></th></tr></thead>
        <tbody>
          ${packs.map((p) => `
            <tr>
              <td><strong>${esc(p.emoji)} ${esc(p.name)}</strong><div class="tiny">${esc(p.tagline ?? '')}</div></td>
              <td><strong>${esc(p.price)} €</strong></td>
              <td>${p.category ? `<span class="badge">${esc(p.category.emoji ?? '')} ${esc(p.category.name)}</span>` : '<span class="tiny">Sans catégorie</span>'}</td>
              <td>${p.stock < 0 ? '<span class="tiny">Illimité</span>' : p.stock === 0 ? badge('failed', 'Épuisé') : badge('active', `${p.stock}`)}</td>
              <td>${p.discordRole?.name ? `<span class="badge">${esc(p.discordRole.name)}</span>` : '<span class="tiny">Aucun</span>'}</td>
              <td class="tiny">${(p.rewardSummary ?? []).length} élément(s)</td>
              <td>${badge(p.active ? 'active' : 'expired', p.active ? 'En vente' : 'Masqué')}</td>
              <td>${p.sortOrder}</td>
              <td class="actions"><button class="btn btn-ghost btn-sm" data-edit="${esc(p.id)}">Modifier</button></td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>` : emptyState('cube', 'Aucun pack', 'Créez votre premier produit.')}

    <div class="notice notice-info" style="margin-top:22px">
      <span>💡</span>
      <div class="small">Toute modification est immédiatement visible dans la boutique et s’applique aux prochaines livraisons. Aucun changement de code n’est nécessaire.</div>
    </div>`);

  return {
    title: 'Packs — Admin', html,
    mount(root) {
      reveal(root);
      root.querySelector('#btnNewPack')?.addEventListener('click', () => openPackModal());
      root.querySelectorAll('[data-edit]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const pack = packs.find((p) => p.id === btn.dataset.edit);
          if (pack) openPackModal(pack);
        });
      });
    },
  };
}

/* ------------------------------ Catégories ------------------------------ */

function categoryFormFields(category = {}) {
  return `
    <div class="form-grid">
      <div class="field"><label class="label">Nom</label><input class="input" name="name" value="${esc(category.name ?? '')}" required placeholder="Avantages" /></div>
      <div class="field"><label class="label">Slug (URL)</label><input class="input" name="slug" value="${esc(category.slug ?? '')}" placeholder="avantages" /></div>
    </div>
    <div class="form-grid">
      <div class="field"><label class="label">Emoji</label><input class="input" name="emoji" value="${esc(category.emoji ?? '🗂️')}" /></div>
      <div class="field"><label class="label">Ordre d’affichage</label><input class="input" name="sortOrder" type="number" value="${category.sortOrder ?? 0}" /></div>
    </div>
    <div class="field"><label class="label">Description (facultative)</label>
      <textarea class="textarea" name="description" style="min-height:70px">${esc(category.description ?? '')}</textarea></div>
    <div class="field"><label class="label">Visible en boutique</label>
      <select class="select" name="active">
        <option value="1" ${category.active !== false ? 'selected' : ''}>Oui</option>
        <option value="0" ${category.active === false ? 'selected' : ''}>Non</option>
      </select></div>
    <div class="form-error" id="categoryError"></div>`;
}

function openCategoryModal(category = null) {
  const instance = modal({
    title: category ? `Modifier « ${category.name} »` : 'Nouvelle catégorie',
    body: `<form id="categoryForm">${categoryFormFields(category ?? {})}</form>`,
    actions: [
      { label: 'Annuler', className: 'btn-ghost' },
      { label: category ? 'Enregistrer' : 'Créer', className: 'btn-primary', keepOpen: true, onClick: async ({ close }) => {
        const form = instance.root.querySelector('#categoryForm');
        const errorEl = instance.root.querySelector('#categoryError');
        errorEl.textContent = '';
        const fd = Object.fromEntries(new FormData(form).entries());
        try {
          const payload = {
            name: fd.name,
            slug: fd.slug,
            emoji: fd.emoji,
            description: fd.description,
            sortOrder: Number(fd.sortOrder ?? 0),
            active: fd.active === '1',
          };
          if (category) await put(`/api/admin/categories/${category.id}`, payload);
          else await post('/api/admin/categories', payload);
          toastSuccess(category ? 'Catégorie mise à jour.' : `Catégorie « ${payload.name} » créée.`);
          close();
          navigate('/admin/categories', { replace: true });
        } catch (error) { errorEl.textContent = error.message; return false; }
        return false;
      } },
    ],
  });
}

export async function adminCategoriesView() {
  const { categories } = await get('/api/admin/categories');
  const html = shell('categories', `
    ${pageHeader('Catégories', 'Classez vos packs : les catégories deviennent les filtres de la boutique',
      '<button class="btn btn-primary btn-sm" id="btnNewCategory">+ Nouvelle catégorie</button>')}
    ${categories.length ? `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Catégorie</th><th>Slug</th><th>Packs</th><th>Ordre</th><th>Statut</th><th></th></tr></thead>
        <tbody>
          ${categories.map((c) => `
            <tr>
              <td><strong>${esc(c.emoji)} ${esc(c.name)}</strong><div class="tiny">${esc(c.description ?? '')}</div></td>
              <td class="mono small">${esc(c.slug)}</td>
              <td>${c.packCount}</td>
              <td>${c.sortOrder}</td>
              <td>${badge(c.active ? 'active' : 'expired', c.active ? 'Visible' : 'Masquée')}</td>
              <td class="actions">
                <button class="btn btn-ghost btn-sm" data-edit="${esc(c.id)}">Modifier</button>
                <button class="btn btn-ghost btn-sm" data-delete="${esc(c.id)}">Supprimer</button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>` : emptyState('layers', 'Aucune catégorie', 'Créez une catégorie pour organiser vos packs.')}

    <div class="notice notice-info" style="margin-top:22px">
      <span>💡</span>
      <div class="small">La suppression d’une catégorie ne supprime jamais les packs : ils repassent en « Sans catégorie ». Seules les catégories utilisées par un pack actif apparaissent dans les filtres de la boutique.</div>
    </div>`);

  return {
    title: 'Catégories — Admin', html,
    mount(root) {
      reveal(root);
      root.querySelector('#btnNewCategory')?.addEventListener('click', () => openCategoryModal());
      root.querySelectorAll('[data-edit]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const category = categories.find((c) => c.id === btn.dataset.edit);
          if (category) openCategoryModal(category);
        });
      });
      root.querySelectorAll('[data-delete]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const category = categories.find((c) => c.id === btn.dataset.delete);
          if (!category) return;
          const ok = await confirmDialog(
            `Supprimer « ${category.name} » ? ${category.packCount ? `${category.packCount} pack(s) repasseront en « Sans catégorie ».` : 'Aucun pack n’est concerné.'}`,
            { danger: true, confirmLabel: 'Supprimer' },
          );
          if (!ok) return;
          try {
            await del(`/api/admin/categories/${category.id}`);
            toastSuccess('Catégorie supprimée.');
            navigate('/admin/categories', { replace: true });
          } catch (error) { toastError(error.message); }
        });
      });
    },
  };
}

/* ------------------------------ Promotions ----------------------------- */

/** ms → valeur `datetime-local` (heure locale). */
const toLocalInput = (ms) => {
  if (!ms) return '';
  const d = new Date(Number(ms));
  const shifted = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return shifted.toISOString().slice(0, 16);
};
/** `datetime-local` → ms, ou null. */
const fromLocalInput = (value) => (value ? new Date(value).getTime() : null);

function promoFormFields(promo = {}) {
  const isFixed = promo.kind === 'fixed';
  return `
    <div class="form-grid">
      <div class="field"><label class="label">Code</label>
        <input class="input mono" name="code" value="${esc(promo.code ?? '')}" required placeholder="BIENVENUE10" style="text-transform:uppercase" />
        <span class="hint">Saisi par le client dans le panier (insensible à la casse).</span></div>
      <div class="field"><label class="label">Libellé interne (facultatif)</label>
        <input class="input" name="label" value="${esc(promo.label ?? '')}" placeholder="Soldes d’automne" /></div>
    </div>
    <div class="form-grid">
      <div class="field"><label class="label">Type de remise</label>
        <select class="select" name="kind" id="promoKind">
          <option value="percent" ${!isFixed ? 'selected' : ''}>Pourcentage (%)</option>
          <option value="fixed" ${isFixed ? 'selected' : ''}>Montant fixe (€)</option>
        </select></div>
      <div class="field"><label class="label">Valeur</label>
        <input class="input" name="value" id="promoValue" type="number" step="0.01" min="0.01"
          value="${isFixed ? ((promo.value ?? 0) / 100).toFixed(2) : (promo.value ?? '')}" required />
        <span class="hint" id="promoValueHint">${isFixed ? 'Montant retiré du panier.' : 'Pourcentage retiré du panier (1 à 99).'}</span></div>
    </div>
    <div class="form-grid">
      <div class="field"><label class="label">Panier minimum (€)</label>
        <input class="input" name="minAmount" type="number" step="0.01" min="0"
          value="${((promo.minAmountCents ?? 0) / 100).toFixed(2)}" /></div>
      <div class="field"><label class="label">Utilisations max.</label>
        <input class="input" name="maxUses" type="number" min="1" value="${promo.maxUses ?? ''}" placeholder="Illimité" />
        <span class="hint">Vide = illimité.</span></div>
    </div>
    <div class="form-grid">
      <div class="field"><label class="label">Début (facultatif)</label>
        <input class="input" name="startsAt" type="datetime-local" value="${toLocalInput(promo.startsAt)}" /></div>
      <div class="field"><label class="label">Fin (facultative)</label>
        <input class="input" name="endsAt" type="datetime-local" value="${toLocalInput(promo.endsAt)}" /></div>
    </div>
    <div class="field"><label class="label">Actif</label>
      <select class="select" name="active">
        <option value="1" ${promo.active !== false ? 'selected' : ''}>Oui</option>
        <option value="0" ${promo.active === false ? 'selected' : ''}>Non</option>
      </select></div>
    <div class="form-error" id="promoError"></div>`;
}

function readPromoForm(form) {
  const fd = Object.fromEntries(new FormData(form).entries());
  const kind = fd.kind === 'fixed' ? 'fixed' : 'percent';
  const raw = Number(fd.value);
  if (!Number.isFinite(raw) || raw <= 0) throw new Error('La valeur de la remise doit être positive.');
  const value = kind === 'percent' ? Math.round(raw) : Math.round(raw * 100);
  if (kind === 'percent' && (value < 1 || value > 99)) {
    throw new Error('Le pourcentage doit être compris entre 1 et 99.');
  }
  const minRaw = Number(fd.minAmount || 0);
  if (!Number.isFinite(minRaw) || minRaw < 0) throw new Error('Le panier minimum est invalide.');
  return {
    code: String(fd.code ?? '').trim(),
    label: fd.label,
    kind,
    value,
    minAmountCents: Math.round(minRaw * 100),
    maxUses: fd.maxUses === '' ? null : Number(fd.maxUses),
    startsAt: fromLocalInput(fd.startsAt),
    endsAt: fromLocalInput(fd.endsAt),
    active: fd.active === '1',
  };
}

function openPromoModal(promo = null) {
  const instance = modal({
    title: promo ? `Modifier le code « ${promo.code} »` : 'Nouveau code promotionnel',
    body: `<form id="promoForm">${promoFormFields(promo ?? {})}</form>`,
    actions: [
      { label: 'Annuler', className: 'btn-ghost' },
      { label: promo ? 'Enregistrer' : 'Créer le code', className: 'btn-primary', keepOpen: true, onClick: async ({ close }) => {
        const form = instance.root.querySelector('#promoForm');
        const errorEl = instance.root.querySelector('#promoError');
        errorEl.textContent = '';
        let payload;
        try { payload = readPromoForm(form); }
        catch (error) { errorEl.textContent = error.message; return false; }
        try {
          if (promo) await put(`/api/admin/promotions/${promo.id}`, payload);
          else await post('/api/admin/promotions', payload);
          toastSuccess(promo ? 'Code promotionnel mis à jour.' : `Code « ${payload.code} » créé.`);
          close();
          navigate('/admin/promotions', { replace: true });
        } catch (error) { errorEl.textContent = error.message; return false; }
        return false;
      } },
    ],
  });

  // Le champ « valeur » change d'unité selon le type choisi.
  const kindSelect = instance.root.querySelector('#promoKind');
  const valueInput = instance.root.querySelector('#promoValue');
  const hint = instance.root.querySelector('#promoValueHint');
  kindSelect?.addEventListener('change', () => {
    const fixed = kindSelect.value === 'fixed';
    valueInput.step = fixed ? '0.01' : '1';
    valueInput.max = fixed ? '' : '99';
    hint.textContent = fixed ? 'Montant retiré du panier.' : 'Pourcentage retiré du panier (1 à 99).';
  });
}

export async function adminPromotionsView() {
  const { promotions } = await get('/api/admin/promotions');
  const nowMs = Date.now();
  const period = (p) => {
    const parts = [];
    if (p.startsAt) parts.push(`dès le ${fmtDate(p.startsAt)}`);
    if (p.endsAt) parts.push(`jusqu’au ${fmtDate(p.endsAt)}`);
    return parts.join(' ') || 'Toujours';
  };

  const html = shell('promotions', `
    ${pageHeader('Promotions', 'Codes de réduction appliqués au panier — validation et calcul 100 % côté serveur',
      '<button class="btn btn-primary btn-sm" id="btnNewPromo">+ Nouveau code</button>')}
    ${promotions.length ? `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Code</th><th>Réduction</th><th>Panier min.</th><th>Utilisations</th><th>Période</th><th>Statut</th><th></th></tr></thead>
        <tbody>
          ${promotions.map((p) => {
            const inactive = !p.active || p.expired || (p.endsAt && p.endsAt < nowMs)
              || (p.maxUses !== null && p.usedCount >= p.maxUses);
            return `
            <tr>
              <td><strong class="mono">${esc(p.code)}</strong><div class="tiny">${esc(p.label ?? '')}</div></td>
              <td><strong>${esc(p.discountLabel)}</strong></td>
              <td class="tiny">${p.minAmountCents ? fmtEUR(p.minAmountCents) : '—'}</td>
              <td class="tiny">${p.usedCount}${p.maxUses !== null ? ` / ${p.maxUses}` : ' / ∞'}</td>
              <td class="tiny">${period(p)}</td>
              <td>${inactive
                ? badge(p.expired ? 'expired' : 'failed', p.expired ? 'Expiré' : (!p.active ? 'Inactif' : 'Épuisé'))
                : badge('active', 'Actif')}</td>
              <td class="actions">
                <button class="btn btn-ghost btn-sm" data-edit="${esc(p.id)}">Modifier</button>
                <button class="btn btn-ghost btn-sm" data-delete="${esc(p.id)}">Supprimer</button>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>` : emptyState('tag', 'Aucun code promotionnel', 'Créez votre premier code pour lancer une opération commerciale.')}

    <div class="notice notice-info" style="margin-top:22px">
      <span>💡</span>
      <div class="small">Les remises sont recalculées par le serveur au moment de la commande : le montant affiché dans le navigateur n’est qu’une estimation. Une utilisation est comptée à la création de la commande qui porte le code.</div>
    </div>`);

  return {
    title: 'Promotions — Admin', html,
    mount(root) {
      reveal(root);
      root.querySelector('#btnNewPromo')?.addEventListener('click', () => openPromoModal());
      root.querySelectorAll('[data-edit]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const promo = promotions.find((p) => p.id === btn.dataset.edit);
          if (promo) openPromoModal(promo);
        });
      });
      root.querySelectorAll('[data-delete]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const promo = promotions.find((p) => p.id === btn.dataset.delete);
          if (!promo) return;
          const ok = await confirmDialog(`Supprimer le code « ${promo.code} » ? Les commandes déjà créées conservent leur remise.`, { danger: true, confirmLabel: 'Supprimer' });
          if (!ok) return;
          try {
            await del(`/api/admin/promotions/${promo.id}`);
            toastSuccess('Code promotionnel supprimé.');
            navigate('/admin/promotions', { replace: true });
          } catch (error) { toastError(error.message); }
        });
      });
    },
  };
}

/* ------------------------------ Commandes ------------------------------ */

export async function adminOrdersView({ query }) {
  const status = query.get('status') ?? '';
  const search = query.get('q') ?? '';
  const page = Number(query.get('page') ?? 1);
  const params = new URLSearchParams({ status, q: search, page: String(page), limit: '25' });
  const data = await get(`/api/admin/orders?${params}`);

  const statusOptions = ['', 'paid', 'pending', 'processing', 'failed', 'refunded', 'canceled', 'expired'];

  const html = shell('orders', `
    ${pageHeader('Commandes', `${data.total} commande(s) au total`)}
    <div class="card" style="margin-bottom:20px">
      <form class="row wrap" id="filterForm" style="gap:12px">
        <input class="input" name="q" placeholder="N° de commande, e-mail, joueur, pack…" value="${esc(search)}" style="max-width:320px" />
        <select class="select" name="status" style="max-width:200px">
          ${statusOptions.map((s) => `<option value="${s}" ${s === status ? 'selected' : ''}>${s ? (s.charAt(0).toUpperCase() + s.slice(1)) : 'Tous les statuts'}</option>`).join('')}
        </select>
        <button class="btn btn-primary btn-sm" type="submit">Filtrer</button>
        <a class="btn btn-ghost btn-sm" href="/admin/commandes" data-link>Réinitialiser</a>
      </form>
    </div>

    ${data.orders.length ? `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Commande</th><th>Joueur</th><th>Pack</th><th>Montant</th><th>Paiement</th><th>Livraison</th><th>Date</th><th></th></tr></thead>
        <tbody>
          ${data.orders.map((o) => `
            <tr>
              <td class="mono small">${esc(o.number)}</td>
              <td>${esc(o.user?.name ?? '—')}<div class="tiny">${esc(o.user?.email ?? '')}</div></td>
              <td>${esc(o.packName ?? '—')}</td>
              <td><strong>${esc(o.amount)} €</strong>${o.discountCents ? `<div class="tiny">${esc(o.promoCode)} · −${esc(o.discount)} €</div>` : ''}${o.refundedCents ? `<div class="tiny">remb. ${esc(fmtEUR(o.refundedCents))}</div>` : ''}</td>
              <td>${badge(o.status)}</td>
              <td>${o.delivery ? badge(o.delivery.status) : '<span class="tiny">—</span>'}</td>
              <td class="tiny">${fmtDate(o.createdAt)}</td>
              <td class="actions"><button class="btn btn-ghost btn-sm" data-order="${esc(o.id)}">Détail</button></td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>
    <div class="row-between" style="margin-top:18px">
      <span class="tiny">Page ${data.page} / ${Math.max(data.pages, 1)}</span>
      <div class="row" style="gap:8px">
        ${data.page > 1 ? `<a class="btn btn-ghost btn-sm" href="/admin/commandes?${new URLSearchParams({ status, q: search, page: String(page - 1) })}" data-link>← Précédent</a>` : ''}
        ${data.page < data.pages ? `<a class="btn btn-ghost btn-sm" href="/admin/commandes?${new URLSearchParams({ status, q: search, page: String(page + 1) })}" data-link>Suivant →</a>` : ''}
      </div>
    </div>` : emptyState('receipt', 'Aucune commande', 'Modifiez vos filtres.')}`);

  return {
    title: 'Commandes — Admin', html,
    mount(root) {
      reveal(root);
      root.querySelector('#filterForm')?.addEventListener('submit', (event) => {
        event.preventDefault();
        const fd = new FormData(event.currentTarget);
        navigate(`/admin/commandes?${new URLSearchParams({ q: fd.get('q'), status: fd.get('status') })}`);
      });
      root.querySelectorAll('[data-order]').forEach((btn) => {
        btn.addEventListener('click', () => openOrderModal(btn.dataset.order));
      });
    },
  };
}

async function openOrderModal(orderId) {
  let detail;
  try { detail = await get(`/api/admin/orders/${orderId}`); }
  catch (error) { toastError(error.message); return; }
  const { order, events, grants, delivery } = detail;
  const isPaid = order.status === 'paid';
  const refundable = isPaid && order.refundedCents < order.amountCents;

  modal({
    title: `Commande ${order.number}`,
    body: `
      <div class="row wrap" style="gap:8px;margin-bottom:14px">
        ${badge(order.status)} <span class="badge">${esc(order.amount)} €</span>
        ${order.promoCode ? `<span class="badge">Promo ${esc(order.promoCode)} · −${esc(order.discount)} €</span>` : ''}
        <span class="badge">${esc(order.provider)}</span>
        <span class="badge">${esc(order.user?.displayName ?? '')}</span>
        <span class="badge">${esc(order.user?.email ?? '')}</span>
      </div>

      <div class="card-title">Livraison</div>
      ${delivery ? `<div class="step-track" style="margin-top:10px">
        ${delivery.steps.map((s) => `
          <div class="step-item ${esc(s.status)}">
            <span class="dot">${s.status === 'ok' ? '✓' : s.status === 'failed' ? '!' : s.status === 'skipped' ? '–' : '='}</span>
            <div class="grow"><strong>${esc(s.label ?? s.key)}</strong><div class="tiny">${esc(s.error ?? s.reason ?? '')}</div></div>
            ${badge(s.status)}
          </div>`).join('')}
      </div>
      <p class="tiny mono" style="margin-top:10px">tx : ${esc(delivery.tx_id)} · tentatives : ${delivery.attempts}</p>`
        : '<p class="tiny">Aucune livraison (commande non payée).</p>'}

      <div class="divider"></div>
      <div class="card-title">Récompenses accordées</div>
      ${grants.length ? `<div class="stack" style="gap:6px;margin-top:10px">
        ${grants.map((g) => `<div class="row-between tiny"><span>${esc(g.label || g.key)}</span>${badge(g.status)}</div>`).join('')}
      </div>` : '<p class="tiny">Aucune.</p>'}

      <div class="divider"></div>
      <div class="card-title">Événements de paiement</div>
      ${events.length ? `<div class="table-wrap" style="margin-top:10px"><table style="min-width:auto">
        <thead><tr><th>Type</th><th>Statut</th><th>Date</th></tr></thead>
        <tbody>${events.map((e) => `<tr><td class="tiny mono">${esc(e.type)}</td><td>${badge(e.status)}</td><td class="tiny">${fmtDate(e.receivedAt)}</td></tr>`).join('')}</tbody>
      </table></div>` : '<p class="tiny">Aucun événement.</p>'}
    `,
    actions: [
      { label: 'Fermer', className: 'btn-ghost' },
      ...(isPaid ? [{ label: 'Relancer la livraison', className: 'btn-ghost', keepOpen: true, onClick: async ({ close }) => {
        try {
          const res = await post(`/api/admin/orders/${order.id}/redeliver`, { force: true });
          toastSuccess(`Livraison : ${res.result.status}`);
          close();
        } catch (error) { toastError(error.message); }
        return false;
      } }] : []),
      ...(refundable ? [{ label: 'Rembourser', className: 'btn-danger', keepOpen: true, onClick: async ({ close }) => {
        const ok = await confirmDialog(`Rembourser ${order.amount} € ? Le rôle Discord et les récompenses seront retirés automatiquement.`, { danger: true, confirmLabel: 'Rembourser' });
        if (!ok) return false;
        try {
          await post(`/api/admin/orders/${order.id}/refund`, { reason: 'Remboursement demandé par l’administrateur' });
          toastSuccess('Remboursement effectué et récompenses révoquées.');
          close();
          navigate('/admin/commandes', { replace: true });
        } catch (error) { toastError(error.message); }
        return false;
      } }] : []),
    ],
  });
}

/* ------------------------------ Paiements ------------------------------ */

export async function adminPaymentsView() {
  const data = await get('/api/admin/payments');
  const html = shell('payments', `
    ${pageHeader('Paiements & remboursements', `Prestataire actif : <strong>${esc(data.status.activeLabel)}</strong>${data.status.demo ? ' <span class="badge badge-pending">mode démo</span>' : ''}`)}

    <div class="grid grid-3" style="margin-bottom:22px">
      <div class="stat-card"><div class="stat-label">Prestataire</div><div class="stat-value" style="font-size:1.4rem">${esc(data.status.active)}</div>
        <div class="stat-sub">${data.status.demo ? 'Webhooks simulés signés' : 'Webhooks vérifiés côté serveur'}</div></div>
      <div class="stat-card"><div class="stat-label">Événements reçus</div><div class="stat-value">${data.events.length}</div>
        <div class="stat-sub">journalisés et dédoublonnés</div></div>
      <div class="stat-card"><div class="stat-label">Remboursements</div><div class="stat-value">${data.refunds.length}</div>
        <div class="stat-sub">avec révocation automatique</div></div>
    </div>

    <div class="card reveal">
      <div class="card-title">Derniers événements de paiement</div>
      <div class="table-wrap" style="margin-top:16px;border:none">
        <table>
          <thead><tr><th>Événement</th><th>Prestataire</th><th>Commande</th><th>Statut</th><th>Message</th><th>Date</th></tr></thead>
          <tbody>
            ${data.events.length ? data.events.map((e) => `<tr>
              <td class="mono tiny">${esc(e.type)}</td><td>${esc(e.provider)}</td>
              <td class="tiny">${esc(e.orderNumber ?? '—')}</td><td>${badge(e.status)}</td>
              <td class="tiny">${esc(e.message ?? '')}</td><td class="tiny">${fmtDate(e.receivedAt)}</td></tr>`).join('')
              : '<tr><td colspan="6" class="tiny">Aucun événement.</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>

    <div class="card reveal" style="margin-top:22px">
      <div class="card-title">Remboursements</div>
      ${data.refunds.length ? `<div class="table-wrap" style="margin-top:16px;border:none"><table>
        <thead><tr><th>Commande</th><th>Montant</th><th>Motif</th><th>Joueur</th><th>Date</th></tr></thead>
        <tbody>${data.refunds.map((r) => `<tr>
          <td class="mono tiny">${esc(r.order_number)}</td>
          <td><strong>${(r.refunded_cents / 100).toFixed(2)} €</strong></td>
          <td class="tiny">${esc(r.refund_reason ?? '—')}</td>
          <td class="tiny">${esc(r.user?.email ?? '—')}</td>
          <td class="tiny">${fmtDate(r.updated_at)}</td></tr>`).join('')}</tbody>
      </table></div>` : '<p class="tiny" style="margin-top:12px">Aucun remboursement.</p>'}
    </div>`);

  return { title: 'Paiements — Admin', html, mount(root) { reveal(root); } };
}

/* ----------------------------- Utilisateurs ---------------------------- */

export async function adminUsersView({ query }) {
  const search = query.get('q') ?? '';
  const data = await get(`/api/admin/users?q=${encodeURIComponent(search)}`);

  const html = shell('users', `
    ${pageHeader('Utilisateurs', `${data.total} compte(s)`)}
    <div class="card" style="margin-bottom:20px">
      <form class="row" id="userSearch" style="gap:12px">
        <input class="input" name="q" placeholder="E-mail, pseudo, Discord, identifiant de jeu…" value="${esc(search)}" style="max-width:360px" />
        <button class="btn btn-primary btn-sm" type="submit">Rechercher</button>
      </form>
    </div>

    ${data.users.length ? `<div class="table-wrap"><table>
      <thead><tr><th>Joueur</th><th>Discord</th><th>Jeu</th><th>Packs</th><th>Commandes</th><th>Revenu</th><th>Statut</th><th></th></tr></thead>
      <tbody>${data.users.map((u) => `<tr>
        <td><strong>${esc(u.displayName)}</strong><div class="tiny">${esc(u.email)}</div></td>
        <td class="tiny">${u.discord?.linked ? esc(u.discord.username ?? u.discord.id) : '—'}</td>
        <td class="tiny">${esc(u.gamePlayerId ?? '—')}</td>
        <td>${u.activePacks}</td>
        <td>${u.paidOrders}</td>
        <td><strong>${esc(u.revenue)} €</strong></td>
        <td>${badge(u.status)}</td>
        <td class="actions"><button class="btn btn-ghost btn-sm" data-user="${esc(u.id)}">Gérer</button></td>
      </tr>`).join('')}</tbody>
    </table></div>` : emptyState('users', 'Aucun utilisateur')}`);

  return {
    title: 'Utilisateurs — Admin', html,
    mount(root) {
      reveal(root);
      root.querySelector('#userSearch')?.addEventListener('submit', (event) => {
        event.preventDefault();
        navigate(`/admin/utilisateurs?q=${encodeURIComponent(new FormData(event.currentTarget).get('q'))}`);
      });
      root.querySelectorAll('[data-user]').forEach((btn) => {
        btn.addEventListener('click', () => openUserModal(btn.dataset.user));
      });
    },
  };
}

async function openUserModal(userId) {
  let detail;
  try { detail = await get(`/api/admin/users/${userId}`); }
  catch (error) { toastError(error.message); return; }
  const { user, orders, grants, packs, sessions } = detail;

  const instance = modal({
    title: `Joueur — ${user.displayName}`,
    body: `
      <div class="row wrap" style="gap:8px;margin-bottom:14px">
        ${badge(user.role === 'admin' ? 'active' : 'open', user.role === 'admin' ? 'Administrateur' : 'Joueur')}
        ${badge(user.status)}
        <span class="badge">${esc(user.email)}</span>
        ${user.discord?.linked ? `<span class="badge badge-paid">Discord lié</span>` : '<span class="badge badge-pending">Discord non lié</span>'}
      </div>

      <div class="form-grid">
        <div class="field"><label class="label">Pseudo</label><input class="input" id="uName" value="${esc(user.displayName)}" /></div>
        <div class="field"><label class="label">Identifiant de jeu</label><input class="input" id="uGame" value="${esc(user.gamePlayerId ?? '')}" placeholder="—" /></div>
      </div>
      <div class="form-grid">
        <div class="field"><label class="label">Rôle</label>
          <select class="select" id="uRole">
            <option value="user" ${user.role === 'user' ? 'selected' : ''}>Joueur</option>
            <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>Administrateur</option>
          </select></div>
        <div class="field"><label class="label">Statut</label>
          <select class="select" id="uStatus">
            <option value="active" ${user.status === 'active' ? 'selected' : ''}>Actif</option>
            <option value="banned" ${user.status === 'banned' ? 'selected' : ''}>Banni</option>
          </select></div>
      </div>

      <div class="divider"></div>
      <div class="card-title">Packs actifs</div>
      <div class="stack" style="gap:6px;margin-top:8px">
        ${packs.length ? packs.map((p) => `<div class="row-between tiny"><span>${esc(p.emoji)} ${esc(p.name)}</span>${badge(p.active ? 'active' : 'revoked', p.active ? 'Actif' : 'Révoqué')}</div>`).join('') : '<span class="tiny">Aucun pack.</span>'}
      </div>

      <div class="divider"></div>
      <div class="card-title">Commandes (${orders.length})</div>
      <div class="stack" style="gap:6px;margin-top:8px">
        ${orders.length ? orders.slice(0, 6).map((o) => `<div class="row-between tiny"><span class="mono">${esc(o.number)}</span><span>${esc(o.amount)} € ${badge(o.status)}</span></div>`).join('') : '<span class="tiny">Aucune commande.</span>'}
      </div>

      <div class="divider"></div>
      <div class="card-title">Récompenses (${grants.length})</div>
      <div class="stack" style="gap:6px;margin-top:8px">
        ${grants.length ? grants.slice(0, 8).map((g) => `<div class="row-between tiny"><span>${esc(g.label || g.key)}</span>${badge(g.status)}</div>`).join('') : '<span class="tiny">Aucune.</span>'}
      </div>

      <div class="divider"></div>
      <div class="card-title">Sessions actives</div>
      <div class="stack" style="gap:6px;margin-top:8px">
        ${sessions.map((s) => `<div class="row-between tiny"><span class="mono">${esc(s.id)}</span><span>${esc(s.ip ?? '')} · ${fmtRelative(s.lastSeenAt)}</span></div>`).join('') || '<span class="tiny">—</span>'}
      </div>`,
    actions: [
      { label: 'Fermer', className: 'btn-ghost' },
      { label: 'Enregistrer', className: 'btn-primary', keepOpen: true, onClick: async ({ close }) => {
        try {
          await put(`/api/admin/users/${user.id}`, {
            displayName: instance.root.querySelector('#uName').value,
            gamePlayerId: instance.root.querySelector('#uGame').value,
            role: instance.root.querySelector('#uRole').value,
            status: instance.root.querySelector('#uStatus').value,
          });
          toastSuccess('Utilisateur mis à jour.');
          close();
          navigate('/admin/utilisateurs', { replace: true });
        } catch (error) { toastError(error.message); }
        return false;
      } },
    ],
  });
}

/* ------------------------------ Livraisons ----------------------------- */

export async function adminDeliveriesView({ query }) {
  const status = query.get('status') ?? '';
  const data = await get(`/api/admin/deliveries?status=${encodeURIComponent(status)}`);

  const html = shell('deliveries', `
    ${pageHeader('Livraisons', `${data.deliveries.length} livraison(s) · ${data.errors} en erreur`,
      `<a class="btn btn-ghost btn-sm" href="/admin/erreurs" data-link>Voir les erreurs</a>`)}
    <div class="row wrap" style="gap:8px;margin-bottom:18px">
      ${['', 'delivered', 'partial', 'failed', 'delivering', 'reverted', 'errors'].map((s) => `
        <a class="btn btn-sm ${s === status ? 'btn-primary' : 'btn-ghost'}" href="/admin/livraisons?status=${s}" data-link>${s ? s : 'Toutes'}</a>`).join('')}
    </div>

    ${data.deliveries.length ? `<div class="table-wrap"><table>
      <thead><tr><th>Commande</th><th>Joueur</th><th>Transaction</th><th>Statut</th><th>Tentatives</th><th>Dernière erreur</th><th>Maj</th><th></th></tr></thead>
      <tbody>${data.deliveries.map((d) => `<tr>
        <td class="mono tiny">${esc(d.orderNumber)}</td>
        <td class="tiny">${esc(d.user?.name ?? '—')}<div class="tiny">${esc(d.user?.email ?? '')}</div></td>
        <td class="mono tiny">${esc(d.tx_id)}</td>
        <td>${badge(d.status)}</td>
        <td>${d.attempts}</td>
        <td class="tiny" style="max-width:260px">${esc(d.last_error ?? '—')}</td>
        <td class="tiny">${fmtRelative(d.updated_at)}</td>
        <td class="actions"><button class="btn btn-ghost btn-sm" data-retry="${esc(d.order_id)}">Relancer</button></td>
      </tr>`).join('')}</tbody>
    </table></div>` : emptyState('package', 'Aucune livraison')}`);

  return {
    title: 'Livraisons — Admin', html,
    mount(root) {
      reveal(root);
      root.querySelectorAll('[data-retry]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const restore = loadingButton(btn, 'Relance…');
          try {
            const res = await post(`/api/admin/deliveries/${btn.dataset.retry}/retry`, { force: true });
            toastSuccess(`Livraison : ${res.result.status}`);
            navigate('/admin/livraisons', { replace: true });
          } catch (error) { restore(); toastError(error.message); }
        });
      });
    },
  };
}

/* -------------------------------- Erreurs ------------------------------- */

export async function adminErrorsView() {
  const data = await get('/api/admin/errors');
  const html = shell('errors', `
    ${pageHeader('Erreurs de livraison & paiement', 'Les éléments à corriger, au même endroit')}

    <div class="card reveal">
      <div class="card-title">Livraisons en échec (${data.deliveries.length})</div>
      ${data.deliveries.length ? `<div class="table-wrap" style="margin-top:16px;border:none"><table>
        <thead><tr><th>Commande</th><th>Statut</th><th>Étapes</th><th>Erreur</th><th></th></tr></thead>
        <tbody>${data.deliveries.map((d) => `<tr>
          <td class="mono tiny">${esc(d.order_id)}</td><td>${badge(d.status)}</td>
          <td class="tiny">${d.steps.map((s) => `${esc(s.key)}:${esc(s.status)}`).join(' · ')}</td>
          <td class="tiny">${esc(d.last_error ?? '—')}</td>
          <td class="actions"><button class="btn btn-ghost btn-sm" data-retry="${esc(d.order_id)}">Relancer</button></td></tr>`).join('')}</tbody>
      </table></div>` : '<p class="tiny" style="margin-top:12px">Aucune erreur de livraison. 🎉</p>'}
    </div>

    <div class="card reveal" style="margin-top:22px">
      <div class="card-title">Paiements échoués (${data.failedOrders.length})</div>
      ${data.failedOrders.length ? `<div class="table-wrap" style="margin-top:16px;border:none"><table>
        <thead><tr><th>Commande</th><th>Montant</th><th>Motif</th><th>Date</th></tr></thead>
        <tbody>${data.failedOrders.map((o) => `<tr>
          <td class="mono tiny">${esc(o.number)}</td><td>${esc(o.amount)} €</td>
          <td class="tiny">${esc(o.failureReason ?? '—')}</td><td class="tiny">${fmtDate(o.createdAt)}</td></tr>`).join('')}</tbody>
      </table></div>` : '<p class="tiny" style="margin-top:12px">Aucun paiement échoué.</p>'}
    </div>

    <div class="card reveal" style="margin-top:22px">
      <div class="card-title">Événements webhook en erreur (${data.paymentErrors.length})</div>
      ${data.paymentErrors.length ? `<div class="table-wrap" style="margin-top:16px;border:none"><table>
        <thead><tr><th>Type</th><th>Prestataire</th><th>Message</th><th>Date</th></tr></thead>
        <tbody>${data.paymentErrors.map((e) => `<tr>
          <td class="mono tiny">${esc(e.type)}</td><td>${esc(e.provider)}</td>
          <td class="tiny">${esc(e.message ?? '—')}</td><td class="tiny">${fmtDate(e.receivedAt)}</td></tr>`).join('')}</tbody>
      </table></div>` : '<p class="tiny" style="margin-top:12px">Aucune erreur webhook.</p>'}
    </div>`);

  return {
    title: 'Erreurs — Admin', html,
    mount(root) {
      reveal(root);
      root.querySelectorAll('[data-retry]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const restore = loadingButton(btn, 'Relance…');
          try {
            await post(`/api/admin/deliveries/${btn.dataset.retry}/retry`, { force: true });
            toastSuccess('Livraison relancée.');
            navigate('/admin/erreurs', { replace: true });
          } catch (error) { restore(); toastError(error.message); }
        });
      });
    },
  };
}

/* ------------------------------ API du jeu ----------------------------- */

export async function adminGameView() {
  const sys = await get('/api/admin/system');
  const example = `curl -X POST "$GAME_API_URL/v1/rewards/grant" \\
  -H "X-Kalea-Timestamp: 1712345678901" \\
  -H "X-Kalea-Signature: <hmac-sha256>" \\
  -H "X-Kalea-Tx: tx_ord_9f3k2…" \\
  -d '{"player":{"id":"joueur-42"},"rewards":{...}}'`;

  const html = shell('game', `
    ${pageHeader('API du jeu', 'Livraison sécurisée des récompenses vers votre serveur')}

    <div class="grid grid-3" style="margin-bottom:22px">
      <div class="stat-card"><div class="stat-label">URL de l’API</div>
        <div class="stat-value" style="font-size:1.1rem">${esc(sys.game.url || 'Non configurée')}</div>
        <div class="stat-sub">GAME_API_URL</div></div>
      <div class="stat-card"><div class="stat-label">Signature sortante</div>
        <div class="stat-value" style="font-size:1.1rem">${sys.game.configured ? 'HMAC-SHA256' : 'Non active'}</div>
        <div class="stat-sub">GAME_API_SECRET</div></div>
      <div class="stat-card"><div class="stat-label">Livraison bloquante</div>
        <div class="stat-value" style="font-size:1.1rem">${sys.game.required ? 'Oui' : 'Non'}</div>
        <div class="stat-sub">GAME_API_REQUIRED</div></div>
    </div>

    <div class="card reveal">
      <div class="card-title">Comment le jeu reçoit les récompenses</div>
      <p class="muted small" style="margin-top:10px">
        Après chaque paiement confirmé, KaleaShop envoie une requête signée à votre serveur de jeu
        avec l’identifiant unique de transaction. Le serveur doit rejeter toute transaction déjà traitée.
      </p>
      <code class="code" style="margin-top:14px">${esc(example)}</code>
      <div class="divider"></div>
      <div class="card-title">Endpoints exposés au jeu</div>
      <div class="stack" style="gap:8px;margin-top:12px">
        <div class="row-between tiny"><span class="mono">GET /api/game/v1/entitlements/:playerId</span><span class="badge badge-paid">Droits du joueur</span></div>
        <div class="row-between tiny"><span class="mono">GET /api/game/v1/ping</span><span class="badge badge-paid">Test de signature</span></div>
        <div class="row-between tiny"><span class="mono">POST /v1/rewards/grant</span><span class="badge">Sortant — vers le jeu</span></div>
        <div class="row-between tiny"><span class="mono">POST /v1/rewards/revoke</span><span class="badge">Sortant — remboursement</span></div>
      </div>
    </div>

    <div class="card reveal" style="margin-top:22px">
      <div class="card-title">État du système</div>
      <div class="stack" style="gap:8px;margin-top:14px">
        <div class="row-between tiny"><span>Node.js</span><span class="mono">${esc(sys.node)}</span></div>
        <div class="row-between tiny"><span>Environnement</span><span class="mono">${esc(sys.environment)}</span></div>
        <div class="row-between tiny"><span>Uptime</span><span class="mono">${Math.floor(sys.uptimeSec / 60)} min</span></div>
        <div class="row-between tiny"><span>Mémoire</span><span class="mono">${sys.memoryMb} Mo</span></div>
        <div class="row-between tiny"><span>Rate limiting</span><span>${sys.rateLimit ? badge('active', 'Actif') : badge('expired', 'Inactif')}</span></div>
        <div class="row-between tiny"><span>Retrait du rôle au remboursement</span><span>${sys.refundRoleRemoval ? badge('active', 'Activé') : badge('expired', 'Désactivé')}</span></div>
      </div>
    </div>`);

  return { title: 'API du jeu — Admin', html, mount(root) { reveal(root); } };
}

/* --------------------------------- Logs -------------------------------- */

export async function adminLogsView({ query }) {
  const action = query.get('action') ?? '';
  const data = await get(`/api/admin/logs?action=${encodeURIComponent(action)}&limit=200`);

  const html = shell('logs', `
    ${pageHeader('Logs & audit', 'Journal complet des transactions et actions administratives')}
    <div class="card" style="margin-bottom:18px">
      <form class="row" id="logFilter" style="gap:12px">
        <input class="input" name="action" placeholder="payment, delivery, pack, user…" value="${esc(action)}" style="max-width:320px" />
        <button class="btn btn-primary btn-sm" type="submit">Filtrer</button>
        <a class="btn btn-ghost btn-sm" href="/admin/logs" data-link>Réinitialiser</a>
      </form>
    </div>
    ${data.logs.length ? `<div class="table-wrap"><table>
      <thead><tr><th>Date</th><th>Action</th><th>Cible</th><th>Acteur</th><th>IP</th><th>Détails</th></tr></thead>
      <tbody>${data.logs.map((l) => `<tr>
        <td class="tiny">${fmtDate(l.at)}</td>
        <td class="mono tiny">${esc(l.action)}</td>
        <td class="tiny">${esc(l.target ?? '—')}</td>
        <td class="tiny">${esc(l.actor_email ?? 'système')}</td>
        <td class="tiny mono">${esc(l.ip ?? '—')}</td>
        <td class="tiny" style="max-width:280px">${esc(typeof l.meta === 'string' ? l.meta.slice(0, 160) : JSON.stringify(l.meta).slice(0, 160))}</td>
      </tr>`).join('')}</tbody>
    </table></div>` : emptyState('scroll', 'Aucun log', 'Effectuez une action pour générer des journaux.')}`);

  return {
    title: 'Logs — Admin', html,
    mount(root) {
      reveal(root);
      root.querySelector('#logFilter')?.addEventListener('submit', (event) => {
        event.preventDefault();
        navigate(`/admin/logs?action=${encodeURIComponent(new FormData(event.currentTarget).get('action'))}`);
      });
    },
  };
}

/* -------------------------------- Support ------------------------------- */

export async function adminTicketsView() {
  const { tickets } = await get('/api/admin/tickets');
  const html = shell('tickets', `
    ${pageHeader('Tickets de support', `${tickets.length} demande(s)`)}
    ${tickets.length ? `<div class="table-wrap"><table>
      <thead><tr><th>Référence</th><th>Joueur</th><th>Sujet</th><th>Catégorie</th><th>Statut</th><th>Date</th><th></th></tr></thead>
      <tbody>${tickets.map((t) => `<tr>
        <td class="mono tiny">${esc(t.ref)}</td>
        <td class="tiny">${esc(t.name)}<div class="tiny">${esc(t.email)}</div></td>
        <td>${esc(t.subject)}<div class="tiny" style="max-width:420px">${esc(t.message.slice(0, 160))}${t.message.length > 100 ? '…' : ''}</div></td>
        <td class="tiny">${esc(t.category)}</td>
        <td>${badge(t.status)}</td>
        <td class="tiny">${fmtDate(t.created_at)}</td>
        <td class="actions">
          <button class="btn btn-ghost btn-sm" data-ticket="${esc(t.id)}" data-status="pending">En attente</button>
          <button class="btn btn-ghost btn-sm" data-ticket="${esc(t.id)}" data-status="closed">Clore</button>
        </td></tr>`).join('')}</tbody>
    </table></div>` : emptyState('message', 'Aucun ticket')}`);

  return {
    title: 'Support — Admin', html,
    mount(root) {
      reveal(root);
      root.querySelectorAll('[data-ticket]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          try {
            await put(`/api/admin/tickets/${btn.dataset.ticket}`, { status: btn.dataset.status });
            toastSuccess('Ticket mis à jour.');
            navigate('/admin/tickets', { replace: true });
          } catch (error) { toastError(error.message); }
        });
      });
    },
  };
}

/* ------------------------------ Paramètres ----------------------------- */

export async function adminSettingsView() {
  const data = await get('/api/admin/settings');
  const s = data.settings;
  const env = data.env;

  // Apparence : valeur stockée = préréglage ou URL d'image.
  const rawBg = String(s.site_background ?? 'nebuleuse');
  const bgIsImage = /^(https?:\/\/|\/|data:image\/)/i.test(rawBg.trim());

  const html = shell('settings', `
    ${pageHeader('Paramètres', 'Configuration du site et de l’intégration')}

    <div class="grid grid-2" style="align-items:start">
      <div class="card reveal">
        <div class="card-title">Identité du site</div>
        <form id="settingsForm" class="stack" style="margin-top:16px">
          <div class="field"><label class="label">Nom du site</label>
            <input class="input" name="site_name" value="${esc(s.site_name ?? 'KaleaShop')}" /></div>
          <div class="field"><label class="label">Accroche</label>
            <input class="input" name="tagline" value="${esc(s.tagline ?? '')}" /></div>
          <div class="form-grid">
            <div class="field"><label class="label">E-mail de support</label>
              <input class="input" name="support_email" value="${esc(s.support_email ?? '')}" /></div>
            <div class="field"><label class="label">Lien Discord</label>
              <input class="input" name="discord_invite" value="${esc(s.discord_invite ?? '')}" /></div>
          </div>
          <div class="field"><label class="label">Note de paiement</label>
            <input class="input" name="checkout_note" value="${esc(s.checkout_note ?? '')}" /></div>
          <div class="field"><label class="label">Mention légale</label>
            <input class="input" name="legal_company" value="${esc(s.legal_company ?? '')}" /></div>

          <div class="field"><label class="label">Fond du site</label>
            <select class="input" name="bg_preset" id="bgPreset">
              <option value="nebuleuse">Nébuleuse violette (par défaut)</option>
              <option value="aurore">Aurore cyan &amp; vert</option>
              <option value="embras">Embras orange &amp; corail</option>
              <option value="mono">Monochrome discret</option>
              <option value="image">Image personnalisée</option>
            </select></div>
          <div class="field" id="bgImageField" hidden>
            <label class="label">URL de l’image de fond</label>
            <input class="input" name="bg_image" id="bgImage" placeholder="https://…/fond.jpg" value="${esc(bgIsImage ? rawBg : '')}" />
            <span class="tiny muted">Plein écran, recadré et voilé automatiquement pour garder le texte lisible.</span>
          </div>
          <div class="bg-preview" id="bgPreview" data-mode="${esc(bgIsImage ? 'image' : rawBg)}" aria-hidden="true"></div>

          <button class="btn btn-primary btn-sm" type="submit">Enregistrer</button>
        </form>
      </div>

      <div class="stack">
        <div class="card reveal">
          <div class="card-title">Intégrations</div>
          <div class="stack" style="gap:10px;margin-top:14px">
            <div class="row-between tiny"><span>Prestataire de paiement</span><span class="badge badge-paid">${esc(env.provider)}</span></div>
            <div class="row-between tiny"><span>PayPal configuré</span>${env.paypal ? badge('active', 'Oui') : badge('expired', 'Non')}</div>
            <div class="row-between tiny"><span>Stripe configuré</span>${env.stripe ? badge('active', 'Oui') : badge('expired', 'Non')}</div>
            <div class="row-between tiny"><span>Webhook sécurisé</span>${env.webhook ? badge('active', 'Oui') : badge('expired', 'Non')}</div>
            <div class="row-between tiny"><span>Discord OAuth2</span>${env.discordOAuth ? badge('active', 'Oui') : badge('expired', 'Non')}</div>
            <div class="row-between tiny"><span>Bot Discord</span>${env.discordBot ? badge('active', 'Oui') : badge('expired', 'Non')}</div>
            <div class="row-between tiny"><span>API du jeu</span>${env.gameApi ? badge('active', 'Oui') : badge('expired', 'Non')}</div>
            <div class="row-between tiny"><span>Retrait du rôle au remboursement</span>${env.removeRoleOnRefund ? badge('active', 'Activé') : badge('expired', 'Désactivé')}</div>
          </div>
        </div>

        <div class="notice notice-info reveal">
          <span>🔐</span>
          <div class="small">
            Les secrets (clés prestataire, Discord, API jeu) se configurent dans le fichier
            <span class="kbd">.env</span> côté serveur — jamais dans le navigateur.
          </div>
        </div>

        <div class="card reveal">
          <div class="card-title">Raccourcis</div>
          <div class="row wrap" style="gap:10px;margin-top:14px">
            <a class="btn btn-ghost btn-sm" href="/admin/packs" data-link>Packs</a>
            <a class="btn btn-ghost btn-sm" href="/admin/commandes" data-link>Commandes</a>
            <a class="btn btn-ghost btn-sm" href="/admin/logs" data-link>Logs</a>
            <a class="btn btn-ghost btn-sm" href="/boutique" data-link>Voir la boutique</a>
          </div>
        </div>
      </div>
    </div>`);

  return {
    title: 'Paramètres — Admin', html,
    mount(root) {
      reveal(root);

      /* --- Aperçu du fond (préréglage ou image) --- */
      const preset = root.querySelector('#bgPreset');
      const imageField = root.querySelector('#bgImageField');
      const imageInput = root.querySelector('#bgImage');
      const preview = root.querySelector('#bgPreview');
      const syncBackground = () => {
        const isImage = preset?.value === 'image';
        if (imageField) imageField.hidden = !isImage;
        const url = isImage ? String(imageInput?.value ?? '').trim() : '';
        if (preview) {
          preview.dataset.mode = url ? 'image' : (preset?.value ?? 'nebuleuse');
          preview.style.backgroundImage = url ? `url("${url.replace(/["\\)]/g, '')}")` : '';
        }
      };
      preset?.addEventListener('change', syncBackground);
      imageInput?.addEventListener('input', syncBackground);
      syncBackground();

      root.querySelector('#settingsForm')?.addEventListener('submit', async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const data2 = Object.fromEntries(new FormData(form).entries());
        // Les champs d'apparence ne servent qu'à calculer la valeur finale.
        const chosen = String(data2.bg_preset ?? 'nebuleuse');
        const url = String(data2.bg_image ?? '').trim();
        delete data2.bg_preset;
        delete data2.bg_image;
        data2.site_background = chosen === 'image' ? (url || 'nebuleuse') : chosen;
        try {
          await put('/api/admin/settings', data2);
          applyTheme(data2.site_background); // application immédiate, sans rechargement
          toastSuccess('Paramètres enregistrés.');
          navigate('/admin/parametres', { replace: true });
        } catch (error) { toastError(error.message); }
      });
    },
  };
}

/* ------------------------ Porte d'accès administrateur --------------------
 * Toute route /admin* passe par ce garde : tant que le visiteur n'est pas
 * connecté avec un compte administrateur, il ne voit que cet écran.
 * ------------------------------------------------------------------------ */

export function adminGateView(ctx) {
  const user = ctx?.state?.user ?? state.user;
  const denied = Boolean(user && user.role !== 'admin'); // connecté, mais sans droits admin

  const html = `
    <section class="section gate-section">
      <div class="container" style="max-width:560px">
        <div class="admin-gate">
          <div class="gate-ribbon">🔒 Zone protégée</div>
          <div class="gate-logo"><img src="/assets/img/logo.png" alt="" width="76" height="76" /></div>
          <div class="eyebrow" style="justify-content:center">Accès restreint</div>
          <h1 class="h2">Administration <span class="grad-text">KaleaShop</span></h1>
          <p class="muted small center" style="margin-top:10px;max-width:44ch">
            ${denied
              ? 'Cette zone est réservée aux comptes administrateurs. Entrez le mot de passe pour la déverrouiller.'
              : 'Espace de pilotage de la boutique : packs, commandes, paiements, livraisons et journal d’audit.'}
          </p>

          ${denied ? `
            <div class="notice notice-warn" style="margin-top:22px">
              <span>⚠️</span>
              <div class="small">
                Connecté en tant que <strong>${esc(user.displayName ?? user.email)}</strong>
                (rôle <strong>${esc(user.role ?? 'client')}</strong>).
              </div>
            </div>` : ''}

          <form id="gateForm" class="stack" style="margin-top:26px" novalidate>
            <div class="field">
              <label class="label" for="gatePassword">Mot de passe administrateur</label>
              <input class="input" id="gatePassword" name="password" type="password"
                     placeholder="••••••••••••" autocomplete="current-password"
                     autofocus required />
            </div>
            <div class="form-error" id="gateError"></div>
            <button class="btn btn-primary btn-block" type="submit" id="gateSubmit">
              🔓 Déverrouiller le dashboard
            </button>
          </form>

          <p class="tiny center" style="margin-top:14px">
            Connexion chiffrée · tentative journalisée · sessions expirantes.
          </p>

          <div class="gate-sep"><span></span><em>ou</em><span></span></div>
          <div class="stack">
            <a class="btn btn-ghost btn-block" href="/" data-link>Retour à la boutique</a>
            <a class="btn btn-ghost btn-block" href="/mon-compte" data-link>Retour à mon compte</a>
          </div>
        </div>
      </div>
    </section>`;

  return {
    title: 'Administration',
    html,
    mount(root) {
      reveal(root);

      const form = root.querySelector('#gateForm');
      form?.addEventListener('submit', async (event) => {
        event.preventDefault();
        const errorEl = root.querySelector('#gateError');
        errorEl.textContent = '';
        const data = Object.fromEntries(new FormData(form).entries());
        const restore = loadingButton(root.querySelector('#gateSubmit'), 'Vérification…');
        try {
          const res = await post('/api/auth/admin-unlock', data);
          setUser(res.user);
          toastSuccess('Bienvenue dans le dashboard, administrateur.', 'Zone déverrouillée');
          navigate('/admin', { replace: true });
        } catch (error) {
          restore();
          errorEl.textContent = error.message;
          toastError(error.message);
        }
      });
    },
  };
}
