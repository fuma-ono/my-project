import { describe, expect, it } from 'vitest';
import { computeEventPairReactionRows } from '../../src/domain/economicEventReactions.js';
import type { PriceCandle } from '../../src/domain/speechReactions.js';

const RELEASE = '2026-10-18T12:30:00Z';
const T = Date.parse(RELEASE);
const MIN = 60_000;
const NOW = new Date('2026-10-18T14:00:00Z'); // 90 minutes after release — every timeframe up to 60m has closed

/** A 1m candle opening `offset` minutes after the release (timestamp = open time). */
const candle = (offset: number, close: number, high = close, low = close): PriceCandle => ({
  timestamp: new Date(T + offset * MIN).toISOString(),
  high,
  low,
  close,
});

describe('computeEventPairReactionRows', () => {
  it('computes pips (JPY ×100), movement, change_percent and max excursion for every closed timeframe', () => {
    const candles = [
      candle(-1, 150.0), // pre-release close
      candle(0, 150.2, 150.3, 149.95), // closes at T+1m
      candle(1, 150.1), // closes at T+2m
      candle(2, 150.5, 150.6, 150.0), // closes at T+3m
      candle(3, 150.3),
      candle(4, 150.4, 150.45, 150.1), // closes at T+5m
      candle(13, 150.45), // closes at T+14m
      candle(14, 150.6, 150.65, 150.0), // closes at T+15m
      candle(29, 150.7, 150.8, 149.9), // closes at T+30m
      candle(59, 150.8, 150.85, 149.85), // closes at T+60m
    ];

    const rows = computeEventPairReactionRows({
      releaseDatetime: RELEASE,
      precision: 'EXACT',
      symbol: 'USDJPY',
      candles,
      now: NOW,
    });

    expect(rows.map((r) => r.timeframe)).toEqual(['1m', '5m', '15m', '30m', '60m']);
    expect(rows.every((r) => r.pre_release_price === 150.0)).toBe(true);
    expect(rows.every((r) => r.data_status === 'AVAILABLE')).toBe(true);

    const oneMinute = rows[0]!;
    expect(oneMinute.post_release_price).toBe(150.2);
    expect(oneMinute.movement).toBe(0.2);
    expect(oneMinute.pips).toBeCloseTo(20, 6); // 0.2 / 0.01 (JPY pip size) = 20 pips
    expect(oneMinute.change_percent).toBeCloseTo((0.2 / 150.0) * 100, 4);

    const sixtyMinute = rows[4]!;
    expect(sixtyMinute.post_release_price).toBe(150.8);
    // pre_release_price (150.0) basis, not cumulative between candles (db-design.md §3.12)
    expect(sixtyMinute.max_upward).toBeCloseTo(150.85 - 150.0, 6);
    expect(sixtyMinute.max_downward).toBeCloseTo(149.85 - 150.0, 6);
  });

  it("rounds pips/max_upward_pips/max_downward_pips to 2 decimals (event_price_reactions is numeric(10,2) — not speeches' 1-decimal API convention)", () => {
    const candles = [candle(-1, 1.1, 1.1, 1.1), candle(0, 1.10005, 1.1001, 1.0999)];
    const rows = computeEventPairReactionRows({
      releaseDatetime: RELEASE,
      precision: 'EXACT',
      symbol: 'EURUSD',
      candles,
      now: NOW,
    });
    const oneMinute = rows.find((r) => r.timeframe === '1m')!;
    // movement = 0.00005 / 0.0001 pip size = 0.5 pips exactly representable at 2dp
    expect(oneMinute.pips).toBe(0.5);
  });

  it('a timeframe whose window has not closed yet is omitted entirely (never a guessed/placeholder row)', () => {
    const rows = computeEventPairReactionRows({
      releaseDatetime: RELEASE,
      precision: 'EXACT',
      symbol: 'USDJPY',
      candles: [candle(-1, 150.0), candle(0, 150.2)],
      now: new Date(T + 2 * MIN), // only 2 minutes have passed
    });
    expect(rows.map((r) => r.timeframe)).toEqual(['1m']);
  });

  it('a closed window with the required candle missing is UNAVAILABLE, not guessed', () => {
    const rows = computeEventPairReactionRows({
      releaseDatetime: RELEASE,
      precision: 'EXACT',
      symbol: 'USDJPY',
      candles: [candle(-1, 150.0)], // pre-release only — every post-release candle is missing
      now: NOW,
    });
    for (const row of rows) {
      expect(row.data_status).toBe('UNAVAILABLE');
      expect(row.post_release_price).toBeNull();
      expect(row.pips).toBeNull();
      expect(row.pre_release_price).toBe(150.0); // shared across every timeframe row
    }
  });

  it('no pre-release candle at all → every timeframe UNAVAILABLE with pre_release_price null too', () => {
    const rows = computeEventPairReactionRows({
      releaseDatetime: RELEASE,
      precision: 'EXACT',
      symbol: 'USDJPY',
      candles: [candle(0, 150.2)],
      now: NOW,
    });
    expect(rows.every((r) => r.data_status === 'UNAVAILABLE' && r.pre_release_price === null)).toBe(true);
  });

  it('release_datetime_precision excludes timeframes that cannot be meaningfully analyzed (never guessed)', () => {
    const candles = [
      candle(-1, 150.0),
      candle(0, 150.2),
      candle(4, 150.3),
      candle(14, 150.4),
      candle(29, 150.5),
      candle(59, 150.6),
    ];

    expect(
      computeEventPairReactionRows({
        releaseDatetime: RELEASE,
        precision: 'EXACT',
        symbol: 'USDJPY',
        candles,
        now: NOW,
      }).map((r) => r.timeframe),
    ).toEqual(['1m', '5m', '15m', '30m', '60m']);

    expect(
      computeEventPairReactionRows({
        releaseDatetime: RELEASE,
        precision: 'APPROXIMATE',
        symbol: 'USDJPY',
        candles,
        now: NOW,
      }).map((r) => r.timeframe),
    ).toEqual(['5m', '15m', '30m', '60m']);

    expect(
      computeEventPairReactionRows({
        releaseDatetime: RELEASE,
        precision: 'DATE_ONLY',
        symbol: 'USDJPY',
        candles,
        now: NOW,
      }).map((r) => r.timeframe),
    ).toEqual(['15m', '30m', '60m']);

    expect(
      computeEventPairReactionRows({
        releaseDatetime: RELEASE,
        precision: 'UNKNOWN',
        symbol: 'USDJPY',
        candles,
        now: NOW,
      }).map((r) => r.timeframe),
    ).toEqual(['15m', '30m', '60m']);
  });

  it('is deterministic / idempotent: the same inputs always produce the same rows (safe to re-run)', () => {
    const candles = [candle(-1, 150.0), candle(0, 150.2), candle(4, 150.3)];
    const first = computeEventPairReactionRows({
      releaseDatetime: RELEASE,
      precision: 'EXACT',
      symbol: 'USDJPY',
      candles,
      now: NOW,
    });
    const second = computeEventPairReactionRows({
      releaseDatetime: RELEASE,
      precision: 'EXACT',
      symbol: 'USDJPY',
      candles,
      now: NOW,
    });
    expect(second).toEqual(first);
  });

  it('a later run with the previously-missing candle now present recomputes AVAILABLE instead of UNAVAILABLE', () => {
    const withoutGap = computeEventPairReactionRows({
      releaseDatetime: RELEASE,
      precision: 'EXACT',
      symbol: 'USDJPY',
      candles: [candle(-1, 150.0)], // T+1m candle missing (ingestion gap)
      now: NOW,
    });
    expect(withoutGap.find((r) => r.timeframe === '1m')?.data_status).toBe('UNAVAILABLE');

    const repaired = computeEventPairReactionRows({
      releaseDatetime: RELEASE,
      precision: 'EXACT',
      symbol: 'USDJPY',
      candles: [candle(-1, 150.0), candle(0, 150.2)], // gap repaired by a later ingest:fx-prices run
      now: NOW,
    });
    expect(repaired.find((r) => r.timeframe === '1m')).toMatchObject({
      data_status: 'AVAILABLE',
      post_release_price: 150.2,
    });
  });
});
