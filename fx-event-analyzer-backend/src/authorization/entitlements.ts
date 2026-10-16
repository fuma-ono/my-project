import type { SupabaseClient } from '@supabase/supabase-js';
import { ApiError } from '../errors/ApiError.js';
import { listDefaultFeatureCodes, listEntitlements } from '../repositories/entitlementsRepository.js';

/**
 * MVP feature_code set (db-design.md §3.3 / Phase 2 instruction §8). Never
 * embeds FREE/PRO in the code itself — plan-to-feature mapping lives in
 * data (the entitlements / default_entitlements tables), not in this
 * constant list.
 */
export const FEATURE_CODES = {
  VIEW_BASIC_EVENT: 'VIEW_BASIC_EVENT',
  VIEW_HISTORICAL: 'VIEW_HISTORICAL',
  VIEW_MARKET_REACTION: 'VIEW_MARKET_REACTION',
  VIEW_ADVANCED_STATS: 'VIEW_ADVANCED_STATS',
} as const;

export type FeatureCode = (typeof FEATURE_CODES)[keyof typeof FEATURE_CODES];

export function isActive(row: { enabled: boolean; expires_at: string | null }): boolean {
  if (!row.enabled) return false;
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) return false;
  return true;
}

/**
 * The user's effective feature_codes (api-design.md §28, HQ instruction
 * 2026-10-16): active explicit `entitlements` rows (enabled, not expired)
 * plus every `default_entitlements` feature the user has *no* explicit row
 * for. An explicit row always wins over the default — a disabled or expired
 * row revokes a default feature for that user. Two queries, run in parallel;
 * sorted so GET /entitlements `features` is stable.
 */
export async function listActiveFeatureCodes(supabase: SupabaseClient, userId: string): Promise<string[]> {
  const [rows, defaults] = await Promise.all([listEntitlements(supabase, userId), listDefaultFeatureCodes(supabase)]);
  const explicit = new Set(rows.map((row) => row.feature_code));
  const active = rows.filter(isActive).map((row) => row.feature_code);
  const inherited = defaults.filter((code) => !explicit.has(code));
  return [...new Set([...active, ...inherited])].sort();
}

export async function hasEntitlement(
  supabase: SupabaseClient,
  userId: string,
  featureCode: FeatureCode,
): Promise<boolean> {
  const features = await listActiveFeatureCodes(supabase, userId);
  return features.includes(featureCode);
}

/** Throws 403 FEATURE_NOT_ENTITLED. Used for endpoints that gate the
 * *entire* response (api-design.md §27.1) — Advanced Statistics instead
 * uses partial gating (see src/domain/advancedStatistics.ts), never this. */
export async function requireEntitlement(
  supabase: SupabaseClient,
  userId: string,
  featureCode: FeatureCode,
): Promise<void> {
  const has = await hasEntitlement(supabase, userId, featureCode);
  if (!has) {
    throw ApiError.featureNotEntitled(`This endpoint requires the ${featureCode} entitlement.`);
  }
}
