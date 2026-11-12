/**
 * Advanced Statistics partial gating — api-design.md §21.3, Phase 2
 * instruction §14. Never a blanket 403 for the whole endpoint; Basic
 * Statistics stay available to anyone with VIEW_HISTORICAL regardless.
 */
export interface AdvancedStatisticsGated<T> {
  available: boolean;
  required_entitlement: string | null;
  data: T | null;
}

export function gateAdvancedStatistics<T>(hasEntitlement: boolean, data: T): AdvancedStatisticsGated<T> {
  if (!hasEntitlement) {
    return { available: false, required_entitlement: 'VIEW_ADVANCED_STATS', data: null };
  }
  return { available: true, required_entitlement: null, data };
}
