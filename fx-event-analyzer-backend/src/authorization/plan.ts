import type { SupabaseClient } from '@supabase/supabase-js';
import { planFromFeatures, type Plan } from '../domain/planLimits.js';
import { assertEntitlement, listActiveFeatureCodes, type FeatureCode } from './entitlements.js';

/** FREE / PRO for usage limits (api-design.md §28.1): PRO = an active
 * VIEW_ADVANCED_STATS entitlement (synced by POST /subscription/verify),
 * FREE = every other authenticated user. Uses the effective feature set
 * (explicit rows + default_entitlements), so a user with only the defaults
 * is FREE. */
export async function resolvePlan(supabase: SupabaseClient, userId: string): Promise<Plan> {
  return planFromFeatures(await listActiveFeatureCodes(supabase, userId));
}

/**
 * requireEntitlement(featureCode) と resolvePlan を、機能の集合を1回だけ読んで
 * 行う(HQ指示 2026-10-22「同じリクエストでプランを何度も読まない」)。判定は
 * それぞれと同じ: 機能が無ければ 403 FEATURE_NOT_ENTITLED、プランは
 * planFromFeatures。entitlements / default_entitlements の2クエリ(並列)で済む。
 */
export async function requireEntitlementAndResolvePlan(
  supabase: SupabaseClient,
  userId: string,
  featureCode: FeatureCode,
): Promise<Plan> {
  const features = await listActiveFeatureCodes(supabase, userId);
  assertEntitlement(features, featureCode);
  return planFromFeatures(features);
}
