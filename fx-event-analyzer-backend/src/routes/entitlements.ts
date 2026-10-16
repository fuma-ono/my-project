import type { FastifyInstance } from 'fastify';
import { listActiveFeatureCodes } from '../authorization/entitlements.js';
import { planFromFeatures, toEntitlementLimits } from '../domain/planLimits.js';
import { entitlementsQuerySchema } from '../schemas/entitlements.js';

/** GET /entitlements — api-design.md §27: "現在ユーザーが利用可能な
 * Featureを取得する". Returns the user's currently-active feature_codes
 * only (expired/disabled rows are filtered out here, not left for the
 * client to interpret), plus the plan derived from them and that plan's
 * usage limits (§28.1). Date limits are computed in `timezone` (default UTC). */
export function registerEntitlementsRoutes(app: FastifyInstance): void {
  app.get('/entitlements', async (request) => {
    const query = entitlementsQuerySchema.parse(request.query);
    const features = await listActiveFeatureCodes(app.supabase, request.user!.id);
    const plan = planFromFeatures(features);
    return { features, plan, limits: toEntitlementLimits(plan, new Date(), query.timezone) };
  });
}
