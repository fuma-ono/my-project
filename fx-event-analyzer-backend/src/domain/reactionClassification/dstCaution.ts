import { MS_PER_DAY } from './time.js';

/**
 * Weeks in which the US and Europe/UK daylight-saving states differ (owner decision D, 2026-11-27).
 *
 * US DST: second Sunday of March .. first Sunday of November. EU / UK DST: last Sunday of March .. last Sunday of
 * October (all switch on Sundays). The states differ in [US start, EU start) and [EU end, US end). The baseline sigma
 * is aligned on the New York wall clock, so it is consistent for US events but can be one hour off in London time for
 * EU / UK events in these weeks. This is a factual flag, not a correction: the label is still returned.
 * Not handled: Australia / New Zealand (southern-hemisphere DST), no DST elsewhere (e.g. Japan).
 */
export interface DstMismatchCaution {
  active: boolean;
  reason?: 'US_EU_DST_TRANSITION_DATES_DIFFER';
  /** First day of the period (inclusive), YYYY-MM-DD. */
  from_date?: string;
  /** End of the period (exclusive), YYYY-MM-DD. */
  to_date?: string;
}

const SUNDAY = 0;
const MARCH = 3;
const OCTOBER = 10;
const NOVEMBER = 11;
const SECOND = 2;
const FIRST = 1;
const DAYS_IN_WEEK = 7;

function nthSundayMs(year: number, month: number, nth: number): number {
  const firstOfMonth = Date.UTC(year, month - 1, 1);
  const firstWeekday = new Date(firstOfMonth).getUTCDay();
  const offsetToFirstSunday = (DAYS_IN_WEEK + SUNDAY - firstWeekday) % DAYS_IN_WEEK;
  return firstOfMonth + (offsetToFirstSunday + (nth - 1) * DAYS_IN_WEEK) * MS_PER_DAY;
}

function lastSundayMs(year: number, month: number): number {
  const lastOfMonth = Date.UTC(year, month, 0);
  const weekday = new Date(lastOfMonth).getUTCDay();
  return lastOfMonth - ((weekday - SUNDAY + DAYS_IN_WEEK) % DAYS_IN_WEEK) * MS_PER_DAY;
}

const isoDate = (ms: number): string => new Date(ms).toISOString().slice(0, 'YYYY-MM-DD'.length);

export function dstMismatchPeriods(year: number): { from: number; to: number }[] {
  const usStart = nthSundayMs(year, MARCH, SECOND);
  const euStart = lastSundayMs(year, MARCH);
  const euEnd = lastSundayMs(year, OCTOBER);
  const usEnd = nthSundayMs(year, NOVEMBER, FIRST);
  return [
    { from: usStart, to: euStart },
    { from: euEnd, to: usEnd },
  ];
}

/** The caution for a release at `releaseMs` (its UTC calendar date decides). */
export function dstMismatchCaution(releaseMs: number): DstMismatchCaution {
  const release = new Date(releaseMs);
  const day = Date.UTC(release.getUTCFullYear(), release.getUTCMonth(), release.getUTCDate());
  const hit = dstMismatchPeriods(release.getUTCFullYear()).find((p) => day >= p.from && day < p.to);
  if (!hit) return { active: false };
  return {
    active: true,
    reason: 'US_EU_DST_TRANSITION_DATES_DIFFER',
    from_date: isoDate(hit.from),
    to_date: isoDate(hit.to),
  };
}
