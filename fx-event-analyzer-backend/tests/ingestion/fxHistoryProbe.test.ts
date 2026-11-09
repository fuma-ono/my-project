import { describe, expect, it } from 'vitest';
import { compareWithStored, summarizeProbeWindow } from '../../src/ingestion/fxHistoryProbe.js';
import type { NormalizedCandle } from '../../src/ingestion/types.js';

const c = (openTime: string, close: number, extra: Partial<NormalizedCandle> = {}): NormalizedCandle => ({
  provider: 'twelvedata',
  symbol: 'USDJPY',
  openTime,
  open: close,
  high: close,
  low: close,
  close,
  volume: null,
  ...extra,
});

describe('summarizeProbeWindow', () => {
  const range = { from: '2026-01-09T13:15:00Z', to: '2026-01-09T13:20:00Z' };

  it('counts expected, missing and duplicate minutes in [from, to)', () => {
    const stats = summarizeProbeWindow('USDJPY', range, [
      c('2026-01-09T13:15:00.000Z', 150),
      c('2026-01-09T13:16:00.000Z', 150.1),
      c('2026-01-09T13:16:00.000Z', 150.1),
      c('2026-01-09T13:19:00.000Z', 150.2),
    ]);
    expect(stats).toMatchObject({
      expectedMinutes: 5,
      candles: 4,
      missingMinutes: 2,
      duplicateMinutes: 1,
      misalignedCandles: 0,
      inconsistentOhlc: 0,
      first: '2026-01-09T13:15:00.000Z',
      last: '2026-01-09T13:19:00.000Z',
    });
  });

  it('flags candles off the minute / outside the window and impossible OHLC', () => {
    const stats = summarizeProbeWindow('USDJPY', range, [
      c('2026-01-09T13:15:30.000Z', 150),
      c('2026-01-09T13:25:00.000Z', 150),
      c('2026-01-09T13:16:00.000Z', 150, { high: 149 }),
    ]);
    expect(stats.misalignedCandles).toBe(2);
    expect(stats.inconsistentOhlc).toBe(1);
  });
});

describe('compareWithStored', () => {
  it('compares closes minute by minute in UTC', () => {
    const result = compareWithStored(
      [
        c('2026-10-20T13:00:00.000Z', 150.001),
        c('2026-10-20T13:01:00.000Z', 150.2),
        c('2026-10-20T13:02:00.000Z', 150.3),
      ],
      [
        { timestamp: '2026-10-20T13:00:00+00:00', close: '150.000' },
        { timestamp: '2026-10-20T13:01:00+00:00', close: 150.1 },
      ],
      0.005,
    );
    expect(result.overlapMinutes).toBe(2);
    expect(result.closeMismatches).toBe(1);
    expect(result.maxCloseDiff).toBeCloseTo(0.1, 6);
  });
});
