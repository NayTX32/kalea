/**
 * KALEA — prestataire professionnel : Stripe Checkout (hébergé).
 *
 * • Aucune donnée bancaire ne transite par Kalea (page Stripe hébergée).
 * • Moyens de paiement : Visa, Mastercard, Amex, CB, Apple Pay, Google Pay,
 *   SEPA, virement/local selon le pays (automatic_payment_methods).
 * • Webhook signé vérifié côté serveur (Stripe-Signature, HMAC SHA-256).
 * • Vérification serveur de la session avant passage à "Payée".
 */
import { config } from '../../config.js';
import { log } from '../../lib/logger.js';
import { badRequest, serverError } from '../../lib/errors.js';
import { verifySignedPayload } from '../../lib/crypto.js';

const API = 'https://api.stripe.com/v1';

async function stripeFetch(path, { method = 'POST', params = {}, idempotencyKey = null } = {}) {
  if (!config.payments.stripeSecretKey) throw serverError('Clé API Stripe manquante.');
  const headers = {
    Authorization: `Bearer ${config.payments.stripeSecretKey}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  };
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

  const body = new URLSearchParams();
  const flatten = (prefix, value) => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
      value.forEach((v, i) => flatten(`${prefix}[${i}]`, v));
    } else if (typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) flatten(`${prefix}[${k}]`, v);
    } else {
      body.append(prefix, String(value));
    }
  };
  for (const [k, v] of Object.entries(params)) flatten(k, v);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const res = await fetch(`${API}${path}`, {
      method,
      headers,
      body: method === 'GET' ? undefined : body.toString(),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data?.error?.message ?? `Stripe ${res.status}`);
      err.status = res.status;
      err.code = data?.error?.code ?? null;
      throw err;
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

export const stripeProvider = {
  name: 'stripe',
  label: 'Cartes, Apple Pay, Google Pay, SEPA…',
  ready: config.payments.configuredStripe,
  isDemo: false,
  methods: [
    'Visa', 'Mastercard', 'American Express', 'Carte bancaire (CB)',
    'Apple Pay', 'Google Pay', 'SEPA', 'Virement bancaire',
    'PayPal', 'Moyens locaux selon le pays',
  ],

  async createCheckout({ order, user, pack, successUrl, cancelUrl }) {
    const session = await stripeFetch('/checkout/sessions', {
      params: {
        mode: 'payment',
        success_url: successUrl,
        cancel_url: cancelUrl,
        client_reference_id: user.id,
        customer_email: user.email,
        locale: 'fr',
        allow_promotion_codes: true,
        automatic_payment_methods: { enabled: true, allow_redirects: 'always' },
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: (order.currency ?? 'EUR').toLowerCase(),
              unit_amount: order.amount_cents,
              product_data: {
                name: `${pack.emoji} ${pack.name}`,
                description: (pack.tagline || 'Pack officiel KaleaShop').slice(0, 140),
              },
            },
          },
        ],
        metadata: { order_id: order.id, order_number: order.order_number, pack_slug: pack.slug },
        payment_intent_data: {
          metadata: { order_id: order.id, order_number: order.order_number, user_id: user.id },
        },
      },
      idempotencyKey: `checkout_${order.id}`,
    });
    if (!session.url) throw serverError('Stripe n’a pas renvoyé d’URL de paiement.');
    return { sessionId: session.id, url: session.url, expiresAt: (session.expires_at ?? 0) * 1000 };
  },

  /** Vérification serveur du paiement avant de passer la commande à "Payée". */
  async verifySession(sessionId) {
    const session = await stripeFetch(`/checkout/sessions/${encodeURIComponent(sessionId)}`, { method: 'GET' });
    return {
      status: session.payment_status, // paid | unpaid | no_payment_required
      amountTotalCents: session.amount_total,
      currency: session.currency,
      paymentIntentId: typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id,
      metadata: session.metadata ?? {},
      sessionStatus: session.status, // open | complete | expired
    };
  },

  async refund({ order, amountCents = order.amount_cents, reason = 'requested_by_customer' }) {
    const refund = await stripeFetch('/refunds', {
      params: {
        payment_intent: order.payment_intent_id,
        amount: amountCents,
        reason,
        metadata: { order_id: order.id, kalea_order: order.order_number },
      },
      idempotencyKey: `refund_${order.id}_${amountCents}`,
    });
    return { ok: true, refundId: refund.id, status: refund.status, amountCents: refund.amount };
  },

  /** Vérifie la signature Stripe-Signature (t=…,v1=…). */
  verifyWebhook(rawBody, header) {
    const secret = config.payments.stripeWebhookSecret;
    if (!secret) return { ok: false, reason: 'STRIPE_WEBHOOK_SECRET manquant' };
    return verifySignedPayload(secret, rawBody, header, 5 * 60_000);
  },

  parseEvent(rawBody) {
    try { return JSON.parse(rawBody); } catch { throw badRequest('Corps webhook invalide.'); }
  },
};

export { log };
