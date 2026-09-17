import { describe, expect, it } from 'vitest';
import { resolveDayRangeUtc } from '../../src/domain/timezone.js';

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
