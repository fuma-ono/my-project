import type { FastifyInstance } from 'fastify';
import { listActiveFeatureCodes } from '../authorization/entitlements.js';
import { priceFeaturesEnabled } from '../authorization/priceFeatures.js';
import { planFromFeatures, toEntitlementLimits } from '../domain/planLimits.js';
import { entitlementsQuerySchema } from '../schemas/entitlements.js';

/** GET /entitlements — api-design.md §27: "現在ユーザーが利用可能な
 * Featureを取得する". Returns the user's currently-active feature_codes
 * only — active explicit rows plus default_entitlements without an explicit
 * row (expired/disabled rows are filtered out here, not left for the
 * client to interpret), plus the plan derived from them and that plan's
 * usage limits (§28.1). Date limits are computed in `timezone` (default UTC). */
export function registerEntitlementsRoutes(app: FastifyInstance): void {
  app.get('/entitlements', async (request) => {
    const query = entitlementsQuerySchema.parse(request.query);
    const features = await listActiveFeatureCodes(app.supabase, request.user!.id);
    const plan = planFromFeatures(features);
    // price_features_enabled: サーバー側フラグ(config/priceFeatures.ts)。false の間、API は価格由来の情報を返さない
    // (反応・pips・チャート・major_fx・レートアラート)。プランや feature_code とは別の、サーバー全体の機能の可否。
    return {
      features,
      plan,
      limits: toEntitlementLimits(plan, new Date(), query.timezone),
      price_features_enabled: priceFeaturesEnabled(app),
      // purchases_enabled: 購入導線のフラグ(PURCHASES_ENABLED、既定 false)。表示の可否を iOS に伝えるだけで、API の挙動は変えない。
      purchases_enabled: app.env.PURCHASES_ENABLED,
    };
  });
}
