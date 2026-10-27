/**
 * HQ指示(2026-10-27「反応計算の期間指定」): 過去の発表を期間を指定して計算し直す。
 * - 既存の反応を不必要に上書きしない(値も状態も同じ行は書かない、AVAILABLE を UNAVAILABLE で上書きしない)
 * - 再実行で重複しない
 * - 為替の1分足が無ければ、値を作らない(UNAVAILABLE)
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { ingestEventPriceReactions } from '../../src/ingestion/pipelines/eventReactions.js';
import { JobCounters } from '../../src/ingestion/runner.js';
import { MemoryIngestionStore } from '../helpers/memoryIngestionStore.js';

const MIN = 60_000;
const OLD_RELEASE = '2026-01-09T13:30:00Z'; // 7日の範囲の外(過去の発表)
const T = Date.parse(OLD_RELEASE);
const NOW = new Date('2026-10-28T05:00:00Z');
const RANGE = { fromIso: '2026-01-01T00:00:00Z', toIso: '2026-10-16T00:00:00Z' };

function candle(offsetMinutes: number, close: number) {
  return {
    fx_pair_id: 'pair-usdjpy',
    timestamp: new Date(T + offsetMinutes * MIN).toISOString(),
    timeframe: '1m' as const,
    open: close,
    high: close,
    low: close,
    close,
    volume: null,
    source: 'test',
    verification_status: 'VERIFIED' as const,
    cross_check_source: null,
    cross_check_close: null,
    cross_check_diff_pips: null,
  };
}

/** Candles from T−5 to T+59 (enough for 1m / 5m / 15m / 30m / 60m). */
function fullHour() {
  return Array.from({ length: 65 }, (_, i) => candle(i - 5, 150 + i * 0.01));
}

describe('ingestEventPriceReactions with a range (backfill)', () => {
  let store: MemoryIngestionStore;

  beforeEach(() => {
    store = new MemoryIngestionStore();
    store.fxPairs = [
      {
        id: 'pair-usdjpy',
        symbol: 'USDJPY',
        pip_size: 0.01,
        price_precision: 3,
        base_currency: 'USD',
        quote_currency: 'JPY',
      },
    ];
    store.events = [
      {
        id: 'old-nfp',
        indicator_id: 'ind-nfp',
        provider: 'bls_schedule',
        provider_event_id: 'bls_schedule:US_NFP:2025-12',
        importance: 'HIGH',
        release_datetime: OLD_RELEASE,
        release_datetime_precision: 'EXACT',
        status: 'RELEASED',
        data_status: 'AVAILABLE',
        currency_code: 'USD',
      },
    ];
  });

  const run = (range?: typeof RANGE) => {
    const counters = new JobCounters();
    return ingestEventPriceReactions(store, { horizonDays: 7, ...(range ? { range } : {}) }, NOW, counters).then(
      () => counters,
    );
  };

  it('does nothing for an old event without a range (7-day horizon, as before)', async () => {
    store.fxPrices = fullHour();
    await run();
    expect(store.eventPriceReactions).toEqual([]);
  });

  it('computes an old event inside the range', async () => {
    store.fxPrices = fullHour();
    await run(RANGE);
    const rows = store.eventPriceReactions.filter((r) => r.event_id === 'old-nfp');
    expect(rows.map((r) => [r.timeframe, r.data_status]).sort()).toEqual(
      [
        ['15m', 'AVAILABLE'],
        ['1m', 'AVAILABLE'],
        ['30m', 'AVAILABLE'],
        ['5m', 'AVAILABLE'],
        ['60m', 'AVAILABLE'],
      ].sort(),
    );
  });

  it('ignores events outside the range (to is exclusive)', async () => {
    store.fxPrices = fullHour();
    await run({ fromIso: '2026-01-10T00:00:00Z', toIso: '2026-10-16T00:00:00Z' });
    await run({ fromIso: '2026-01-01T00:00:00Z', toIso: OLD_RELEASE });
    expect(store.eventPriceReactions).toEqual([]);
  });

  it('writes UNAVAILABLE with no values when there are no FX candles (never a made-up reaction)', async () => {
    await run(RANGE);
    const rows = store.eventPriceReactions;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.data_status).toBe('UNAVAILABLE');
      expect([row.pre_release_price, row.post_release_price, row.movement, row.pips]).toEqual([null, null, null, null]);
    }
  });

  it('re-running writes nothing new and never duplicates (unchanged rows are not rewritten)', async () => {
    store.fxPrices = fullHour();
    await run(RANGE);
    const first = JSON.stringify(store.eventPriceReactions);
    const counters = await run(RANGE);
    expect(JSON.stringify(store.eventPriceReactions)).toBe(first); // calculated_at も書き換えない
    expect(counters.skipReasons.UNCHANGED).toBe(5);
    expect(counters.skipReasons.NOTHING_CHANGED).toBe(1);
  });

  it('never replaces an AVAILABLE reaction with UNAVAILABLE when candles are missing later', async () => {
    store.fxPrices = fullHour();
    await run(RANGE);
    const before = JSON.stringify(store.eventPriceReactions);
    store.fxPrices = []; // 1分足が後から消えた・読めなかった
    const counters = await run(RANGE);
    expect(JSON.stringify(store.eventPriceReactions)).toBe(before);
    expect(counters.skipReasons.KEEP_AVAILABLE).toBe(5);
  });

  it('still upgrades UNAVAILABLE to AVAILABLE once candles arrive (gap filled)', async () => {
    await run(RANGE);
    expect(store.eventPriceReactions.every((r) => r.data_status === 'UNAVAILABLE')).toBe(true);
    store.fxPrices = fullHour();
    await run(RANGE);
    expect(store.eventPriceReactions.every((r) => r.data_status === 'AVAILABLE')).toBe(true);
    expect(store.eventPriceReactions).toHaveLength(5);
  });
});
