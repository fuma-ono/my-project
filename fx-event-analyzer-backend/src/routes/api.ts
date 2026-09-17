import type { FastifyInstance } from 'fastify';
import { registerAuth } from '../auth/plugin.js';
import { registerAccountRoutes } from './account.js';
import { registerSubscriptionRoutes } from './subscription.js';
import { registerEntitlementsRoutes } from './entitlements.js';
import { registerIndicatorRoutes } from './indicators.js';
import { registerEventRoutes } from './events.js';
import { registerHistoricalRoutes } from './historical.js';
import { registerSearchRoutes } from './search.js';
import { registerHomeRoutes } from './home.js';

/**
 * Everything under /api/v1 requires a valid Supabase Auth JWT — Home /
 * Indicators / Search / Account / Subscription / Entitlement APIs are
 * "authenticated, but no specific feature_code required" per api-design.md
 * §27.1; endpoint-specific Entitlement checks happen inside each route.
 */
export async function registerApiRoutes(app: FastifyInstance): Promise<void> {
  registerAuth(app, app.env.SUPABASE_JWT_SECRET);

  await app.register(registerAccountRoutes);
  await app.register(registerSubscriptionRoutes);
  await app.register(registerEntitlementsRoutes);
  await app.register(registerIndicatorRoutes);
  await app.register(registerEventRoutes);
  await app.register(registerHistoricalRoutes);
  await app.register(registerSearchRoutes);
  await app.register(registerHomeRoutes);
}
