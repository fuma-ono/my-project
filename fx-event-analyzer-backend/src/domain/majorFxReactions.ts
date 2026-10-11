import {
  resolveTimeframeAnalysisStatus,
  type ApiDataStatus,
  type ReactionDbStatus,
  type ReleaseDatetimePrecision,
  type Timeframe,
} from './dataQuality.js';

/**
 * SCR-007 イベント詳細「主要通貨ペアの値動き(pips)」— GET /events/{id}
 * `major_fx_reactions` (api-design.md §14.1, v1.17).
 */
export const MAJOR_FX_REACTIONS_MAX = 4;
export const MAJOR_FX_REACTION_TIMEFRAMES = ['1m', '5m', '15m'] as const satisfies readonly Timeframe[];

/** Fixed "major" order used after the indicator's related pairs; anything else follows by symbol. */
export const MAJOR_FX_PAIR_ORDER = [
  'USDJPY',
  'EURUSD',
  'GBPUSD',
  'AUDUSD',
  'USDCHF',
  'USDCAD',
  'EURJPY',
  'GBPJPY',
  'AUDJPY',
  'CADJPY',
] as const;

export interface MajorFxCandidatePair {
  fx_pair_id: string;
  symbol: string;
  base_currency: string;
  quote_currency: string;
}

export interface MajorFxRelatedPair {
  fx_pair_id: string;
  symbol: string;
  priority: number;
}

export interface SelectedMajorFxPair {
  fx_pair_id: string;
  symbol: string;
}

function majorRank(symbol: string): number {
  const index = (MAJOR_FX_PAIR_ORDER as readonly string[]).indexOf(symbol);
  return index === -1 ? MAJOR_FX_PAIR_ORDER.length : index;
}

/**
 * Picks at most MAJOR_FX_REACTIONS_MAX pairs for the event:
 * - candidates: active pairs whose base or quote currency is the event's currency;
 * - order: candidates that are the indicator's related pairs first (by priority),
 *   then the rest by MAJOR_FX_PAIR_ORDER, then by symbol;
 * - no candidate at all: the related pairs (by priority) instead.
 */
export function selectMajorFxPairs(
  activePairs: readonly MajorFxCandidatePair[],
  relatedPairs: readonly MajorFxRelatedPair[],
  currencyCode: string,
): SelectedMajorFxPair[] {
  const relatedByPriority = [...relatedPairs].sort((a, b) => a.priority - b.priority);
  const candidates = activePairs.filter(
    (pair) => pair.base_currency === currencyCode || pair.quote_currency === currencyCode,
  );

  if (candidates.length === 0) {
    return relatedByPriority.slice(0, MAJOR_FX_REACTIONS_MAX).map(({ fx_pair_id, symbol }) => ({ fx_pair_id, symbol }));
  }

  const candidateIds = new Set(candidates.map((pair) => pair.fx_pair_id));
  const related = relatedByPriority.filter((pair) => candidateIds.has(pair.fx_pair_id));
  const relatedIds = new Set(related.map((pair) => pair.fx_pair_id));
  const others = candidates
    .filter((pair) => !relatedIds.has(pair.fx_pair_id))
    .sort((a, b) => {
      const rank = majorRank(a.symbol) - majorRank(b.symbol);
      if (rank !== 0) return rank;
      return a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0;
    });

  return [...related, ...others]
    .slice(0, MAJOR_FX_REACTIONS_MAX)
    .map(({ fx_pair_id, symbol }) => ({ fx_pair_id, symbol }));
}

export interface MajorFxReactionRow {
  fx_pair_id: string;
  timeframe: string;
  pips: number | null;
  change_percent: number | null;
  data_status: string;
}

export interface MajorFxReaction {
  fx_pair_id: string;
  symbol: string;
  reactions: {
    timeframe: (typeof MAJOR_FX_REACTION_TIMEFRAMES)[number];
    pips: number | null;
    change_percent: number | null;
    analysis_status: ApiDataStatus;
  }[];
}

/**
 * Maps stored event_price_reactions rows onto the selected pairs × 1m/5m/15m,
 * exactly like related_fx_pairs[].reaction and GET /events/{id}/reaction do:
 * a missing row is DATA_PENDING with null values, and a timeframe excluded by
 * release_datetime_precision is NOT_ANALYZABLE.
 */
export function buildMajorFxReactions(
  pairs: readonly SelectedMajorFxPair[],
  rows: readonly MajorFxReactionRow[],
  precision: ReleaseDatetimePrecision,
): MajorFxReaction[] {
  const rowByKey = new Map(rows.map((row) => [`${row.fx_pair_id}|${row.timeframe}`, row]));
  return pairs.map((pair) => ({
    fx_pair_id: pair.fx_pair_id,
    symbol: pair.symbol,
    reactions: MAJOR_FX_REACTION_TIMEFRAMES.map((timeframe) => {
      const row = rowByKey.get(`${pair.fx_pair_id}|${timeframe}`);
      return {
        timeframe,
        pips: row?.pips ?? null,
        change_percent: row?.change_percent ?? null,
        analysis_status: resolveTimeframeAnalysisStatus(
          timeframe,
          precision,
          (row?.data_status as ReactionDbStatus | undefined) ?? 'PENDING',
        ),
      };
    }),
  }));
}
