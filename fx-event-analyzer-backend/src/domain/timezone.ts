/**
 * Resolves "date D in IANA timezone Z" to a UTC instant range — used by
 * Home (api-design.md §6/§12: "APIで日付のみが指定された場合は...
 * timezoneをRequestで明示的に受け取る"). Uses only the built-in `Intl`
 * API (no date-tz dependency, per Phase 2 instruction §5 "依存関係は最小
 * 限にする").
 */
export interface UtcDayRange {
  startUtc: string;
  endUtc: string;
}

function offsetMinutesAt(instant: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' });
  const offsetPart = formatter.formatToParts(instant).find((part) => part.type === 'timeZoneName');
  const match = /GMT([+-])(\d{2}):(\d{2})/.exec(offsetPart?.value ?? 'GMT+00:00');
  if (!match) return 0;
  const [, sign, hours, minutes] = match;
  return (sign === '-' ? -1 : 1) * (Number(hours) * 60 + Number(minutes));
}

/**
 * `date` is a `YYYY-MM-DD` string. Returns `[startUtc, endUtc)` — from
 * inclusive, to exclusive, matching api-design.md §6's range convention.
 */
export function resolveDayRangeUtc(date: string, timeZone: string): UtcDayRange {
  // Use local noon as the representative instant for computing the day's
  // UTC offset — well clear of any DST transition that might fall near
  // midnight, and still the correct offset for this calendar date.
  const noonUtcGuess = new Date(`${date}T12:00:00.000Z`);
  const offsetMinutes = offsetMinutesAt(noonUtcGuess, timeZone);

  const startUtc = new Date(new Date(`${date}T00:00:00.000Z`).getTime() - offsetMinutes * 60_000);
  const endUtc = new Date(startUtc.getTime() + 24 * 60 * 60_000);

  return { startUtc: startUtc.toISOString(), endUtc: endUtc.toISOString() };
}

/** IANA zone names only — anything `Intl` can't resolve is rejected (moved
 * here from src/schemas/settings.ts so query schemas can share it). */
export function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export interface LocalYearMonth {
  year: number;
  /** 1-12. */
  month: number;
}

/** The calendar year/month `instant` falls in, as seen in `timeZone`. */
export function localYearMonth(instant: Date, timeZone: string): LocalYearMonth {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'numeric' }).formatToParts(
    instant,
  );
  return {
    year: Number(parts.find((part) => part.type === 'year')?.value),
    month: Number(parts.find((part) => part.type === 'month')?.value),
  };
}

/**
 * 00:00 local time on year-month-day in `timeZone`, as a UTC instant.
 * `month` is 1-based and may be out of range (0 = December of the year
 * before, 13 = January of the next), like `Date.UTC`. Candidates from the
 * offsets on either side of a DST change are checked for consistency: an
 * ambiguous midnight resolves to the earlier instant, a midnight skipped by
 * a DST gap to the first instant of that day.
 */
export function startOfLocalDayUtc(year: number, month: number, day: number, timeZone: string): Date {
  const wallClockUtc = Date.UTC(year, month - 1, day);
  const firstGuess = wallClockUtc - offsetMinutesAt(new Date(wallClockUtc), timeZone) * 60_000;
  const secondGuess = wallClockUtc - offsetMinutesAt(new Date(firstGuess), timeZone) * 60_000;
  const candidates = [...new Set([firstGuess, secondGuess])];
  const consistent = candidates.filter(
    (candidate) => wallClockUtc - offsetMinutesAt(new Date(candidate), timeZone) * 60_000 === candidate,
  );
  return new Date(consistent.length > 0 ? Math.min(...consistent) : Math.max(...candidates));
}
