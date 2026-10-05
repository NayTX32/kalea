/**
 * KALEA — prestataire professionnel : PayPal (portefeuille + carte).
 *
 * Moyens acceptés : solde PayPal, compte PayPal, carte bancaire traitée par
 * PayPal (Visa / Mastercard / Amex / CB), paiement en 4x selon l'éligibilité,
 * ainsi que les moyens locaux proposés par PayPal selon le pays.
 *
 * Flux :
 *   1. Création d'une commande PayPal (intent=CAPTURE) → redirection joueur.
 *   2. Retour joueur → capture côté serveur (vérification du montant).
 *   3. Confirmation définitive par webhook signé vérifié via l'API PayPal
 *      /v1/notifications/verify-webhook-signature.
 *   4. Aucune donnée bancaire ne transite par KALEA.
 */
import { config } from '../../config.js';
import { get, run, now, newId } from '../../db.js';
import { log } from '../../lib/logger.js';
import { badRequest, serverError } from '../../lib/errors.js';

const API = {
  live: 'https://api-m.paypal.com',
  sandbox: 'https://api-m.sandbox.paypal.com',
};

const mode = () => (config.payments.paypalMode === 'live' ? 'live' : 'sandbox');
const base = () => API[mode()];
const authHeader = () => `Basic ${Buffer.from(`${config.payments.paypalClientId}:${config.payments.paypalSecret}`).toString('base64')}`;

let tokenCache = { token: null, expiresAt: 0 };

async function getToken() {
  if (tokenCache.token && Date.now() < tokenCache.expiresAt - 30_000) return tokenCache.token;
  const res = await fetch(`${base()}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: authHeader(), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw serverError(`PayPal : authentification impossible (${data.error_description ?? res.status}).`);
  tokenCache = { token: data.access_token, expiresAt: Date.now() + Number(data.expires_in ?? 3200) * 1000 };
  return tokenCache.token;
}

async function paypal(path, { method = 'POST', body = null, headers = {} } = {}) {
  const token = await getToken();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const res = await fetch(`${base()}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'PayPal-Request-Id': `kalea-${newId('req')}`,
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const details = Array.isArray(data?.details) ? data.details.map((d) => d.issue).join(', ') : '';
      const err = new Error(data?.message ? `${data.message}${details ? ` — ${details}` : ''}` : `PayPal ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

const centsToValue = (cents) => (Number(cents) / 100).toFixed(2);

function orderIdFromResource(resource) {
  return (
    resource?.custom_id ??
    resource?.invoice_id ??
    resource?.metadata?.order_id ??
    resource?.supplementary_data?.related_ids?.order_id ??
    null
  );
}

function findOrder(resource) {
  let id = orderIdFromResource(resource);
  if (id) {
    const direct = get('SELECT id FROM orders WHERE id = ?', id);
    if (direct) return direct.id;
  }
  const paypalId = resource?.supplementary_data?.related_ids?.order_id ?? resource?.id;
  if (paypalId) {
    const bySession = get('SELECT id FROM orders WHERE checkout_session_id = ?', paypalId);
    if (bySession) return bySession.id;
  }
  return null;
}

export const paypalProvider = {
  name: 'paypal',
  label: 'PayPal et carte bancaire',
  isDemo: false,
  ready: config.payments.paypalConfigured,
  methods: ['PayPal', 'Carte bancaire (Visa, Mastercard, Amex, CB)', 'Paiement en 4x', 'Moyens locaux PayPal'],

  async createCheckout({ order, user, pack, successUrl, cancelUrl }) {
    const created = await paypal('/v2/checkout/orders', {
      body: {
        intent: 'CAPTURE',
        purchase_units: [
          {
            reference_id: order.id,
            custom_id: order.id,
            invoice_id: order.order_number,
            description: `${pack.emoji} ${pack.name} — KALEA`,
            amount: { currency_code: order.currency ?? 'EUR', value: centsToValue(order.amount_cents) },
          },
        ],
        application_context: {
          brand_name: 'KALEA',
          locale: 'fr-FR',
          landing_page: 'BILLING',
          user_action: 'PAY_NOW',
          return_url: successUrl,
          cancel_url: cancelUrl,
        },
      },
    });
    const approve = (created.links ?? []).find((l) => l.rel === 'approve');
    if (!approve?.href) throw serverError('PayPal n’a pas renvoyé d’URL de paiement.');
    return { sessionId: created.id, url: approve.href, expiresAt: null };
  },

  /** Vérification serveur du statut et du montant. */
  async verifySession(sessionId) {
    const order = await paypal(`/v2/checkout/orders/${encodeURIComponent(sessionId)}`, { method: 'GET' });
    const unit = order.purchase_units?.[0] ?? {};
    const amount = unit.amount?.value;
    return {
      status: order.status === 'COMPLETED' ? 'paid' : order.status === 'APPROVED' ? 'unpaid' : 'unpaid',
      sessionStatus: order.status,
      amountTotalCents: amount ? Math.round(Number(amount) * 100) : null,
      currency: order.purchase_units?.[0]?.amount?.currency_code ?? 'EUR',
      paymentIntentId: order.purchase_units?.[0]?.payments?.captures?.[0]?.id ?? null,
      raw: order,
    };
  },

  /** Capture serveur : déclenchée au retour du joueur ou par le webhook. */
  async capture(sessionId) {
    const captured = await paypal(`/v2/checkout/orders/${encodeURIComponent(sessionId)}/capture`, {
      body: {},
    });
    const capture = captured.purchase_units?.[0]?.payments?.captures?.[0] ?? null;
    return {
      status: captured.status, // COMPLETED
      captureId: capture?.id ?? null,
      amountCents: capture?.amount?.value ? Math.round(Number(capture.amount.value) * 100) : null,
      sellerProtection: capture?.seller_protection?.status ?? null,
    };
  },

  async refund({ order, amountCents = order.amount_cents, reason = 'OTHER' }) {
    const captureId = order.payment_intent_id;
    if (!captureId) throw badRequest('Aucune capture PayPal associée à cette commande.');
    const refund = await paypal(`/v2/payments/captures/${encodeURIComponent(captureId)}/refund`, {
      body: {
        amount: { value: centsToValue(amountCents), currency_code: order.currency ?? 'EUR' },
        note_to_payer: 'Remboursement KALEA',
        reason: reason === 'requested_by_customer' ? 'OTHER' : reason,
      },
    });
    return { ok: true, refundId: refund.id, status: refund.status, amountCents: refund.amount?.value ? Math.round(Number(refund.amount.value) * 100) : amountCents };
  },

  /**
   * Vérification de la signature du webhook via l'API PayPal dédiée
   * (le certificat est téléchargé par PayPal lui-même : aucune confiance locale).
   */
  async verifyWebhook(rawBody, headers) {
    const webhookId = await ensureWebhookId();
    if (!webhookId) return { ok: false, reason: 'webhook_paypal_non_configuré' };
    try {
      const result = await paypal('/v1/notifications/verify-webhook-signature', {
        body: {
          auth_algo: headers['paypal-auth-algo'],
          cert_url: headers['paypal-cert-url'],
          transmission_id: headers['paypal-transmission-id'],
          transmission_sig: headers['paypal-transmission-sig'],
          transmission_time: headers['paypal-transmission-time'],
          webhook_id: webhookId,
          webhook_event: JSON.parse(rawBody),
        },
      });
      return result.verification_status === 'SUCCESS'
        ? { ok: true }
        : { ok: false, reason: 'verification_echouee' };
    } catch (error) {
      return { ok: false, reason: error.message };
    }
  },

  parseEvent(rawBody) {
    const hook = JSON.parse(rawBody);
    return {
      id: hook.id ?? `${hook.event_type}-${hook.resource?.id ?? ''}`,
      type: hook.event_type,
      created: new Date(hook.create_time ?? Date.now()).getTime(),
      data: { object: { ...hook.resource, metadata: { order_id: findOrder(hook.resource) ?? undefined } } },
      raw: hook,
    };
  },
};

/* ------------------- Enregistrement automatique du webhook ------------------- */

let webhookIdCache = null;

async function ensureWebhookId() {
  if (webhookIdCache) return webhookIdCache;
  const stored = get('SELECT value FROM settings WHERE key = ?', 'paypal_webhook_id');
  if (stored) {
    webhookIdCache = JSON.parse(stored.value);
    return webhookIdCache;
  }
  if (!config.payments.paypalConfigured) return null;
  const url = `${config.baseUrl}/api/webhooks/paypal`;
  try {
    const list = await paypal('/v1/notifications/webhooks', { method: 'GET' });
    const existing = (list.webhooks ?? []).find((w) => w.url === url);
    if (existing) {
      webhookIdCache = existing.id;
    } else {
      const created = await paypal('/v1/notifications/webhooks', {
        body: {
          url,
          event_types: [
            'CHECKOUT.ORDER.APPROVED',
            'CHECKOUT.ORDER.COMPLETED',
            'CHECKOUT.ORDER.CANCELED',
            'PAYMENT.CAPTURE.COMPLETED',
            'PAYMENT.CAPTURE.DENIED',
            'PAYMENT.CAPTURE.REFUNDED',
            'PAYMENT.CAPTURE.PENDING',
          ],
        },
      });
      webhookIdCache = created.id;
    }
    run(`INSERT INTO settings (key, value, updated_at) VALUES ('paypal_webhook_id', ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      JSON.stringify(webhookIdCache), now());
    log.info('paypal_webhook_registered', { webhookId: webhookIdCache, url });
  } catch (error) {
    log.warn('paypal_webhook_registration_failed', { error: error.message, url });
    return null;
  }
  return webhookIdCache;
}

export { findOrder as paypalFindOrder };
