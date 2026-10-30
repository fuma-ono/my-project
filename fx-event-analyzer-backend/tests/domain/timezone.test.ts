import { describe, expect, it } from 'vitest';
import { isValidTimeZone, localYearMonth, resolveDayRangeUtc, startOfLocalDayUtc } from '../../src/domain/timezone.js';

describe('resolveDayRangeUtc', () => {
  it('returns the UTC day range unchanged for UTC itself', () => {
    expect(resolveDayRangeUtc('2026-09-17', 'UTC')).toEqual({
      startUtc: '2026-09-17T00:00:00.000Z',
      endUtc: '2026-09-18T00:00:00.000Z',
    });
  });

  it('shifts by -9h for Asia/Tokyo (UTC+9, no DST)', () => {
    // 2026-09-17 00:00 JST == 2026-09-16 15:00 UTC.
    expect(resolveDayRangeUtc('2026-09-17', 'Asia/Tokyo')).toEqual({
      startUtc: '2026-09-16T15:00:00.000Z',
      endUtc: '2026-09-17T15:00:00.000Z',
    });
  });

  it('shifts by +4h for America/New_York in September (EDT, UTC-4)', () => {
    // 2026-09-17 00:00 EDT == 2026-09-17 04:00 UTC.
    expect(resolveDayRangeUtc('2026-09-17', 'America/New_York')).toEqual({
      startUtc: '2026-09-17T04:00:00.000Z',
      endUtc: '2026-09-18T04:00:00.000Z',
    });
  });

  it('shifts by +5h for America/New_York in January (EST, UTC-5) — crosses the DST boundary', () => {
    expect(resolveDayRangeUtc('2026-01-17', 'America/New_York')).toEqual({
      startUtc: '2026-01-17T05:00:00.000Z',
      endUtc: '2026-01-18T05:00:00.000Z',
    });
  });

  it('always produces an exactly 24h [start, end) range', () => {
    const { startUtc, endUtc } = resolveDayRangeUtc('2026-03-08', 'America/New_York');
    expect(new Date(endUtc).getTime() - new Date(startUtc).getTime()).toBe(24 * 60 * 60 * 1000);
  });
});

describe('startOfLocalDayUtc', () => {
  it('returns local midnight as a UTC instant', () => {
    expect(startOfLocalDayUtc(2026, 9, 1, 'UTC').toISOString()).toBe('2026-09-01T00:00:00.000Z');
    expect(startOfLocalDayUtc(2026, 9, 1, 'Asia/Tokyo').toISOString()).toBe('2026-08-31T15:00:00.000Z');
    expect(startOfLocalDayUtc(2026, 9, 1, 'America/New_York').toISOString()).toBe('2026-09-01T04:00:00.000Z');
    expect(startOfLocalDayUtc(2026, 12, 1, 'America/New_York').toISOString()).toBe('2026-12-01T05:00:00.000Z');
  });

  it('normalizes out-of-range months like Date.UTC', () => {
    expect(startOfLocalDayUtc(2027, 0, 1, 'UTC').toISOString()).toBe('2026-12-01T00:00:00.000Z');
    expect(startOfLocalDayUtc(2026, 13, 1, 'UTC').toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });

  it('handles a midnight right after a DST change (Europe/London, 2026-03-30)', () => {
    // BST (UTC+1) started 2026-03-29 01:00 UTC.
    expect(startOfLocalDayUtc(2026, 3, 30, 'Europe/London').toISOString()).toBe('2026-03-29T23:00:00.000Z');
  });

  it('resolves a midnight skipped by DST to the first instant of the day (America/Santiago, 2026-09-06)', () => {
    // Chile moves 00:00 → 01:00 (UTC-4 → UTC-3); the day starts at 01:00 local = 04:00Z.
    expect(startOfLocalDayUtc(2026, 9, 6, 'America/Santiago').toISOString()).toBe('2026-09-06T04:00:00.000Z');
  });
});

describe('localYearMonth', () => {
  it('reads the year/month in the timezone', () => {
    const instant = new Date('2026-12-31T16:00:00Z');
    expect(localYearMonth(instant, 'UTC')).toEqual({ year: 2026, month: 12 });
    expect(localYearMonth(instant, 'Asia/Tokyo')).toEqual({ year: 2027, month: 1 });
  });
});

describe('isValidTimeZone', () => {
  it('accepts IANA names and rejects anything else', () => {
    expect(isValidTimeZone('Asia/Tokyo')).toBe(true);
    expect(isValidTimeZone('UTC')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
  });
});
