import { calendarDaysBack, isWeekend, nyWall, nyWallToUtcMs, wallClockIn } from './nyClock.js';
import type { ReactionParams } from './params.js';
import { MS_PER_MINUTE } from './time.js';

/**
 * Baseline volatility sigma (the "noise" scale of 1-minute closes) for one event, no look-ahead.
 *
 * Port of the Python reference (analysis/clf2.py `sigma`, clock = 'NY'). Bars are a map from the minute index
 * (floor(open time ms / 60000)) to the bar's close; a missing bar is simply absent and is never interpolated.
 *
 * sigma_own   = RMS of the 1-minute close changes of the lookback window that ended at T (bars closing <= T only).
 * sigma_typ   = quadratic mean of the same statistic over earlier NY weekday sessions at the same NY wall time
 *               (DST-correct; nonexistent / ambiguous local times skipped).
 * sigma       = max(sigma_own, sigma_typ); only sigma_own when sigma_typ is unavailable; none when sigma_own is.
 * Every number comes from ReactionParams.baseline (no literals here).
 */
export type BarCloses = ReadonlyMap<number, number>;

export interface BaselineResult {
  sigma: number | null;
  own: number | null;
  typical: number | null;
  source: 'MAX_OWN_TYPICAL' | 'OWN_ONLY' | 'NONE';
  /** Sessions that contributed to the typical sigma. */
  sessionsUsed: number;
  /** Of those, how many show a different London wall-clock time than T (reference information for EU/UK events). */
  clockMismatchSessions: number;
}

export const minuteIndexOf = (utcMs: number): number => Math.floor(utcMs / MS_PER_MINUTE);

/** RMS of the close-to-close changes of the `lookback` bars that end at (the close of) minute index tEnd - 1. */
export function changesRms(bars: BarCloses, tEnd: number, lookback: number, minValid: number): number | null {
  let sumSq = 0;
  let count = 0;
  for (let k = tEnd - lookback; k < tEnd; k++) {
    const now = bars.get(k);
    const before = bars.get(k - 1);
    if (now !== undefined && before !== undefined) {
      const change = now - before;
      sumSq += change * change;
      count += 1;
    }
  }
  if (count < minValid || count === 0) return null;
  return Math.sqrt(sumSq / count);
}

/** UTC minute indexes of the same NY wall-clock time on earlier NY weekdays (nearest first). */
export function nySessionMinutes(tMin: number, params: ReactionParams): number[] {
  const wall = nyWall(tMin * MS_PER_MINUTE);
  const out: number[] = [];
  for (let back = 1; back <= params.baseline.typical_lookback_days; back++) {
    const day = calendarDaysBack(wall.y, wall.m, wall.d, back);
    if (isWeekend(day.weekday)) continue;
    const utcMs = nyWallToUtcMs({ y: day.y, m: day.m, d: day.d, h: wall.h, mi: wall.mi });
    if (utcMs === null) continue;
    out.push(minuteIndexOf(utcMs));
  }
  return out;
}

export function computeBaseline(bars: BarCloses, tMin: number, params: ReactionParams): BaselineResult {
  const b = params.baseline;
  const own = changesRms(bars, tMin, b.lookback_minutes, b.min_valid_changes);
  const values: number[] = [];
  const used: number[] = [];
  for (const session of nySessionMinutes(tMin, params)) {
    if (values.length >= b.typical_max_sessions) break;
    const v = changesRms(bars, session, b.lookback_minutes, b.min_valid_changes);
    if (v !== null) {
      values.push(v);
      used.push(session);
    }
  }
  const typical =
    values.length >= b.typical_min_sessions
      ? Math.sqrt(values.reduce((acc, v) => acc + v * v, 0) / values.length)
      : null;
  const tClock = wallClockIn(tMin * MS_PER_MINUTE, 'Europe/London');
  const clockMismatchSessions = used.filter((s) => wallClockIn(s * MS_PER_MINUTE, 'Europe/London') !== tClock).length;
  const base = { sessionsUsed: values.length, clockMismatchSessions };
  if (own === null) return { sigma: null, own: null, typical, source: 'NONE', ...base };
  if (typical === null) return { sigma: own, own, typical: null, source: 'OWN_ONLY', ...base };
  return { sigma: Math.max(own, typical), own, typical, source: 'MAX_OWN_TYPICAL', ...base };
}

export interface MinuteRange {
  /** First minute index (inclusive). */
  from: number;
  /** End minute index (exclusive). */
  to: number;
}

function mergeRanges(ranges: readonly MinuteRange[]): MinuteRange[] {
  const sorted = [...ranges].sort((a, b) => a.from - b.from || a.to - b.to);
  const merged: MinuteRange[] = [];
  for (const r of sorted) {
    const last = merged[merged.length - 1];
    if (last && r.from <= last.to) last.to = Math.max(last.to, r.to);
    else merged.push({ ...r });
  }
  return merged;
}

/**
 * The bar-open minute ranges one event needs: the path c_0..c_n (bars opening T-1 .. T+n-1), the own baseline window and
 * the candidate sessions' windows (each needs the bar before its window too). Read exactly these, nothing else.
 */
export function requiredMinuteRanges(tMin: number, params: ReactionParams, pathMinutes: number): MinuteRange[] {
  const lookback = params.baseline.lookback_minutes;
  const windowBefore = (end: number): MinuteRange => ({ from: end - lookback - 1, to: end });
  return mergeRanges([
    { from: tMin - 1, to: tMin + pathMinutes },
    windowBefore(tMin),
    ...nySessionMinutes(tMin, params).map(windowBefore),
  ]);
}
