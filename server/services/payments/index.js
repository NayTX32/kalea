/**
 * KALEA — orchestration des paiements.
 *
 * Registre de prestataires (Stripe, démo, extensibles), création de session
 * de paiement, et traitement unique (idempotent) des webhooks :
 *   événement reçu → signature vérifiée → dédoublonnage → vérification serveur
 *   → commande "Payée" → livraison automatique des récompenses.
 */
import { config } from '../../config.js';
import { get, run, newId, now, parseJson } from '../../db.js';
import { badRequest, serverError } from '../../lib/errors.js';
import { log, audit } from '../../lib/logger.js';
import { stripeProvider } from './stripe.js';
import { paypalProvider } from './paypal.js';
import { demoProvider } from './demo.js';
import { getOrderRow, updateOrder, markOrderPaid, releaseOrderStock, ORDER_STATUS } from '../orders.js';
import { fulfillOrder, revokeOrder } from '../fulfillment.js';

const PROVIDERS = {
  paypal: paypalProvider,
  stripe: stripeProvider,
  demo: demoProvider,
};

export function getProvider(name) {
  const provider = PROVIDERS[name];
  if (!provider) throw badRequest(`Prestataire de paiement inconnu : ${name}`);
  return provider;
}

/** Prestataire actif (selon configuration / variable d'environnement). */
export function activeProvider() {
  const name = config.payments.provider;
  return getProvider(PROVIDERS[name] ? name : 'demo');
}

export function paymentsStatus() {
  const active = activeProvider();
  return {
    active: active.name,
    activeLabel: active.label,
    demo: Boolean(active.isDemo),
    methods: active.methods,
    paypalConfigured: config.payments.paypalConfigured,
    paypalMode: config.payments.paypalMode,
    stripeConfigured: config.payments.configuredStripe,
    webhookConfigured: active.name === 'demo' ? true : true,
    baseUrl: config.baseUrl,
  };
}

/* ---------------------- Création d'une session ---------------------- */

export async function startCheckout({ order, user, pack }) {
  const provider = activeProvider();
  const successUrl = `${config.baseUrl}/commande/${order.id}?result=success`;
  const cancelUrl = `${config.baseUrl}/commande/${order.id}?result=canceled`;
  const { sessionId, url, expiresAt } = await provider.createCheckout({
    order, user, pack, successUrl, cancelUrl,
  });
  updateOrder(order.id, {
    provider: provider.name,
    checkoutSessionId: sessionId,
    status: order.status === ORDER_STATUS.PAID ? order.status : ORDER_STATUS.PROCESSING,
  });
  log.info('checkout_created', { orderId: order.id, provider: provider.name });
  return { provider: provider.name, sessionId, url, expiresAt };
}

/* -------------------------- Webhooks -------------------------- */

function recordEvent({ provider, event, raw, status, message, orderId = null }) {
  const id = newId('evt');
  try {
    run(
      `INSERT INTO payment_events (id, order_id, provider, event_id, type, status, amount_cents, message, raw, received_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, orderId, provider, event.id, event.type, status,
      event.data?.object?.amount ?? null,
      message ? String(message).slice(0, 500) : null,
      raw ? String(raw).slice(0, 20000) : null,
      now(),
    );
    return id;
  } catch (error) {
    // Événement déjà enregistré (duplicate key) → on renvoie l'existant.
    const existing = get('SELECT id FROM payment_events WHERE provider = ? AND event_id = ?', provider, event.id);
    if (existing) return { duplicate: true, id: existing.id };
    throw error;
  }
}

function orderIdFromEvent(event) {
  const object = event.data?.object ?? {};
  return (
    object.metadata?.order_id ??
    object.custom_id ??
    object.reference_id ??
    object.invoice_id ??
    object.payment_intent?.metadata?.order_id ??
    null
  );
}

/** Résout l'identifiant local KALEA depuis la ressource d'un événement. */
function findLocalOrder(resource) {
  const candidates = [
    resource?.custom_id,
    resource?.reference_id,
    resource?.invoice_id,
    resource?.metadata?.order_id,
  ].filter(Boolean);
  for (const candidate of candidates) {
    const row = get('SELECT id FROM orders WHERE id = ?', candidate);
    if (row) return row.id;
  }
  return null;
}

function findOrderBySession(sessionId) {
  if (!sessionId) return null;
  const row = get('SELECT id FROM orders WHERE checkout_session_id = ?', sessionId);
  return row?.id ?? null;
}

/**
 * Confirmation serveur (utilisée après une capture PayPal au retour du joueur).
 * Le webhook reste la source de vérité : cette fonction est idempotente.
 */
export async function confirmPaymentFromServer({ orderId, providerName = activeProvider().name, source = 'server_capture' }) {
  const order = getOrderRow(orderId);
  if (!order) throw badRequest('Commande introuvable.');
  if (order.status === ORDER_STATUS.PAID) return { status: 'already_paid', order };
  const provider = getProvider(providerName);

  if (provider.capture && order.checkout_session_id) {
    const verified = await provider.verifySession(order.checkout_session_id);
    if (verified.amountTotalCents !== null && verified.amountTotalCents !== order.amount_cents) {
      log.error('capture_amount_mismatch', { orderId: order.id, expected: order.amount_cents, received: verified.amountTotalCents });
      throw badRequest('Le montant confirmé par le prestataire ne correspond pas à la commande.');
    }
    let captureId = verified.paymentIntentId;
    if (verified.sessionStatus !== 'COMPLETED') {
      const capture = await provider.capture(order.checkout_session_id);
      if (capture.status !== 'COMPLETED') {
        updateOrder(order.id, { status: ORDER_STATUS.FAILED, failureReason: `Capture ${capture.status}` });
        return { status: 'failed', order: getOrderRow(order.id) };
      }
      captureId = capture.captureId;
    }
    const { order: settled } = markOrderPaid(order.id, { provider: providerName, paymentIntentId: captureId });
    audit('payment.confirmed', { target: order.id, meta: { provider: providerName, source } });
    try { await fulfillOrder(order.id, { trigger: source }); } catch (error) {
      log.error('fulfillment_error', { orderId: order.id, error: error.message });
    }
    return { status: 'paid', order: getOrderRow(settled.id) };
  }
  throw badRequest('Ce prestataire ne supporte pas la confirmation serveur directe.');
}

/**
 * Traite un événement de paiement signé.
 * @returns {{status:string, duplicate?:boolean}}
 */
export async function handlePaymentEvent({ providerName, rawBody, signatureHeader, headers = {} }) {
  const provider = getProvider(providerName);

  // 1. Signature vérifiée côté serveur.
  const verification = provider.verifyWebhook(rawBody, signatureHeader, headers);
  const check = verification && typeof verification.then === 'function' ? await verification : verification;
  if (!check.ok) {
    log.warn('webhook_signature_rejected', { provider: providerName, reason: check.reason });
    throw badRequest(`Signature webhook invalide (${check.reason}).`);
  }

  // 2. Parsing + dédoublonnage par event_id unique.
  const event = provider.parseEvent(rawBody);
  if (!event?.id || !event?.type) throw badRequest('Événement webhook invalide.');

  const recordId = recordEvent({ provider: providerName, event, raw: rawBody, status: 'received' });
  if (recordId?.duplicate) {
    return { status: 'duplicate', eventId: event.id };
  }

  try {
    const result = await processEvent({ provider, providerName, event });
    run('UPDATE payment_events SET status = ?, message = ? WHERE id = ?',
      result.status, result.message ?? null, recordId);
    return { status: result.status, eventId: event.id };
  } catch (error) {
    run('UPDATE payment_events SET status = ?, message = ? WHERE id = ?',
      'error', error.message.slice(0, 500), recordId);
    log.error('webhook_processing_failed', { provider: providerName, type: event.type, error: error.message });
    throw error;
  }
}

async function processEvent({ provider, providerName, event }) {
  const type = event.type;
  const object = event.data?.object ?? {};

  /* ------------------------------ PayPal ------------------------------ */
  if (type === 'CHECKOUT.ORDER.APPROVED') {
    // Le joueur a approuvé : capture côté serveur (le webhook suivant confirmera).
    const orderId = findLocalOrder(object) ?? findOrderBySession(object.id);
    if (!orderId) return { status: 'ignored', message: 'Commande introuvable' };
    try {
      const capture = await provider.capture(object.id);
      const order = getOrderRow(orderId);
      if (capture.status === 'COMPLETED') {
        return settleOrder({ order, providerName, paymentIntentId: capture.captureId, event });
      }
      return { status: 'processed', message: `Capture ${capture.status}` };
    } catch (error) {
      return { status: 'error', message: error.message };
    }
  }

  if (type === 'PAYMENT.CAPTURE.COMPLETED' || type === 'CHECKOUT.ORDER.COMPLETED') {
    const orderId = findLocalOrder(object) ?? findOrderBySession(object.id ?? object.supplementary_data?.related_ids?.order_id);
    if (!orderId) return { status: 'ignored', message: 'Commande introuvable' };
    const order = getOrderRow(orderId);
    const amountCents = object.amount?.value ? Math.round(Number(object.amount.value) * 100) : null;
    if (amountCents !== null && amountCents !== order.amount_cents) {
      log.error('amount_mismatch', { orderId: order.id, expected: order.amount_cents, received: amountCents });
      return { status: 'error', message: 'Montant différent de la commande' };
    }
    return settleOrder({
      order, providerName,
      paymentIntentId: object.id ?? object.supplementary_data?.related_ids?.capture_id ?? null,
      event,
    });
  }

  if (type === 'PAYMENT.CAPTURE.DENIED') {
    const orderId = findLocalOrder(object) ?? findOrderBySession(object.supplementary_data?.related_ids?.order_id);
    const order = getOrderRow(orderId);
    if (!order) return { status: 'ignored', message: 'Commande introuvable' };
    updateOrder(order.id, { status: ORDER_STATUS.FAILED, failureReason: 'Paiement refusé (capture refusée)' });
    audit('payment.failed', { target: order.id, meta: { provider: providerName } });
    return { status: 'processed', message: 'Capture refusée' };
  }

  if (type === 'PAYMENT.CAPTURE.PENDING') {
    const orderId = findLocalOrder(object) ?? findOrderBySession(object.supplementary_data?.related_ids?.order_id);
    const order = getOrderRow(orderId);
    if (!order) return { status: 'ignored', message: 'Commande introuvable' };
    updateOrder(order.id, { status: ORDER_STATUS.PROCESSING, failureReason: 'Paiement en attente de confirmation' });
    return { status: 'processed', message: 'Capture en attente' };
  }

  if (type === 'CHECKOUT.ORDER.CANCELED' || type === 'PAYMENT.CAPTURE.REVERSED') {
    const orderId = findLocalOrder(object) ?? findOrderBySession(object.id);
    const order = getOrderRow(orderId);
    if (!order) return { status: 'ignored', message: 'Commande introuvable' };
    if (order.status !== ORDER_STATUS.PAID) {
      updateOrder(order.id, { status: ORDER_STATUS.CANCELED, failureReason: 'Paiement annulé par le prestataire' });
      return { status: 'processed', message: 'Commande annulée' };
    }
    return { status: 'ignored', message: 'Déjà payée' };
  }

  if (type === 'PAYMENT.CAPTURE.REFUNDED') {
    const orderId = findLocalOrder(object) ?? findOrderBySession(object.supplementary_data?.related_ids?.order_id);
    const order = getOrderRow(orderId);
    if (!order) return { status: 'ignored', message: 'Commande introuvable' };
    if (order.status === ORDER_STATUS.REFUNDED) return { status: 'duplicate', message: 'Déjà remboursée' };
    const amountCents = object.amount?.value ? Math.round(Number(object.amount.value) * 100) : order.amount_cents;
    return applyRefund({
      order, refundId: object.id, amountCents, providerName,
      reason: 'Remboursement confirmé par PayPal',
    });
  }

  /* --------------------------- Stripe / générique --------------------------- */

  if (type === 'checkout.session.completed' || type === 'checkout.session.async_payment_succeeded') {
    const orderId = object.metadata?.order_id ?? orderIdFromEvent(event);
    const order = getOrderRow(orderId);
    if (!order) return { status: 'ignored', message: 'Commande introuvable' };

    // 3. Vérification serveur du paiement (montant + statut) via le prestataire.
    const sessionId = object.id ?? order.checkout_session_id;
    let amountTotal = object.amount_total ?? null;
    let paymentIntentId = object.payment_intent ?? null;
    if (provider.verifySession && sessionId && !provider.isDemo) {
      try {
        const verified = await provider.verifySession(sessionId);
        if (verified.status !== 'paid') return { status: 'ignored', message: `Paiement non confirmé (${verified.status})` };
        amountTotal = verified.amountTotalCents;
        paymentIntentId = verified.paymentIntentId ?? paymentIntentId;
      } catch (error) {
        log.warn('session_verification_failed', { orderId: order.id, error: error.message });
        return { status: 'error', message: error.message };
      }
    }
    if (amountTotal !== null && Number(amountTotal) !== order.amount_cents) {
      log.error('amount_mismatch', { orderId: order.id, expected: order.amount_cents, received: amountTotal });
      run('UPDATE payment_events SET status = ?, message = ? WHERE event_id = ?', 'error', 'Montant différent de la commande', event.id);
      return { status: 'error', message: 'Montant différent de la commande' };
    }
    return settleOrder({ order, providerName, paymentIntentId, event });
  }

  if (type === 'payment_intent.succeeded' || type === 'charge.succeeded') {
    const orderId = orderIdFromEvent(event);
    const order = getOrderRow(orderId);
    if (!order) return { status: 'ignored', message: 'Commande introuvable' };
    if (order.status === ORDER_STATUS.PAID) return { status: 'duplicate', message: 'Déjà payée' };
    return settleOrder({ order, providerName, paymentIntentId: object.id, event });
  }

  if (type === 'payment_intent.payment_failed') {
    const orderId = orderIdFromEvent(event);
    const order = getOrderRow(orderId);
    if (!order) return { status: 'ignored', message: 'Commande introuvable' };
    const reason = object.last_payment_error?.message ?? 'Paiement refusé par le prestataire';
    updateOrder(order.id, { status: ORDER_STATUS.FAILED, failureReason: String(reason).slice(0, 300) });
    audit('payment.failed', { target: order.id, meta: { reason } });
    log.warn('payment_failed', { orderId: order.id, reason });
    return { status: 'processed', message: reason };
  }

  if (type === 'checkout.session.expired') {
    const order = getOrderRow(object.metadata?.order_id);
    if (!order) return { status: 'ignored', message: 'Commande introuvable' };
    if (order.status !== ORDER_STATUS.PENDING && order.status !== ORDER_STATUS.PROCESSING) {
      return { status: 'ignored', message: 'Statut non expirable' };
    }
    updateOrder(order.id, { status: ORDER_STATUS.EXPIRED, failureReason: 'Session de paiement expirée' });
    return { status: 'processed', message: 'Session expirée' };
  }

  if (type === 'checkout.session.expired' || type === 'payment_intent.canceled') {
    return { status: 'ignored', message: 'Annulation sans commande active' };
  }

  if (type === 'charge.refunded') {
    const orderId = orderIdFromEvent(event);
    const order = getOrderRow(orderId);
    if (!order) return { status: 'ignored', message: 'Commande introuvable' };
    if (order.status === ORDER_STATUS.REFUNDED) return { status: 'duplicate', message: 'Déjà remboursée' };
    const refund = (object.refunds?.data ?? []).slice(-1)[0] ?? null;
    return applyRefund({
      order,
      refundId: refund?.id ?? object.id,
      amountCents: refund?.amount ?? object.amount_refunded ?? order.amount_cents,
      providerName,
      reason: 'Remboursement confirmé par le prestataire',
    });
  }

  if (type === 'charge.dispute.created') {
    audit('payment.dispute', { target: orderIdFromEvent(event), meta: { dispute: object.id } });
    return { status: 'processed', message: 'Litige enregistré' };
  }

  return { status: 'ignored', message: `Événement non géré : ${type}` };
}

/** Passe la commande à "Payée" puis déclenche la livraison automatique. */
async function settleOrder({ order, providerName, paymentIntentId, event }) {
  const { alreadyPaid } = markOrderPaid(order.id, { provider: providerName, paymentIntentId });
  if (alreadyPaid) return { status: 'duplicate', message: 'Commande déjà payée' };
  audit('payment.confirmed', { target: order.id, meta: { provider: providerName, eventId: event.id } });
  log.info('payment_confirmed', { orderId: order.id, orderNumber: order.order_number, provider: providerName });

  // 6. Livraison automatique (anti double attribution géré dans fulfillment).
  try {
    await fulfillOrder(order.id, { trigger: `webhook:${event.type}` });
  } catch (error) {
    log.error('fulfillment_error', { orderId: order.id, error: error.message });
  }
  return { status: 'processed', message: 'Paiement confirmé et livraison déclenchée' };
}

/* ------------------------- Remboursements ------------------------- */

export async function refundOrder({ order, amountCents = order.amount_cents, reason = 'requested_by_customer', actor = null }) {
  if (order.status === ORDER_STATUS.REFUNDED) throw badRequest('Cette commande est déjà remboursée.');
  if (order.status !== ORDER_STATUS.PAID) throw badRequest('Seule une commande payée peut être remboursée.');
  const provider = getProvider(order.provider);
  const { refundId, status } = await provider.refund({ order, amountCents, reason });
  const fullRefund = amountCents >= order.amount_cents;
  updateOrder(order.id, {
    status: fullRefund ? ORDER_STATUS.REFUNDED : order.status,
    providerRefundId: refundId,
    refundReason: reason,
    refundedCents: amountCents,
  });
  audit('payment.refund', { actor, target: order.id, meta: { refundId, amountCents, status } });
  log.info('refund_created', { orderId: order.id, refundId, amountCents });

  if (fullRefund) {
    // Retrait automatique des rôles / récompenses si l'option est activée.
    await revokeOrder(order.id, { reason: 'remboursement', actor });
    releaseOrderStock(order.id); // le stock devient de nouveau disponible
  }
  return { refundId, status, fullRefund };
}

async function applyRefund({ order, refundId, amountCents, providerName, reason, actor = null }) {
  const fullRefund = Number(amountCents) >= order.amount_cents;
  const wasRefunded = order.status === ORDER_STATUS.REFUNDED;
  updateOrder(order.id, {
    status: fullRefund ? ORDER_STATUS.REFUNDED : order.status,
    providerRefundId: refundId,
    refundReason: reason,
    refundedCents: Number(amountCents),
  });
  audit('payment.refunded', { actor, target: order.id, meta: { refundId, amountCents, provider: providerName } });
  if (fullRefund) {
    await revokeOrder(order.id, { reason: 'remboursement', actor });
    // Garde anti-double : seul un état non encore « remboursé » restitue le stock.
    if (!wasRefunded) releaseOrderStock(order.id);
  }
  return { status: 'processed', message: 'Remboursement appliqué' };
}

export { parseJson, serverError };
