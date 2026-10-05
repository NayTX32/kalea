/** KALEA — routes publiques : configuration, catalogue, FAQ. */
import { config } from '../config.js';
import { all, get, parseJson } from '../db.js';
import { rateLimit } from '../lib/ratelimit.js';
import { notFound } from '../lib/errors.js';
import { listPacks, getPack, serializePack } from '../services/packs.js';
import { paymentsStatus } from '../services/payments/index.js';
import { discordStatus } from '../services/discord.js';
import { gameStatus } from '../services/gameapi.js';

export const FAQ = [
  {
    q: 'Comment recevoir mon pack après l’achat ?',
    a: 'Dès que le paiement est confirmé par le prestataire (webhook serveur), KALEA attribue automatiquement le rôle Discord associé et envoie les récompenses au serveur du jeu. Rien à faire de votre côté : consultez « Mon compte » pour suivre la livraison.',
  },
  {
    q: 'Mes informations bancaires sont-elles stockées par KALEA ?',
    a: 'Non. Le paiement est intégralement traité par le prestataire (page hébergée). KALEA ne reçoit ni numéro de carte, ni cryptogramme, ni code CVC — uniquement le statut de la transaction.',
  },
  {
    q: 'Quels moyens de paiement sont acceptés ?',
    a: 'Visa, Mastercard, American Express, carte bancaire française (CB), Apple Pay, Google Pay, PayPal, prélèvement SEPA et virement bancaire lorsque disponibles, ainsi que les moyens locaux proposés par le prestataire selon votre pays.',
  },
  {
    q: 'Je n’ai pas reçu mon rôle Discord.',
    a: 'Vérifiez d’abord que votre compte Discord est bien connecté depuis « Mon compte », puis que vous êtes membre du serveur officiel. Sinon, cliquez sur « Relancer la livraison » : les récompenses déjà attribuées ne sont jamais dupliquées.',
  },
  {
    q: 'Puis-je acheter un pack déjà possédé ?',
    a: 'Oui, mais le système vérifie chaque récompense avant attribution : une transaction ne peut délivrer le même contenu qu’une seule fois.',
  },
  {
    q: 'Comment se passe un remboursement ?',
    a: 'Un remboursement complet déclenche automatiquement le retrait du rôle Discord et des récompenses dans le jeu si l’option est activée, puis marque le pack comme inactif sur votre compte.',
  },
  {
    q: 'Où trouver mon identifiant de jeu ?',
    a: 'Dans le jeu, ouvrez le menu Profil : votre identifiant KALEA y est affiché. Renseignez-le dans « Mon compte » pour que les récompenses soient livrées au bon joueur.',
  },
  {
    q: 'Un paiement a échoué, que faire ?',
    a: 'La commande est marquée « Échouée » et aucun montant n’est encaissé. Vous pouvez relancer un paiement depuis votre historique de commandes ou contacter le support.',
  },
];

export function publicRoutes(router) {
  /* Configuration publique consommée par le frontend. */
  router.get('/api/config', (ctx) => {
    const settings = Object.fromEntries(
      all('SELECT key, value FROM settings').map((r) => [r.key, parseJson(r.value, r.value)]),
    );
    return ctx.json({
      siteName: 'KALEA',
      tagline: settings.tagline ?? 'La boutique officielle du jeu',
      supportEmail: settings.support_email ?? 'support@kalea.gg',
      discordInvite: settings.discord_invite ?? null,
      checkoutNote: settings.checkout_note ?? '',
      legalCompany: settings.legal_company ?? 'KALEA',
      payments: paymentsStatus(),
      discord: { ...discordStatus(), invite: settings.discord_invite ?? null },
      game: gameStatus(),
      registrationOpen: true,
      locale: 'fr-FR',
      currency: 'EUR',
      // Apparence : préréglage de fond ou URL d'image (choisi dans /admin).
      theme: { background: settings.site_background ?? 'nebuleuse' },
    });
  });

  router.get('/api/health', (ctx) => ctx.json({
    ok: true,
    service: 'kalea',
    time: new Date().toISOString(),
    provider: config.payments.provider,
  }));

  /* Catalogue public. */
  router.get('/api/packs', (ctx) => ctx.json({ packs: listPacks() }));

  router.get('/api/packs/:idOrSlug', (ctx) => {
    const row = getPack(ctx.params.idOrSlug, { includeInactive: ctx.userRow?.role === 'admin' });
    return ctx.json({ pack: serializePack(row, { publicView: ctx.userRow?.role !== 'admin' }) });
  });

  /* FAQ (statique, française). */
  router.get('/api/faq', (ctx) => ctx.json({ items: FAQ }));

  /* Statut d'une commande pour la page publique de suivi. */
  router.get('/api/orders/:id/public-status', (ctx) => {
    const order = get('SELECT status, order_number, amount_cents, paid_at FROM orders WHERE id = ?', ctx.params.id);
    if (!order) throw notFound('Commande introuvable.');
    return ctx.json({
      status: order.status,
      number: order.order_number,
      amount: (order.amount_cents / 100).toFixed(2).replace('.', ','),
      paidAt: order.paid_at,
    });
  });

  router.get('/api/meta/payments', rateLimit('api', 60), (ctx) => ctx.json(paymentsStatus()));
}
