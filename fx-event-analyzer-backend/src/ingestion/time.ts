/**
 * Time helpers for adapters. Everything stored is UTC; sources publish in
 * their own zone (federalreserve.gov in US Eastern, ECB in CET/CEST …), so
 * wall-clock → UTC conversion goes through Intl with the IANA zone and
 * handles DST — never a fixed offset.
 */

function offsetMinutesAt(instantMs: number, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' });
  const part = formatter.formatToParts(new Date(instantMs)).find((entry) => entry.type === 'timeZoneName');
  const match = /GMT([+-])(\d{2}):(\d{2})/.exec(part?.value ?? '');
  if (!match) return 0;
  const [, sign, hours, minutes] = match;
  return (sign === '-' ? -1 : 1) * (Number(hours) * 60 + Number(minutes));
}

/**
 * The UTC instant of wall-clock time year-month-day hour:minute in
 * `timeZone`. Returns null for a wall time that does not exist (skipped by
 * a DST jump) — the caller must not guess.
 */
export function zonedWallTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date | null {
  const wallMs = Date.UTC(year, month - 1, day, hour, minute);
  for (const probe of [wallMs, wallMs - 12 * 3_600_000, wallMs + 12 * 3_600_000]) {
    const candidate = wallMs - offsetMinutesAt(probe, timeZone) * 60_000;
    if (candidate - wallMs + offsetMinutesAt(candidate, timeZone) * 60_000 === 0) {
      return new Date(candidate);
    }
  }
  return null;
}

/** Wall-clock parts of `instant` as seen in `timeZone`. */
export function wallClockParts(
  instant: Date,
  timeZone: string,
): { year: number; month: number; day: number; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute') };
}

/** 'YYYY-MM-DD' of `instant` in `timeZone`. */
export function localDate(instant: Date, timeZone: string): string {
  const { year, month, day } = wallClockParts(instant, timeZone);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** 'YYYY-MM' shifted by `months` (may be negative). */
export function shiftMonth(period: string, months: number): string {
  const match = /^(\d{4})-(\d{2})$/.exec(period);
  if (!match) throw new Error(`Invalid month period: ${period}`);
  const index = Number(match[1]) * 12 + (Number(match[2]) - 1) + months;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return `${year}-${String(month).padStart(2, '0')}`;
}

/** 'YYYY-MM' → 'YYYY-MM-01'. */
export function monthStart(period: string): string {
  return `${period}-01`;
}

/** 'YYYY-MM-DD HH:mm:ss' (no zone, meaning UTC) → ISO 'YYYY-MM-DDTHH:mm:ss.000Z', or null if malformed. */
export function utcWallStringToIso(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match;
  const ms = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s ?? '0'));
  const date = new Date(ms);
  // Reject roll-overs such as 2026-02-30.
  if (date.getUTCDate() !== Number(d) || date.getUTCMonth() !== Number(mo) - 1) return null;
  return date.toISOString();
}

/** true when the ISO instant falls exactly on a minute boundary. */
export function isMinuteAligned(iso: string): boolean {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) && ms % 60_000 === 0;
}
