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
