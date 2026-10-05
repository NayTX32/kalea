/** KALEA — webhooks de paiement (signature obligatoire, idempotents). */
import { rateLimit } from '../lib/ratelimit.js';
import { notFound, badRequest } from '../lib/errors.js';
import { log } from '../lib/logger.js';
import { handlePaymentEvent, paymentsStatus } from '../services/payments/index.js';

const KNOWN = new Set(['stripe', 'paypal', 'demo']);

export function webhookRoutes(router) {
  /**
   * POST /api/webhooks/:provider
   * Headers attendus :
   *   stripe → Stripe-Signature: t=…,v1=…
   *   démo   → X-Kalea-Signature: t=…,v1=…
   * Aucune authentification de session : la signature HMAC fait foi.
   */
  router.post('/api/webhooks/:provider', rateLimit('webhook', 300), async (ctx) => {
    const provider = ctx.params.provider;
    if (!KNOWN.has(provider)) throw notFound('Prestataire inconnu.');
    const signature = provider === 'stripe'
      ? (ctx.get('stripe-signature') ?? ctx.get('x-kalea-signature'))
      : (ctx.get('x-kalea-signature') ?? ctx.get('stripe-signature'));

    if (!ctx.rawBody) throw badRequest('Corps webhook vide.');
    const result = await handlePaymentEvent({
      providerName: provider,
      rawBody: ctx.rawBody,
      signatureHeader: signature,
      headers: ctx.headers,
    });
    log.info('webhook_received', { provider, status: result.status, eventId: result.eventId });
    return ctx.json({ received: true, ...result });
  });

  router.get('/api/webhooks', (ctx) => ctx.json(paymentsStatus()));
}
