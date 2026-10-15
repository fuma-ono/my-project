/**
 * FX candle validation and ③ vs ⑤ cross-check (data-sources.md §6.4).
 * Nothing is ever filled in: a missing minute stays missing, and a
 * questionable minute is stored as UNVERIFIED (the Read API ignores it, so
 * anything computed from it becomes DATA_UNAVAILABLE).
 */
import { toPips } from '../mappings/fxPairs.js';
import { isMinuteAligned } from '../time.js';
import type { NormalizedCandle } from '../types.js';
import { roundTo } from '../values.js';

export type CandleRejectReason = 'NOT_MINUTE_ALIGNED' | 'INCOMPLETE' | 'INVALID_OHLC' | 'CONFLICTING_DUPLICATE';

export interface CheckedCandle {
  candle: NormalizedCandle;
  verificationStatus: 'VERIFIED' | 'SINGLE_SOURCE' | 'UNVERIFIED';
  crossCheckClose: number | null;
  crossCheckDiffPips: number | null;
  notes: string[];
}

export interface CandleCheckResult {
  accepted: CheckedCandle[];
  rejected: { candle: NormalizedCandle; reason: CandleRejectReason }[];
}

function validOhlc(c: NormalizedCandle): boolean {
  const values = [c.open, c.high, c.low, c.close];
  if (!values.every((v) => Number.isFinite(v) && v > 0)) return false;
  return c.low <= Math.min(c.open, c.close) && c.high >= Math.max(c.open, c.close);
}

function sameCandle(a: NormalizedCandle, b: NormalizedCandle): boolean {
  return a.open === b.open && a.high === b.high && a.low === b.low && a.close === b.close;
}

/**
 * Validates primary candles and, when `secondary` is given, marks each
 * minute VERIFIED (|close diff| ≤ maxDiffPips), UNVERIFIED (above), or
 * SINGLE_SOURCE (the secondary has no candle for that minute).
 */
export function checkCandles(
  primary: readonly NormalizedCandle[],
  options: {
    pipSize: number;
    now: Date;
    maxJumpPips: number;
    secondary?: readonly NormalizedCandle[];
    maxDiffPips: number;
  },
): CandleCheckResult {
  const rejected: CandleCheckResult['rejected'] = [];
  const byMinute = new Map<string, NormalizedCandle>();
  const conflicted = new Set<string>();
  for (const candle of primary) {
    if (!isMinuteAligned(candle.openTime)) {
      rejected.push({ candle, reason: 'NOT_MINUTE_ALIGNED' });
      continue;
    }
    // The candle is complete only once its minute has fully passed.
    if (Date.parse(candle.openTime) + 60_000 > options.now.getTime()) {
      rejected.push({ candle, reason: 'INCOMPLETE' });
      continue;
    }
    if (!validOhlc(candle)) {
      rejected.push({ candle, reason: 'INVALID_OHLC' });
      continue;
    }
    const key = new Date(candle.openTime).toISOString();
    const existing = byMinute.get(key);
    if (existing && !sameCandle(existing, candle)) conflicted.add(key);
    byMinute.set(key, candle);
  }
  for (const key of conflicted) {
    rejected.push({ candle: byMinute.get(key)!, reason: 'CONFLICTING_DUPLICATE' });
    byMinute.delete(key);
  }

  const secondaryByMinute = new Map<string, NormalizedCandle>();
  for (const candle of options.secondary ?? []) {
    if (isMinuteAligned(candle.openTime) && validOhlc(candle)) {
      secondaryByMinute.set(new Date(candle.openTime).toISOString(), candle);
    }
  }

  const sorted = [...byMinute.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
  const accepted: CheckedCandle[] = [];
  let previous: NormalizedCandle | null = null;
  let previousKey: string | null = null;
  for (const [key, candle] of sorted) {
    const notes: string[] = [];
    let status: CheckedCandle['verificationStatus'] = 'SINGLE_SOURCE';
    let crossCheckClose: number | null = null;
    let crossCheckDiffPips: number | null = null;

    const other = secondaryByMinute.get(key);
    if (other) {
      crossCheckClose = other.close;
      crossCheckDiffPips = roundTo(toPips(candle.close - other.close, options.pipSize), 2);
      status = Math.abs(crossCheckDiffPips) <= options.maxDiffPips ? 'VERIFIED' : 'UNVERIFIED';
      if (status === 'UNVERIFIED') notes.push('CROSS_CHECK_DIFF');
    }
    // Jump check only against the immediately preceding minute (no comparison across gaps).
    if (previous && previousKey && Date.parse(key) - Date.parse(previousKey) === 60_000) {
      const jump = Math.abs(toPips(candle.open - previous.close, options.pipSize));
      if (jump > options.maxJumpPips) {
        status = 'UNVERIFIED';
        notes.push('PRICE_JUMP');
      }
    }
    accepted.push({ candle, verificationStatus: status, crossCheckClose, crossCheckDiffPips, notes });
    previous = candle;
    previousKey = key;
  }
  return { accepted, rejected };
}

/** Candles usable for reaction calculations: UNVERIFIED minutes count as missing (never interpolated). */
export function usableForReactions<T extends { verification_status?: string | null }>(rows: readonly T[]): T[] {
  return rows.filter((row) => row.verification_status !== 'UNVERIFIED');
}
