import { nyLocal } from '../technical/nyTime.js';
import { MS_PER_DAY } from './time.js';

/**
 * New York wall-clock helpers for the baseline (same time of day on earlier NY weekdays). DST comes from the IANA
 * database through Intl (technical/nyTime.ts nyLocal); no fixed offset is used. technical/nyTime.ts is not changed:
 * its nyLocalToUtc only handles whole hours, this module resolves hour + minute and reports DST gaps / repeats.
 */
export interface NyWall {
  y: number;
  m: number;
  d: number;
  h: number;
  mi: number;
}

/** The NY wall clock at a UTC instant. */
export function nyWall(utcMs: number): NyWall {
  const l = nyLocal(utcMs);
  return { y: l.y, m: l.m, d: l.d, h: l.h, mi: l.mi };
}

const sameWall = (a: NyWall, b: NyWall): boolean =>
  a.y === b.y && a.m === b.m && a.d === b.d && a.h === b.h && a.mi === b.mi;

/** Possible UTC offsets of New York in hours: EDT (UTC-4) and EST (UTC-5). */
const NY_OFFSET_HOURS = [4, 5] as const;
const MS_PER_HOUR = 3_600_000;

/**
 * UTC instant (ms) of the New York wall time y-m-d h:mi, or null when that wall time does not exist (spring-forward
 * gap) or is ambiguous (fall-back repeat). Those local times are skipped, never guessed.
 */
export function nyWallToUtcMs(wall: NyWall): number | null {
  const naive = Date.UTC(wall.y, wall.m - 1, wall.d, wall.h, wall.mi);
  const valid = NY_OFFSET_HOURS.map((hours) => naive + hours * MS_PER_HOUR).filter((c) => sameWall(nyWall(c), wall));
  return valid.length === 1 ? valid[0]! : null;
}

/** Calendar date `daysBack` days before y-m-d (pure calendar arithmetic) and its weekday (0 = Sunday ... 6 = Saturday). */
export function calendarDaysBack(
  y: number,
  m: number,
  d: number,
  daysBack: number,
): { y: number; m: number; d: number; weekday: number } {
  const t = new Date(Date.UTC(y, m - 1, d) - daysBack * MS_PER_DAY);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), weekday: t.getUTCDay() };
}

const SATURDAY = 6;
const SUNDAY = 0;
export const isWeekend = (weekday: number): boolean => weekday === SATURDAY || weekday === SUNDAY;

const clockFormats = new Map<string, Intl.DateTimeFormat>();

/** 'HH:MM' wall clock of a UTC instant in an IANA time zone (e.g. 'Europe/London'), used as reference information. */
export function wallClockIn(utcMs: number, timeZone: string): string {
  let fmt = clockFormats.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-GB', { timeZone, hourCycle: 'h23', hour: '2-digit', minute: '2-digit' });
    clockFormats.set(timeZone, fmt);
  }
  return fmt.format(new Date(utcMs));
}
