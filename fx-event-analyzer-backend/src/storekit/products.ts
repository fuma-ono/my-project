import { FEATURE_CODES, type FeatureCode } from '../authorization/entitlements.js';

/**
 * FX Event Analyzer Pro (HQ確定 2026-10-02): one auto-renewable
 * Subscription Group "FX Event Analyzer Pro" with a monthly (¥980) and a
 * yearly (¥9,800) option. Prices live in App Store Connect, not here — the
 * Backend only needs to know which product ids are ours.
 */
export const PRO_PRODUCT_IDS = [
  'com.fumaono.fxeventanalyzer.pro.monthly',
  'com.fumaono.fxeventanalyzer.pro.yearly',
] as const;

export type ProProductId = (typeof PRO_PRODUCT_IDS)[number];

export function isProProductId(value: string): value is ProProductId {
  return (PRO_PRODUCT_IDS as readonly string[]).includes(value);
}

/** The features PRO adds on top of FREE (api-design.md §28). Only these are
 * granted/revoked by a subscription — FREE's features are never touched. */
export const PRO_ONLY_FEATURE_CODES: readonly FeatureCode[] = [FEATURE_CODES.VIEW_ADVANCED_STATS];
