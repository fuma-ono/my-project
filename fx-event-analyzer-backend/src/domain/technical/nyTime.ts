/**
 * New York wall-clock helpers (IANA America/New_York with automatic DST) built on Intl only,
 * no dependencies. Used for the FX trading-day convention (day rolls at 17:00 New York).
 *
 * FX day convention (adopted 2026-11-25):
 *  - An FX day runs from 17:00 New York (previous calendar date) to 17:00 New York. Its length is
 *    24h normally, 23h on the spring-forward day and 25h on the fall-back day (DST follows the
 *    IANA rules automatically; there is no fixed UTC offset).
 *  - The week opens Sunday 17:00 NY, which is therefore the start of Monday's daily bar. It closes
 *    Friday 17:00 NY. No Saturday bar exists because no data exists.
 *  - 4h bars tile the FX day on New York wall-clock boundaries 17:00, 21:00, 01:00, 05:00, 09:00,
 *    13:00, so exactly 6 four-hour bars make one daily bar on every day. On DST days one bar is
 *    shorter (spring-forward: the 01:00 bar lasts 3h) or longer (fall-back: the 01:00 bar lasts
 *    5h, it starts at the FIRST 01:00 and covers the repeated hour).
 */
const fmt = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

export interface NyLocal {
  y: number;
  m: number;
  d: number;
  h: number;
  mi: number;
  s: number;
}

export function nyLocal(utcMs: number): NyLocal {
  const parts = fmt.formatToParts(new Date(Math.floor(utcMs / 1000) * 1000));
  const get = (type: string): number => Number(parts.find((p) => p.type === type)!.value);
  return { y: get('year'), m: get('month'), d: get('day'), h: get('hour'), mi: get('minute'), s: get('second') };
}

function localAsUtc(l: NyLocal): number {
  return Date.UTC(l.y, l.m - 1, l.d, l.h, l.mi, l.s);
}

/** Offset of New York from UTC in ms (negative: -5h EST, -4h EDT) at the given instant. */
export function nyOffsetMs(utcMs: number): number {
  return localAsUtc(nyLocal(utcMs)) - Math.floor(utcMs / 1000) * 1000;
}

/** Earliest UTC instant whose New York wall clock reads y-m-d h:00 (handles the repeated fall-back hour). */
export function nyLocalToUtc(y: number, m: number, d: number, h: number): number {
  const naive = Date.UTC(y, m - 1, d, h, 0, 0);
  const candidates = [naive + 4 * 3_600_000, naive + 5 * 3_600_000];
  const valid = candidates.filter((c) => localAsUtc(nyLocal(c)) === naive);
  // In the spring-forward gap no candidate matches; fall back to the EST reading (later instant).
  return valid.length ? Math.min(...valid) : naive + 5 * 3_600_000;
}

const FOUR_H_LOCAL_HOURS = [17, 21, 1, 5, 9, 13] as const;
const cache = new Map<string, number[]>();

/**
 * The 7 boundaries of the FX day that starts at 17:00 NY on y-m-d: six 4h bar starts followed by
 * the next day start (index 6 = end of the day).
 */
export function fxDayBoundaries(y: number, m: number, d: number): number[] {
  const key = `${y}-${m}-${d}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  const [ny, nm, nd] = [next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate()];
  const out = FOUR_H_LOCAL_HOURS.map((h) => (h >= 17 ? nyLocalToUtc(y, m, d, h) : nyLocalToUtc(ny, nm, nd, h)));
  out.push(nyLocalToUtc(ny, nm, nd, 17));
  if (cache.size > 5000) cache.clear();
  cache.set(key, out);
  return out;
}

/** Boundaries of the FX day containing utcMs. */
export function fxDayContaining(utcMs: number): number[] {
  const l = nyLocal(utcMs);
  if (l.h >= 17) return fxDayBoundaries(l.y, l.m, l.d);
  const prev = new Date(Date.UTC(l.y, l.m - 1, l.d - 1));
  return fxDayBoundaries(prev.getUTCFullYear(), prev.getUTCMonth() + 1, prev.getUTCDate());
}
