/**
 * DB -> API Data Quality status mapping — api-design.md §7.1, and the
 * release_datetime_precision -> available timeframe rule — api-design.md
 * §11.1 / Phase 2 instruction §13.
 */

export type EconomicEventDbStatus = 'PENDING' | 'AVAILABLE' | 'PARTIAL' | 'UNAVAILABLE';
export type ReactionDbStatus = 'PENDING' | 'AVAILABLE' | 'UNAVAILABLE';
export type ApiDataStatus = 'READY' | 'DATA_PENDING' | 'DATA_UNAVAILABLE' | 'NOT_ANALYZABLE';

export function mapEventDataStatus(status: EconomicEventDbStatus): ApiDataStatus {
  switch (status) {
    case 'AVAILABLE':
      return 'READY';
    case 'PENDING':
    case 'PARTIAL':
      return 'DATA_PENDING';
    case 'UNAVAILABLE':
      return 'DATA_UNAVAILABLE';
  }
}

export function mapReactionDataStatus(status: ReactionDbStatus): ApiDataStatus {
  switch (status) {
    case 'AVAILABLE':
      return 'READY';
    case 'PENDING':
      return 'DATA_PENDING';
    case 'UNAVAILABLE':
      return 'DATA_UNAVAILABLE';
  }
}

export type ReleaseDatetimePrecision = 'EXACT' | 'APPROXIMATE' | 'DATE_ONLY' | 'UNKNOWN';
export type Timeframe = '1m' | '5m' | '15m' | '30m' | '60m';

const ALL_TIMEFRAMES: readonly Timeframe[] = ['1m', '5m', '15m', '30m', '60m'];

const EXCLUDED_BY_PRECISION: Record<ReleaseDatetimePrecision, readonly Timeframe[]> = {
  EXACT: [],
  APPROXIMATE: ['1m'],
  DATE_ONLY: ['1m', '5m'],
  UNKNOWN: ['1m', '5m'],
};

export function availableTimeframes(precision: ReleaseDatetimePrecision): Timeframe[] {
  const excluded = new Set<Timeframe>(EXCLUDED_BY_PRECISION[precision]);
  return ALL_TIMEFRAMES.filter((timeframe) => !excluded.has(timeframe));
}

/**
 * A timeframe excluded by release_datetime_precision is NOT_ANALYZABLE
 * regardless of what the stored reaction row's data_status says — the
 * precision-based exclusion always takes priority.
 */
export function resolveTimeframeAnalysisStatus(
  timeframe: Timeframe,
  precision: ReleaseDatetimePrecision,
  reactionDbStatus: ReactionDbStatus,
): ApiDataStatus {
  if (!availableTimeframes(precision).includes(timeframe)) {
    return 'NOT_ANALYZABLE';
  }
  return mapReactionDataStatus(reactionDbStatus);
}
