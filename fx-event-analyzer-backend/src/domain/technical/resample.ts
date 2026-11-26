/**
 * Timeframe resampler: aggregates fixed-interval source bars (1m/5m/...) into coarser candles.
 *
 * Conventions (default `convention: 'ny17'`):
 *  - Targets up to 1h are aligned to UTC clock boundaries (New York's UTC offset is a whole number
 *    of hours, so this is also the New York clock alignment).
 *  - 1D = FX day: 17:00 New York (previous date) to 17:00 New York with automatic DST (see nyTime.ts):
 *    23h / 24h / 25h days. Candle t = the day's start instant. The Sunday 17:00 NY open starts
 *    Monday's daily bar; there is no Saturday bar.
 *  - 4h = six bars per FX day on NY wall-clock boundaries 17,21,01,05,09,13 (so 6x4h = 1D always;
 *    one bar is 3h / 5h on DST days). expectedBars reflects the real duration of each bucket.
 *  - `convention: 'utc'` keeps the older UTC-epoch alignment (4h at 00/04/.., 1D = UTC date) with an
 *    optional `anchorOffsetMs`; it exists for comparison/back-compat only.
 *  - Holidays, weekends and feed outages: empty buckets are NEVER synthesized. A thin session shows
 *    as barCount < expectedBars (hasGaps = true); nothing is filled or interpolated.
 *  - o = first bar's open, c = last bar's close, h/l = extremes, v = sum of volumes (absent if no
 *    source bar has a volume). `end` = exclusive bucket end.
 *  - `partial` is true only for the LAST candle when the source data does not reach the bucket end
 *    (still forming or truncated feed); the pre-weekend Friday candle also ends early, so use
 *    barCount/expectedBars/end to tell a live candle from a natural close.
 *  - Input must be strictly increasing in time and aligned to the source interval.
 */
import { fxDayContaining } from './nyTime.js';
import { type Bar, toEpochMs } from './types.js';

export type Timeframe = '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1D';

export const TIMEFRAME_MS: Record<Timeframe, number> = {
  '1m': 60_000,
  '5m': 300_000,
  '15m': 900_000,
  '30m': 1_800_000,
  '1h': 3_600_000,
  '4h': 14_400_000,
  '1D': 86_400_000,
};

export interface Candle {
  t: number;
  /** Exclusive end of the bucket (epoch ms). */
  end: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v?: number;
  barCount: number;
  expectedBars: number;
  /** barCount < expectedBars: bars are missing inside this bucket (holiday/thin session/outage). */
  hasGaps: boolean;
  partial: boolean;
}

export interface ResampleOptions {
  convention?: 'ny17' | 'utc';
  /** Only for convention 'utc'. */
  anchorOffsetMs?: number;
}

interface Bucket {
  start: number;
  end: number;
}

export function resample(
  bars: readonly Bar[],
  source: Timeframe,
  target: Timeframe,
  options: ResampleOptions = {},
): Candle[] {
  const convention = options.convention ?? 'ny17';
  const srcMs = TIMEFRAME_MS[source];
  const tgtMs = TIMEFRAME_MS[target];
  const offset = convention === 'utc' ? (options.anchorOffsetMs ?? 0) : 0;
  if (tgtMs < srcMs || tgtMs % srcMs !== 0) {
    throw new RangeError(`cannot resample ${source} into ${target}`);
  }
  const nyTarget = convention === 'ny17' && (target === '4h' || target === '1D');
  if (nyTarget && (source === '1D' || (source === '4h' && target !== '1D'))) {
    throw new RangeError(`cannot resample ${source} into ${target} with ny17 convention`);
  }
  const srcIs4hNy = nyTarget && source === '4h';

  const bucketOf = (t: number): Bucket => {
    if (!nyTarget) {
      const start = Math.floor((t - offset) / tgtMs) * tgtMs + offset;
      return { start, end: start + tgtMs };
    }
    const b = fxDayContaining(t);
    if (target === '1D') return { start: b[0]!, end: b[6]! };
    let k = 5;
    while (k > 0 && b[k]! > t) k--;
    return { start: b[k]!, end: b[k + 1]! };
  };
  /** End of the source bar starting at t. */
  const sourceEnd = (t: number): number => (srcIs4hNy ? fxDayContaining(t).find((x) => x > t)! : t + srcMs);

  const out: Candle[] = [];
  let lastT = -Infinity;
  let lastStart = NaN;
  let volSeen = false;
  let vol = 0;
  const flushVol = (): void => {
    const cur = out[out.length - 1];
    if (cur && volSeen) cur.v = vol;
  };
  for (const b of bars) {
    const t = toEpochMs(b.t);
    if (t <= lastT) throw new RangeError('bars must be strictly increasing in time');
    if (srcIs4hNy) {
      if (!fxDayContaining(t).includes(t)) throw new RangeError(`bar at ${t} is not aligned to 4h NY boundaries`);
    } else if ((((t - offset) % srcMs) + srcMs) % srcMs !== 0) {
      throw new RangeError(`bar at ${t} is not aligned to ${source}`);
    }
    lastT = t;
    const bucket = bucketOf(t);
    if (bucket.start !== lastStart) {
      flushVol();
      lastStart = bucket.start;
      volSeen = false;
      vol = 0;
      const expectedBars = srcIs4hNy ? 6 : Math.round((bucket.end - bucket.start) / srcMs);
      out.push({
        t: bucket.start,
        end: bucket.end,
        o: b.o,
        h: b.h,
        l: b.l,
        c: b.c,
        barCount: 1,
        expectedBars,
        hasGaps: false,
        partial: false,
      });
    } else {
      const cur = out[out.length - 1]!;
      cur.h = Math.max(cur.h, b.h);
      cur.l = Math.min(cur.l, b.l);
      cur.c = b.c;
      cur.barCount++;
    }
    if (b.v !== undefined) {
      volSeen = true;
      vol += b.v;
    }
  }
  flushVol();
  for (const c of out) c.hasGaps = c.barCount < c.expectedBars;
  const last = out[out.length - 1];
  if (last && Number.isFinite(lastT) && sourceEnd(lastT) < last.end) last.partial = true;
  return out;
}
