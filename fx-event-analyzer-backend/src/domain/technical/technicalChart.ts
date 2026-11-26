/**
 * Pure assembly of the technical-analysis API payload from canonical bars (no DB, no HTTP).
 * Everything numeric comes from the engine in this folder; this file only maps timeframes, windows
 * and shapes. Candles carry the NY17 convention (4h/1d); indicators are computed on the returned
 * window only (the first `period-1` values are null warm-up; no extra history is read for warm-up).
 */
import { atr, bollinger, ema, macd, rsi, sma, stochastic } from './indicators.js';
import { detectKeyZones } from './keyZones.js';
import { nyLocal } from './nyTime.js';
import { type Candle, resample, TIMEFRAME_MS, type Timeframe } from './resample.js';
import type { CanonicalBar } from './barSource.js';
import type { Bar, Series } from './types.js';

export type ApiTimeframe = '5m' | '15m' | '30m' | '60m' | '4h' | '1d';

export interface TimeframePlan {
  /** Engine timeframe of the stored bars that are read. */
  source: Timeframe;
  /** Engine timeframe of the returned candles. */
  target: Timeframe;
  /** Stored bars needed per returned candle (upper bound). */
  ratio: number;
}

/** API name -> engine plan. 4h / 1d are resampled from the stored 60m ('1h') bars with the NY17 convention. */
export const TIMEFRAME_PLANS: Record<ApiTimeframe, TimeframePlan> = {
  '5m': { source: '5m', target: '5m', ratio: 1 },
  '15m': { source: '15m', target: '15m', ratio: 1 },
  '30m': { source: '30m', target: '30m', ratio: 1 },
  '60m': { source: '1h', target: '1h', ratio: 1 },
  '4h': { source: '1h', target: '4h', ratio: 4 },
  '1d': { source: '1h', target: '1D', ratio: 24 },
};

/** Technical limit: max stored rows read per request (bounds DB work on the free tier). */
export const TECHNICAL_MAX_SOURCE_ROWS = 10_000;

const WEEK_MS = 7 * 86_400_000;

/** Rows to read for `limit` candles: one spare candle for the partial head, capped. */
export function sourceRowBudget(plan: TimeframePlan, limit: number): number {
  return Math.min(TECHNICAL_MAX_SOURCE_ROWS, (limit + 1) * plan.ratio);
}

/** Generous lookback (weekends/holidays inflate the calendar span); the row cap is what actually bounds the read. */
export function lookbackMs(plan: TimeframePlan, limit: number): number {
  return Math.ceil(((limit + 1) * plan.ratio * TIMEFRAME_MS[plan.source] * 7) / 5) + 2 * WEEK_MS;
}

/** Candle count the row cap allows for this timeframe (the effective maximum `limit`). */
export function maxCandlesForPlan(plan: TimeframePlan): number {
  return Math.floor(TECHNICAL_MAX_SOURCE_ROWS / plan.ratio) - 1;
}

export interface IndicatorRequest {
  kind: 'sma' | 'ema' | 'rsi' | 'atr' | 'macd' | 'bollinger' | 'stoch';
  period?: number;
  key: string;
}

export type IndicatorOutput = Series | Record<string, Series>;

const round = (x: number | null): number | null => (x === null ? null : Math.round(x * 1e6) / 1e6);
const roundSeries = (s: Series): Series => s.map(round);

export function computeIndicator(req: IndicatorRequest, candles: readonly Candle[]): IndicatorOutput {
  const bars: Bar[] = candles.map((c) => ({ t: c.t, o: c.o, h: c.h, l: c.l, c: c.c }));
  const closes = candles.map((c) => c.c);
  switch (req.kind) {
    case 'sma':
      return roundSeries(sma(closes, req.period!));
    case 'ema':
      return roundSeries(ema(closes, req.period!));
    case 'rsi':
      return roundSeries(rsi(closes, req.period));
    case 'atr':
      return roundSeries(atr(bars, req.period));
    case 'macd': {
      const r = macd(closes);
      return { macd: roundSeries(r.macd), signal: roundSeries(r.signal), histogram: roundSeries(r.histogram) };
    }
    case 'bollinger': {
      const r = bollinger(closes);
      return { middle: roundSeries(r.middle), upper: roundSeries(r.upper), lower: roundSeries(r.lower) };
    }
    case 'stoch': {
      const r = stochastic(bars);
      return { k: roundSeries(r.k), d: roundSeries(r.d) };
    }
  }
}

export interface ChartZone {
  kind: 'support' | 'resistance' | 'at_price';
  lower: number;
  upper: number;
  center: number;
  touches: number;
  high_touches: number;
  low_touches: number;
  first_t: string;
  last_t: string;
}

export interface GapSummary {
  /** Stored bars expected inside the window (candles' expectedBars for 4h/1d; candles + missing for intraday). */
  expectedSourceBars: number;
  sourceBarCount: number;
  hasGaps: boolean;
}

function isFridayCloseToSundayOpen(prevEnd: number, nextT: number): boolean {
  const a = nyLocal(prevEnd);
  const b = nyLocal(nextT);
  const dowA = new Date(Date.UTC(a.y, a.m - 1, a.d)).getUTCDay();
  const dowB = new Date(Date.UTC(b.y, b.m - 1, b.d)).getUTCDay();
  return dowA === 5 && a.h >= 17 && dowB === 0 && b.h >= 17 && nextT - prevEnd < 3 * 86_400_000;
}

/** Gap summary. Weekend closure (Fri 17:00 NY to Sun 17:00 NY) is not a gap; other missing bars are. */
export function summarizeGaps(candles: readonly Candle[], plan: TimeframePlan): GapSummary {
  if (plan.target === '4h' || plan.target === '1D') {
    const expected = candles.reduce((s, c) => s + c.expectedBars, 0);
    const count = candles.reduce((s, c) => s + c.barCount, 0);
    return { expectedSourceBars: expected, sourceBarCount: count, hasGaps: candles.some((c) => c.hasGaps) };
  }
  const step = TIMEFRAME_MS[plan.target];
  let missing = 0;
  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1]!;
    const cur = candles[i]!;
    const skipped = Math.round((cur.t - prev.t) / step) - 1;
    if (skipped > 0 && !isFridayCloseToSundayOpen(prev.t + step, cur.t)) missing += skipped;
  }
  return { expectedSourceBars: candles.length + missing, sourceBarCount: candles.length, hasGaps: missing > 0 };
}

export interface TechnicalChart {
  candles: Candle[];
  indicators: Record<string, IndicatorOutput>;
  keyZones: ChartZone[];
  gaps: GapSummary;
  partialLast: boolean;
}

/**
 * bars (ascending, stored timeframe of `plan.source`) -> last `limit` candles + indicators + zones.
 * `dropHead` discards the first candle when the read was cut by the row cap (its bucket may be incomplete).
 */
export function buildTechnicalChart(
  bars: readonly CanonicalBar[],
  plan: TimeframePlan,
  limit: number,
  requests: readonly IndicatorRequest[],
  dropHead: boolean,
): TechnicalChart {
  let candles = resample(bars, plan.source, plan.target, { convention: 'ny17' });
  if (dropHead && plan.ratio > 1) candles = candles.slice(1);
  candles = candles.slice(-limit);

  const indicators: Record<string, IndicatorOutput> = {};
  for (const req of requests) indicators[req.key] = computeIndicator(req, candles);

  const engineBars: Bar[] = candles.map((c) => ({ t: c.t, o: c.o, h: c.h, l: c.l, c: c.c }));
  const lastClose = candles.length ? candles[candles.length - 1]!.c : NaN;
  const keyZones: ChartZone[] = detectKeyZones(engineBars).map((z) => ({
    kind: z.upper <= lastClose ? 'support' : z.lower >= lastClose ? 'resistance' : 'at_price',
    lower: round(z.lower) as number,
    upper: round(z.upper) as number,
    center: round(z.center) as number,
    touches: z.touches,
    high_touches: z.highTouches,
    low_touches: z.lowTouches,
    first_t: new Date(candles[z.firstIndex]!.t).toISOString(),
    last_t: new Date(candles[z.lastIndex]!.t).toISOString(),
  }));

  return {
    candles,
    indicators,
    keyZones,
    gaps: summarizeGaps(candles, plan),
    partialLast: candles.length > 0 && candles[candles.length - 1]!.partial,
  };
}
