import type { ApiDataStatus, Timeframe } from './dataQuality.js';
import { MAJOR_FX_PAIR_ORDER, MAJOR_FX_REACTIONS_MAX, type MajorFxCandidatePair } from './majorFxReactions.js';
import { calculateMaxExcursion, calculateReaction } from './reaction.js';

/**
 * 要人発言の値動き (HQ指示 2026-10-15、api-design.md §14.8〜§14.11 v1.28)。
 *
 * Unlike economic events (event_price_reactions, written by the Ingestion
 * Worker), speeches have no stored reaction rows: the API computes them on
 * the fly from the real 1-minute candles in fx_prices around
 * speech_events.statement_datetime. Nothing is ever filled in — a missing
 * candle makes the value null (analysis_status DATA_UNAVAILABLE).
 *
 * fx_prices.timestamp is the candle's OPEN time (db-design.md §3.11), so a
 * 1m candle stamped t closes at t + 1 min. "The price at time X" is the
 * close of the 1m candle that closes at X (stamped X − 1 min) — the same
 * rule the seed's event reaction follows (release 12:30 → pre = close of
 * the 12:29 candle, 1m = close of the 12:30 candle).
 */

export const SPEECH_SUMMARY_TIMEFRAMES = ['1m', '5m', '15m'] as const satisfies readonly Timeframe[];
export const SPEECH_REACTION_TIMEFRAMES = ['1m', '5m', '15m', '30m', '60m'] as const satisfies readonly Timeframe[];
export type SpeechReactionTimeframe = (typeof SPEECH_REACTION_TIMEFRAMES)[number];

/** The pre-statement price must come from a candle closing at most this long before the statement. */
export const PRE_STATEMENT_LOOKBACK_MINUTES = 15;

const MINUTE_MS = 60_000;

export const TIMEFRAME_MINUTES: Readonly<Record<SpeechReactionTimeframe, number>> = {
  '1m': 1,
  '5m': 5,
  '15m': 15,
  '30m': 30,
  '60m': 60,
};

/** pip size from the symbol: JPY-quoted pairs 0.01 (pips = ×100), others 0.0001 (×10000). */
export function pipSizeForSymbol(symbol: string): number {
  return symbol.toUpperCase().endsWith('JPY') ? 0.01 : 0.0001;
}

/** Major order for speeches: the event major order, then other liquid crosses; anything else by symbol. */
export const SPEECH_FX_PAIR_ORDER = [
  ...MAJOR_FX_PAIR_ORDER,
  'EURGBP',
  'EURCHF',
  'CHFJPY',
  'NZDUSD',
  'NZDJPY',
  'EURAUD',
] as const;

function speechPairRank(symbol: string): number {
  const index = (SPEECH_FX_PAIR_ORDER as readonly string[]).indexOf(symbol);
  return index === -1 ? SPEECH_FX_PAIR_ORDER.length : index;
}

/**
 * At most 4 active pairs containing the speaker's currency, majors first:
 * USD → USDJPY, EURUSD, GBPUSD, AUDUSD; JPY → USDJPY, EURJPY, GBPJPY, AUDJPY;
 * EUR → EURUSD, EURJPY, EURGBP, … No pair contains the currency → [].
 */
export function selectSpeechFxPairs(
  activePairs: readonly MajorFxCandidatePair[],
  currencyCode: string,
): { fx_pair_id: string; symbol: string }[] {
  return activePairs
    .filter((pair) => pair.base_currency === currencyCode || pair.quote_currency === currencyCode)
    .sort((a, b) => {
      const rank = speechPairRank(a.symbol) - speechPairRank(b.symbol);
      if (rank !== 0) return rank;
      return a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0;
    })
    .slice(0, MAJOR_FX_REACTIONS_MAX)
    .map(({ fx_pair_id, symbol }) => ({ fx_pair_id, symbol }));
}

/** A 1m fx_prices row (timestamp = open time). */
export interface PriceCandle {
  timestamp: string;
  high: number;
  low: number;
  close: number;
}

/** Exported for reuse by economicEventReactions.ts (same open→close conversion, same rule). */
export function closeTimeMs(candle: PriceCandle): number {
  return Date.parse(candle.timestamp) + MINUTE_MS;
}

/** The 1m candles to read for a speech: [T − lookback, T + maxMinutes − 1 min] by open time (inclusive). */
export function speechCandleRange(statementDatetime: string, maxMinutes: number): { from: string; to: string } {
  const statement = Date.parse(statementDatetime);
  return {
    from: new Date(statement - PRE_STATEMENT_LOOKBACK_MINUTES * MINUTE_MS).toISOString(),
    to: new Date(statement + (maxMinutes - 1) * MINUTE_MS).toISOString(),
  };
}

/** Close of the last 1m candle closing at or before the statement (within the lookback), or null. */
export function selectPreStatementPrice(candles: readonly PriceCandle[], statementDatetime: string): number | null {
  const statement = Date.parse(statementDatetime);
  const earliest = statement - PRE_STATEMENT_LOOKBACK_MINUTES * MINUTE_MS;
  let best: PriceCandle | null = null;
  for (const candle of candles) {
    const closeAt = closeTimeMs(candle);
    if (closeAt > statement || closeAt <= earliest) continue;
    if (!best || closeAt > closeTimeMs(best)) best = candle;
  }
  return best ? Number(best.close) : null;
}

/** Close of the 1m candle that closes at `atMs` (for a non-minute-aligned time: the one closing in (at − 1 min, at]), or null. */
export function selectPriceAt(candles: readonly PriceCandle[], atMs: number): number | null {
  const candle = candles.find((row) => {
    const closeAt = closeTimeMs(row);
    return closeAt <= atMs && closeAt > atMs - MINUTE_MS;
  });
  return candle ? Number(candle.close) : null;
}

/** Exported for reuse by economicEventReactions.ts (identical rounding rule). */
export function round(value: number | null, digits: number): number | null {
  if (value === null) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** speech_events.status: 'SCHEDULED' | 'DELIVERED' | 'CANCELLED' (a plain string, as the repository returns it). */
export type SpeechStatus = string;

export interface SpeechTimeframeReaction {
  timeframe: SpeechReactionTimeframe;
  post_release_price: number | null;
  movement: number | null;
  pips: number | null;
  change_percent: number | null;
  max_upward: number | null;
  max_downward: number | null;
  max_upward_pips: number | null;
  max_downward_pips: number | null;
  analysis_status: ApiDataStatus;
}

export interface SpeechPairReaction {
  /** Named like the event reaction (GET /events/{id}/reaction) so the same decoder works. */
  pre_release_price: number | null;
  reactions: SpeechTimeframeReaction[];
}

function emptyReaction(timeframe: SpeechReactionTimeframe, status: ApiDataStatus): SpeechTimeframeReaction {
  return {
    timeframe,
    post_release_price: null,
    movement: null,
    pips: null,
    change_percent: null,
    max_upward: null,
    max_downward: null,
    max_upward_pips: null,
    max_downward_pips: null,
    analysis_status: status,
  };
}

/**
 * The reaction of one pair to one speech, per timeframe:
 * - time_precision not EXACT (publication time only, e.g. a podcast) → all null, NOT_ANALYZABLE;
 * - not DELIVERED → all null; SCHEDULED = DATA_PENDING, CANCELLED = NOT_ANALYZABLE;
 * - DELIVERED, T + N still in the future → DATA_PENDING (null);
 * - DELIVERED, the pre-statement or the T + N candle missing → DATA_UNAVAILABLE (null);
 * - otherwise READY: movement / pips / change_percent (src/domain/reaction.ts) and the
 *   max excursion over the highs/lows of the 1m candles closing in (T, T + N].
 * pips are rounded to 0.1 (a pipette — the finest step real quotes have), prices and
 * movements to 6 decimals (fx_prices numeric(12,6)), change_percent to 4.
 */
export function computeSpeechPairReaction(input: {
  status: SpeechStatus;
  /** speech_events.time_precision. Not EXACT (only the publication time is known) → NOT_ANALYZABLE. Omitted = EXACT. */
  timePrecision?: string | undefined;
  statementDatetime: string;
  symbol: string;
  candles: readonly PriceCandle[];
  timeframes: readonly SpeechReactionTimeframe[];
  now: Date;
}): SpeechPairReaction {
  const { status, statementDatetime, symbol, candles, timeframes, now } = input;
  if ((input.timePrecision ?? 'EXACT') !== 'EXACT') {
    // 発言の時刻が確かめられない(公開の時刻だけ)。HQ判断 2026-10-28: 相場反応の計算の対象外
    return { pre_release_price: null, reactions: timeframes.map((tf) => emptyReaction(tf, 'NOT_ANALYZABLE')) };
  }
  if (status !== 'DELIVERED') {
    const notDelivered: ApiDataStatus = status === 'CANCELLED' ? 'NOT_ANALYZABLE' : 'DATA_PENDING';
    return { pre_release_price: null, reactions: timeframes.map((tf) => emptyReaction(tf, notDelivered)) };
  }

  const statement = Date.parse(statementDatetime);
  const pipSize = pipSizeForSymbol(symbol);
  const preReleasePrice = selectPreStatementPrice(candles, statementDatetime);

  const reactions = timeframes.map((timeframe) => {
    const endMs = statement + TIMEFRAME_MINUTES[timeframe] * MINUTE_MS;
    if (endMs > now.getTime()) return emptyReaction(timeframe, 'DATA_PENDING');

    const postReleasePrice = selectPriceAt(candles, endMs);
    if (preReleasePrice === null || postReleasePrice === null) return emptyReaction(timeframe, 'DATA_UNAVAILABLE');

    const { movement, pips, changePercent } = calculateReaction({ preReleasePrice, postReleasePrice, pipSize });
    const inWindow = candles.filter((candle) => {
      const closeAt = closeTimeMs(candle);
      return closeAt > statement && closeAt <= endMs;
    });
    const excursion = calculateMaxExcursion({
      preReleasePrice,
      pricesInWindow: inWindow.flatMap((candle) => [Number(candle.high), Number(candle.low)]),
      pipSize,
    });

    return {
      timeframe,
      post_release_price: postReleasePrice,
      movement: round(movement, 6),
      pips: round(pips, 1),
      change_percent: round(changePercent, 4),
      max_upward: round(excursion.maxUpward, 6),
      max_downward: round(excursion.maxDownward, 6),
      max_upward_pips: round(excursion.maxUpwardPips, 1),
      max_downward_pips: round(excursion.maxDownwardPips, 1),
      analysis_status: 'READY' as const,
    };
  });

  return { pre_release_price: preReleasePrice, reactions };
}

/** `{ "1m": pips|null, "5m": …, "15m": … }` — GET /speeches/{id} `reactions[].pips` and the comparison table. */
export function pipsByTimeframe(reaction: SpeechPairReaction): Record<string, number | null> {
  const pips: Record<string, number | null> = {};
  for (const timeframe of SPEECH_SUMMARY_TIMEFRAMES) {
    pips[timeframe] = reaction.reactions.find((row) => row.timeframe === timeframe)?.pips ?? null;
  }
  return pips;
}
