/**
 * KALEA — prestataire de démonstration (mode "demo").
 *
 * Simule une passerelle de paiement complète : hébergement de paiement,
 * échec, annulation, et surtout **webhook signé** traité par exactement le
 * même code que Stripe. Permet de tester le tunnel entier sans clé réelle.
 *
 * Aucune donnée bancaire n'est manipulée : il n'y a simplement pas de carte.
 */
import { config } from '../../config.js';
import { newId } from '../../db.js';
import { signPayload, verifySignedPayload } from '../../lib/crypto.js';
import { badRequest } from '../../lib/errors.js';

export const demoProvider = {
  name: 'demo',
  label: 'Paiement de démonstration',
  ready: true,
  methods: ['Carte de démonstration', 'Simuler un échec', 'Simuler une annulation'],
  isDemo: true,

  /** Crée une "session" de paiement et renvoie l'URL de la page de paiement locale. */
  async createCheckout({ order, successUrl, cancelUrl }) {
    const sessionId = `cs_demo_${order.id}`;
    return {
      sessionId,
      url: `/paiement-demo/${order.id}?session=${encodeURIComponent(sessionId)}&return=${encodeURIComponent(successUrl)}&cancel=${encodeURIComponent(cancelUrl)}`,
      expiresAt: Date.now() + 30 * 60_000,
    };
  },

  /** Vérification serveur (le démo garde la trace en base via orders.checkout_session_id). */
  async verifySession(sessionId) {
    if (!String(sessionId).startsWith('cs_demo_')) throw badRequest('Session de paiement invalide.');
    return { status: 'recherche', amountTotalCents: null, paymentIntentId: null };
  },

  async refund() {
    return { ok: true, refundId: `rf_demo_${newId('r')}`, status: 'succeeded' };
  },

  /** Vérifie la signature du webhook simulé (HMAC identique à Stripe). */
  verifyWebhook(rawBody, header) {
    return verifySignedPayload(config.payments.demoSecret, rawBody, header);
  },

  /** Construit et "reçoit" un événement de paiement signé (appelé par la route de démo). */
  buildEvent({ type, order, amountCents, paymentIntentId, reason = null }) {
    const event = {
      id: `evt_demo_${newId('evt')}`,
      object: 'event',
      type,
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: paymentIntentId ?? `pi_demo_${order.id}`,
          object: 'payment_intent',
          amount: amountCents,
          currency: (order.currency ?? 'EUR').toLowerCase(),
          status: type === 'payment_intent.payment_failed' ? 'requires_payment_method' : 'succeeded',
          metadata: { order_id: order.id, user_id: order.user_id, kalea_order: order.order_number },
          last_payment_error: reason ? { message: reason } : null,
          refunds: type === 'charge.refunded' ? { data: [{ id: `rf_demo_${order.id}`, amount: amountCents }] } : { data: [] },
        },
      },
    };
    const raw = JSON.stringify(event);
    return { event, raw, signature: signPayload(config.payments.demoSecret, raw) };
  },

  parseEvent(rawBody) {
    return JSON.parse(rawBody);
  },
};
