/**
 * HQ判断 2026-10-27「相場反応のバックフィル: 取得可能性の確認」。Twelve Data から過去の1分足を少しだけ取り、
 * 日時・タイムゾーン・欠損・品質を確かめるための集計(純粋関数)。DB には何も書かない。
 * ジョブは src/jobs/probeFxHistory.ts。
 */
import type { NormalizedCandle } from './types.js';

const MINUTE_MS = 60_000;

export interface ProbeWindowStats {
  symbol: string;
  from: string;
  to: string;
  /** Minutes in [from, to). Forex trades 24h on weekdays, so a weekday window should be full. */
  expectedMinutes: number;
  candles: number;
  missingMinutes: number;
  duplicateMinutes: number;
  /** Candles whose open time is not on a whole minute, or outside [from, to). */
  misalignedCandles: number;
  /** high < max(open, close) or low > min(open, close) or low > high. */
  inconsistentOhlc: number;
  first: string | null;
  last: string | null;
}

export function summarizeProbeWindow(
  symbol: string,
  range: { from: string; to: string },
  candles: readonly NormalizedCandle[],
): ProbeWindowStats {
  const from = Date.parse(range.from);
  const to = Date.parse(range.to);
  const seen = new Set<number>();
  let duplicateMinutes = 0;
  let misalignedCandles = 0;
  let inconsistentOhlc = 0;
  for (const c of candles) {
    const t = Date.parse(c.openTime);
    if (t % MINUTE_MS !== 0 || t < from || t >= to) misalignedCandles += 1;
    if (seen.has(t)) duplicateMinutes += 1;
    seen.add(t);
    if (c.low > c.high || c.high < Math.max(c.open, c.close) || c.low > Math.min(c.open, c.close)) {
      inconsistentOhlc += 1;
    }
  }
  const expectedMinutes = Math.max(0, Math.round((to - from) / MINUTE_MS));
  let present = 0;
  for (let t = from; t < to; t += MINUTE_MS) if (seen.has(t)) present += 1;
  const times = [...seen].sort((a, b) => a - b);
  return {
    symbol,
    from: range.from,
    to: range.to,
    expectedMinutes,
    candles: candles.length,
    missingMinutes: expectedMinutes - present,
    duplicateMinutes,
    misalignedCandles,
    inconsistentOhlc,
    first: times.length > 0 ? new Date(times[0]!).toISOString() : null,
    last: times.length > 0 ? new Date(times[times.length - 1]!).toISOString() : null,
  };
}

export interface ProbeComparison {
  /** Minutes present in both the API response and the DB (fx_prices, same provider). */
  overlapMinutes: number;
  /** Of those, minutes whose close differs by more than `tolerance`. */
  closeMismatches: number;
  maxCloseDiff: number;
}

/** Compares freshly fetched candles with the stored ones (same minute = same open time in UTC). */
export function compareWithStored(
  fetched: readonly NormalizedCandle[],
  stored: readonly { timestamp: string; close: number | string }[],
  tolerance: number,
): ProbeComparison {
  const byTime = new Map(stored.map((row) => [Date.parse(row.timestamp), Number(row.close)]));
  let overlapMinutes = 0;
  let closeMismatches = 0;
  let maxCloseDiff = 0;
  for (const c of fetched) {
    const close = byTime.get(Date.parse(c.openTime));
    if (close === undefined) continue;
    overlapMinutes += 1;
    const diff = Math.abs(close - c.close);
    maxCloseDiff = Math.max(maxCloseDiff, diff);
    if (diff > tolerance) closeMismatches += 1;
  }
  return { overlapMinutes, closeMismatches, maxCloseDiff };
}
