import { describe, expect, it } from 'vitest';
import { isFxMarketOpen, marketMinutes, missingMarketIntervals, MINUTE_MS } from '../../src/ingestion/marketHours.js';

const at = (iso: string) => Date.parse(iso);

describe('FX market hours (New York 17:00 Sun → 17:00 Fri, DST-aware)', () => {
  it('summer (EDT): opens Sun 21:00 UTC, closes Fri 21:00 UTC', () => {
    expect(isFxMarketOpen(at('2026-10-11T20:59:00Z'))).toBe(false); // Sun 16:59 NY
    expect(isFxMarketOpen(at('2026-10-11T21:00:00Z'))).toBe(true);
    expect(isFxMarketOpen(at('2026-10-16T20:59:00Z'))).toBe(true); // Fri 16:59 NY
    expect(isFxMarketOpen(at('2026-10-16T21:00:00Z'))).toBe(false);
    expect(isFxMarketOpen(at('2026-10-17T12:00:00Z'))).toBe(false); // Saturday
  });

  it('winter (EST, after 2026-11-01): opens Sun 22:00 UTC, closes Fri 22:00 UTC', () => {
    expect(isFxMarketOpen(at('2026-11-08T21:30:00Z'))).toBe(false);
    expect(isFxMarketOpen(at('2026-11-08T22:00:00Z'))).toBe(true);
    expect(isFxMarketOpen(at('2026-11-13T21:59:00Z'))).toBe(true);
    expect(isFxMarketOpen(at('2026-11-13T22:00:00Z'))).toBe(false);
  });

  it('treats Dec 25 and Jan 1 (New York date) as closed', () => {
    expect(isFxMarketOpen(at('2026-12-25T15:00:00Z'))).toBe(false); // Fri 10:00 NY
    expect(isFxMarketOpen(at('2026-12-24T15:00:00Z'))).toBe(true);
    expect(isFxMarketOpen(at('2027-01-01T15:00:00Z'))).toBe(false);
    // 2026-12-26 04:00 UTC is still Dec 25 in New York.
    expect(isFxMarketOpen(at('2026-12-26T04:00:00Z'))).toBe(false);
  });

  it('follows the DST switch days (2026-03-08 spring forward, 2026-11-01 fall back)', () => {
    // Sunday 2026-03-08: New York switches to EDT at 02:00, so the week opens at 17:00 EDT = 21:00 UTC.
    expect(isFxMarketOpen(at('2026-03-08T20:59:00Z'))).toBe(false);
    expect(isFxMarketOpen(at('2026-03-08T21:00:00Z'))).toBe(true);
    // Friday before it (2026-03-06, still EST) closes at 22:00 UTC.
    expect(isFxMarketOpen(at('2026-03-06T21:59:00Z'))).toBe(true);
    expect(isFxMarketOpen(at('2026-03-06T22:00:00Z'))).toBe(false);
    // Sunday 2026-11-01: back to EST at 02:00, so the week opens at 17:00 EST = 22:00 UTC.
    expect(isFxMarketOpen(at('2026-11-01T21:00:00Z'))).toBe(false);
    expect(isFxMarketOpen(at('2026-11-01T22:00:00Z'))).toBe(true);
    // Friday before it (2026-10-30, EDT) closes at 21:00 UTC.
    expect(isFxMarketOpen(at('2026-10-30T20:59:00Z'))).toBe(true);
    expect(isFxMarketOpen(at('2026-10-30T21:00:00Z'))).toBe(false);
    // The week containing the switch: Sun 2026-11-01 22:00Z → Fri 2026-11-06 22:00Z = 5 × 1440.
    expect(marketMinutes(at('2026-11-01T00:00:00Z'), at('2026-11-08T00:00:00Z'))).toHaveLength(7200);
  });

  it('handles a period crossing 2026-12-31 → 2027-01-01', () => {
    // Thu 2026-12-31 is open all day (no early close modelled); Fri 2027-01-01 is closed.
    expect(isFxMarketOpen(at('2026-12-31T23:59:00Z'))).toBe(true); // 18:59 NY Dec 31
    expect(isFxMarketOpen(at('2027-01-01T04:59:00Z'))).toBe(true); // 23:59 NY Dec 31
    expect(isFxMarketOpen(at('2027-01-01T05:00:00Z'))).toBe(false); // 00:00 NY Jan 1
    expect(isFxMarketOpen(at('2027-01-02T05:00:00Z'))).toBe(false); // Saturday
    expect(isFxMarketOpen(at('2027-01-03T22:00:00Z'))).toBe(true); // Sun 17:00 EST
    // 2026-12-31 05:00Z (Dec 31 00:00 NY) → 2027-01-04 05:00Z: Dec 31 NY all day (1440) + Sun 17:00–24:00 NY (420).
    expect(marketMinutes(at('2026-12-31T05:00:00Z'), at('2027-01-04T05:00:00Z'))).toHaveLength(1440 + 420);
  });

  it('counts a full summer week as 7200 minutes', () => {
    expect(marketMinutes(at('2026-10-11T00:00:00Z'), at('2026-10-18T00:00:00Z'))).toHaveLength(7200);
  });

  it('merges missing minutes into intervals that never span a closed market', () => {
    const from = at('2026-10-16T20:55:00Z');
    const to = at('2026-10-18T21:05:00Z');
    const present = new Set([at('2026-10-16T20:57:00Z')]);
    expect(missingMarketIntervals(from, to, present)).toEqual([
      { from: at('2026-10-16T20:55:00Z'), to: at('2026-10-16T20:57:00Z') },
      { from: at('2026-10-16T20:58:00Z'), to: at('2026-10-16T21:00:00Z') },
      { from: at('2026-10-18T21:00:00Z'), to: at('2026-10-18T21:05:00Z') },
    ]);
    expect(MINUTE_MS).toBe(60_000);
  });
});
