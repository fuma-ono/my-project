/**
 * FX market hours (HQ判断 2026-10-16「市場時間・夏時間・週末・祝日の判定」).
 * Shared by the gap repair (pipelines/fxGapRepair.ts) and the data-quality
 * report (quality/), so "missing" means the same thing in both.
 *
 * Rule (data-sources.md §12): the spot FX week opens Sunday 17:00 and closes
 * Friday 17:00 New York time. Using the America/New_York time zone makes
 * the UTC hour follow US daylight saving time automatically (21:00 UTC in
 * summer, 22:00 UTC in winter). On the days in FX_MARKET_CLOSED_DAYS
 * (New York date) the market is treated as closed for the whole day —
 * liquidity is near zero and providers often return no candles, so those
 * minutes are neither expected nor counted as missing.
 */

export const MINUTE_MS = 60_000;

/** Closed days as New York "MM-DD" (every year). Code-reviewed config. */
export const FX_MARKET_CLOSED_DAYS: readonly string[] = ['12-25', '01-01'];

const NEW_YORK = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  weekday: 'short',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  hourCycle: 'h23',
});

interface NewYorkParts {
  weekday: string;
  monthDay: string;
  hour: number;
}

function newYorkParts(ms: number): NewYorkParts {
  const parts = Object.fromEntries(NEW_YORK.formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  return { weekday: parts.weekday ?? '', monthDay: `${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

/** Whether the 1-minute candle that OPENS at `ms` is inside FX market hours. */
export function isFxMarketOpen(ms: number): boolean {
  const { weekday, monthDay, hour } = newYorkParts(ms);
  if (FX_MARKET_CLOSED_DAYS.includes(monthDay)) return false;
  if (weekday === 'Sat') return false;
  if (weekday === 'Sun') return hour >= 17;
  if (weekday === 'Fri') return hour < 17;
  return true;
}

/** Floors to the start of the minute. */
export function floorMinute(ms: number): number {
  return Math.floor(ms / MINUTE_MS) * MINUTE_MS;
}

/** Open-market minute starts in [fromMs, toMs) (both floored to the minute). */
export function marketMinutes(fromMs: number, toMs: number): number[] {
  const result: number[] = [];
  for (let ms = floorMinute(fromMs); ms < floorMinute(toMs); ms += MINUTE_MS) {
    if (isFxMarketOpen(ms)) result.push(ms);
  }
  return result;
}

export interface MinuteInterval {
  /** First missing minute (inclusive), ms. */
  from: number;
  /** End (exclusive), ms. */
  to: number;
}

/**
 * Open-market minutes in [fromMs, toMs) that are not in `present`, merged
 * into contiguous intervals. A closed-market minute ends an interval, so no
 * interval spans a weekend or a closed day.
 */
export function missingMarketIntervals(fromMs: number, toMs: number, present: ReadonlySet<number>): MinuteInterval[] {
  const intervals: MinuteInterval[] = [];
  let current: MinuteInterval | null = null;
  for (let ms = floorMinute(fromMs); ms < floorMinute(toMs); ms += MINUTE_MS) {
    const missing = isFxMarketOpen(ms) && !present.has(ms);
    if (missing) {
      if (current && current.to === ms) current.to = ms + MINUTE_MS;
      else {
        current = { from: ms, to: ms + MINUTE_MS };
        intervals.push(current);
      }
    } else {
      current = null;
    }
  }
  return intervals;
}
