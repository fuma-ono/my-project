import type { SupabaseClient } from '@supabase/supabase-js';
import { ApiError } from '../errors/ApiError.js';
import { listEntitlements } from '../repositories/entitlementsRepository.js';

/**
 * MVP feature_code set (db-design.md §3.3 / Phase 2 instruction §8). Never
 * embeds FREE/PRO in the code itself — plan-to-feature mapping lives in
 * data (the entitlements table), not in this constant list.
 */
export const FEATURE_CODES = {
  VIEW_BASIC_EVENT: 'VIEW_BASIC_EVENT',
  VIEW_HISTORICAL: 'VIEW_HISTORICAL',
  VIEW_MARKET_REACTION: 'VIEW_MARKET_REACTION',
  VIEW_ADVANCED_STATS: 'VIEW_ADVANCED_STATS',
} as const;

export type FeatureCode = (typeof FEATURE_CODES)[keyof typeof FEATURE_CODES];

function isActive(row: { enabled: boolean; expires_at: string | null }): boolean {
  if (!row.enabled) return false;
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) return false;
  return true;
}

export async function hasEntitlement(
  supabase: SupabaseClient,
  userId: string,
  featureCode: FeatureCode,
): Promise<boolean> {
  const rows = await listEntitlements(supabase, userId);
  return rows.some((row) => row.feature_code === featureCode && isActive(row));
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
