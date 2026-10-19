import { beforeEach, describe, expect, it } from 'vitest';
import { ingestEventPriceReactions } from '../../src/ingestion/pipelines/eventReactions.js';
import { JobCounters } from '../../src/ingestion/runner.js';
import { MemoryIngestionStore } from '../helpers/memoryIngestionStore.js';

const RELEASE = '2026-10-18T12:30:00Z';
const T = Date.parse(RELEASE);
const MIN = 60_000;
const NOW = new Date('2026-10-18T14:00:00Z'); // 90 minutes after release

function fxCandle(fxPairId: string, offsetMinutes: number, close: number) {
  return {
    fx_pair_id: fxPairId,
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

describe('ingestEventPriceReactions', () => {
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
      {
        id: 'pair-eurusd',
        symbol: 'EURUSD',
        pip_size: 0.0001,
        price_precision: 5,
        base_currency: 'EUR',
        quote_currency: 'USD',
      },
      {
        id: 'pair-eurjpy',
        symbol: 'EURJPY',
        pip_size: 0.01,
        price_precision: 3,
        base_currency: 'EUR',
        quote_currency: 'JPY',
      },
    ];
    store.events = [
      {
        id: 'event-1',
        indicator_id: 'ind-1',
        provider: 'test',
        provider_event_id: 'test:1',
        importance: 'HIGH',
        release_datetime: RELEASE,
        release_datetime_precision: 'EXACT',
        status: 'RELEASED',
        data_status: 'AVAILABLE',
        currency_code: 'USD',
      },
    ];
  });

  it('considers only currency-relevant active pairs (USD event → USDJPY and EURUSD are candidates, EURJPY never is)', async () => {
    store.fxPrices = [fxCandle('pair-usdjpy', -1, 150.0), fxCandle('pair-usdjpy', 0, 150.2)];
    const counters = new JobCounters();

    await ingestEventPriceReactions(store, { horizonDays: 7 }, NOW, counters);

    const pairIds = new Set(store.eventPriceReactions.map((r) => r.fx_pair_id));
    expect(pairIds.has('pair-usdjpy')).toBe(true); // candles present → AVAILABLE rows
    // EURUSD is a candidate (quote_currency USD) but has no candles at all → written as
    // UNAVAILABLE (missing data, not guessed), not simply absent.
    expect(pairIds.has('pair-eurusd')).toBe(true);
    expect(store.eventPriceReactions.find((r) => r.fx_pair_id === 'pair-eurusd')?.data_status).toBe('UNAVAILABLE');
    // EURJPY is neither base nor quote USD — never a candidate, never even queried.
    expect(pairIds.has('pair-eurjpy')).toBe(false);
  });

  it('skips an event with no currency-relevant active pair, without error', async () => {
    store.events[0]!.currency_code = 'SEK'; // no active pair contains SEK
    const counters = new JobCounters();

    await ingestEventPriceReactions(store, { horizonDays: 7 }, NOW, counters);

    expect(store.eventPriceReactions).toEqual([]);
    expect(counters.skipReasons.NO_CURRENCY_RELEVANT_PAIR).toBe(1);
    expect(counters.errorMessages).toEqual([]);
  });

  it('excludes events older than the horizon (mirrors the FX gap-repair horizon — never attempts a release whose price data will never be repaired)', async () => {
    store.events[0]!.release_datetime = '2026-10-01T12:30:00Z'; // 17 days before NOW
    const counters = new JobCounters();

    await ingestEventPriceReactions(store, { horizonDays: 7 }, NOW, counters);

    expect(counters.fetched).toBe(0);
    expect(store.eventPriceReactions).toEqual([]);
  });

  it('writes nothing when the release just happened and no timeframe has closed yet (no guessed/placeholder rows)', async () => {
    const justReleased = new Date(T + 30_000); // 30 seconds after release
    const counters = new JobCounters();

    await ingestEventPriceReactions(store, { horizonDays: 7 }, justReleased, counters);

    expect(counters.fetched).toBe(1);
    expect(counters.skipReasons.NOTHING_READY_YET).toBe(1);
    expect(store.eventPriceReactions).toEqual([]);
  });

  it('writes UNAVAILABLE when a required candle is missing, then recomputes AVAILABLE once the gap is repaired — without duplicating the row', async () => {
    store.fxPrices = [fxCandle('pair-usdjpy', -1, 150.0)]; // T+1m candle missing
    const counters1 = new JobCounters();
    await ingestEventPriceReactions(store, { horizonDays: 7 }, NOW, counters1);

    const oneMinuteRow = () =>
      store.eventPriceReactions.find((r) => r.fx_pair_id === 'pair-usdjpy' && r.timeframe === '1m');
    expect(oneMinuteRow()?.data_status).toBe('UNAVAILABLE');
    const countAfterFirstRun = store.eventPriceReactions.length;

    // The gap gets repaired by a later ingest:fx-prices run.
    store.fxPrices.push(fxCandle('pair-usdjpy', 0, 150.2));
    const counters2 = new JobCounters();
    await ingestEventPriceReactions(store, { horizonDays: 7 }, NOW, counters2);

    expect(oneMinuteRow()).toMatchObject({ data_status: 'AVAILABLE', post_release_price: 150.2 });
    expect(store.eventPriceReactions.length).toBe(countAfterFirstRun); // same row upgraded, not duplicated
  });

  it('running the job twice with no new data never duplicates a row (idempotent, event_id+fx_pair_id+timeframe upsert)', async () => {
    store.fxPrices = [fxCandle('pair-usdjpy', -1, 150.0), fxCandle('pair-usdjpy', 0, 150.2)];

    await ingestEventPriceReactions(store, { horizonDays: 7 }, NOW, new JobCounters());
    const countAfterFirstRun = store.eventPriceReactions.length;
    expect(countAfterFirstRun).toBeGreaterThan(0);

    await ingestEventPriceReactions(store, { horizonDays: 7 }, NOW, new JobCounters());
    expect(store.eventPriceReactions.length).toBe(countAfterFirstRun);
  });

  it('never writes a row for a SCHEDULED or CANCELLED event (only RELEASED events are even listed)', async () => {
    store.events.push(
      {
        id: 'event-future',
        indicator_id: 'ind-1',
        provider: 'test',
        provider_event_id: 'test:2',
        importance: 'HIGH',
        release_datetime: new Date(NOW.getTime() + 60 * MIN).toISOString(),
        release_datetime_precision: 'EXACT',
        status: 'SCHEDULED',
        data_status: 'PENDING',
        currency_code: 'USD',
      },
      {
        id: 'event-cancelled',
        indicator_id: 'ind-1',
        provider: 'test',
        provider_event_id: 'test:3',
        importance: 'HIGH',
        release_datetime: RELEASE,
        release_datetime_precision: 'EXACT',
        status: 'CANCELLED',
        data_status: 'UNAVAILABLE',
        currency_code: 'USD',
      },
    );
    store.fxPrices = [fxCandle('pair-usdjpy', -1, 150.0), fxCandle('pair-usdjpy', 0, 150.2)];
    const counters = new JobCounters();

    await ingestEventPriceReactions(store, { horizonDays: 7 }, NOW, counters);

    expect(counters.fetched).toBe(1); // only the RELEASED event
    expect(store.eventPriceReactions.every((r) => r.event_id === 'event-1')).toBe(true);
  });

  it('stores the calculated pips/movement/max-excursion values correctly in store.eventPriceReactions (DB-write wiring check)', async () => {
    // 手計算（pre = T-1m candle close = 150.000, pip_size 0.01 for USDJPY）:
    //   1m: post = 150.100 (T+1m) → movement = 0.100 → pips = 0.100 / 0.01 = 10
    //   5m: post = 150.400 (T+5m) → movement = 0.400 → pips = 0.400 / 0.01 = 40
    //   5m window (T, T+5m] の各candleの値(高値=安値=終値のみ): 150.100, 150.250, 149.900, 150.050, 150.400
    //     最大上昇 = 150.400 - 150.000 = 0.400 → 40pips / 最大下降 = 149.900 - 150.000 = -0.100 → -10pips
    store.fxPrices = [
      fxCandle('pair-usdjpy', -1, 150.0),
      fxCandle('pair-usdjpy', 0, 150.1),
      fxCandle('pair-usdjpy', 1, 150.25),
      fxCandle('pair-usdjpy', 2, 149.9),
      fxCandle('pair-usdjpy', 3, 150.05),
      fxCandle('pair-usdjpy', 4, 150.4),
    ];
    const counters = new JobCounters();

    await ingestEventPriceReactions(store, { horizonDays: 7 }, NOW, counters);

    const row = (timeframe: string) =>
      store.eventPriceReactions.find((r) => r.fx_pair_id === 'pair-usdjpy' && r.timeframe === timeframe);

    expect(row('1m')).toMatchObject({
      data_status: 'AVAILABLE',
      pre_release_price: 150.0,
      post_release_price: 150.1,
      movement: 0.1,
      pips: 10,
    });

    expect(row('5m')).toMatchObject({
      data_status: 'AVAILABLE',
      pre_release_price: 150.0,
      post_release_price: 150.4,
      movement: 0.4,
      pips: 40,
      max_upward: 0.4,
      max_downward: -0.1,
      max_upward_pips: 40,
      max_downward_pips: -10,
    });
  });

  it('logs the run via the shared JobCounters (data_type EVENT_REACTION) without crashing on an empty DB', async () => {
    store.events = [];
    const counters = new JobCounters();

    await ingestEventPriceReactions(store, { horizonDays: 7 }, NOW, counters);

    expect(counters.fetched).toBe(0);
    expect(counters.errorMessages).toEqual([]);
  });
});
