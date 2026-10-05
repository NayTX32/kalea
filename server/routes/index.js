/** KALEA — assemblage des routes et middlewares globaux. */
import { createRouter } from '../lib/http.js';
import { securityHeaders, ensureCsrfCookie, csrfGuard } from '../middleware/security.js';
import { loadSession } from '../middleware/session.js';
import { publicRoutes } from './public.routes.js';
import { authRoutes } from './auth.routes.js';
import { orderRoutes } from './orders.routes.js';
import { webhookRoutes } from './webhooks.routes.js';
import { supportRoutes } from './support.routes.js';
import { gameRoutes } from './game.routes.js';
import { adminRoutes } from './admin.routes.js';

export function buildRouter() {
  const router = createRouter();
  // Ordre critique : cookies de sécurité → session → CSRF → garde admin → routes.
  router.use(ensureCsrfCookie);
  router.use(loadSession);
  router.use(csrfGuard);

  publicRoutes(router);
  authRoutes(router);
  orderRoutes(router);
  supportRoutes(router);
  gameRoutes(router);
  webhookRoutes(router);
  adminRoutes(router);

  return router;
}

export { securityHeaders };
