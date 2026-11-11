/**
 * HQ指示(2026-11-10「価格反応データ A〜D」):
 * - A: 窓の1分足が N 本すべてそろい、発表の時刻ちょうどに終わる足もあるときだけ AVAILABLE
 * - B: 窓の足が後から UNVERIFIED になったら、保存済みの AVAILABLE を UNAVAILABLE で上書きする
 *      (足が1本も読めないときだけ、読み取りの失敗を疑って残す)
 * - D: 窓の終わりから REACTION_FINALITY_MINUTES が過ぎるまでは書かない
 * どれも、何度実行しても同じ結果になること。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { ingestEventPriceReactions, REACTION_FINALITY_MINUTES } from '../../src/ingestion/pipelines/eventReactions.js';
import { JobCounters } from '../../src/ingestion/runner.js';
import { MemoryIngestionStore } from '../helpers/memoryIngestionStore.js';

const RELEASE = '2026-10-18T12:30:00Z';
const T = Date.parse(RELEASE);
const MIN = 60_000;
const NOW = new Date(T + 4 * 60 * MIN); // 4 hours after: every timeframe is final
const TIMEFRAMES = ['1m', '5m', '15m', '30m', '60m'] as const;

function minuteRow(offset: number, status: 'VERIFIED' | 'UNVERIFIED' = 'VERIFIED') {
  const close = 150 + (offset + 1) * 0.01;
  return {
    fx_pair_id: 'pair-usdjpy',
    timestamp: new Date(T + offset * MIN).toISOString(),
    timeframe: '1m' as const,
    open: close,
    high: close,
    low: close,
    close,
    volume: null,
    source: 'test',
    verification_status: status,
    cross_check_source: null,
    cross_check_close: null,
    cross_check_diff_pips: null,
  };
}

/** T−1 〜 T+59 の1分足(全部そろった1時間)。skip の分は入れない、unverified の分は UNVERIFIED。 */
function hour(opts: { skip?: number[]; unverified?: number[] } = {}) {
  return Array.from({ length: 61 }, (_, i) => i - 1)
    .filter((m) => !(opts.skip ?? []).includes(m))
    .map((m) => minuteRow(m, (opts.unverified ?? []).includes(m) ? 'UNVERIFIED' : 'VERIFIED'));
}

describe('ingestEventPriceReactions: complete windows, downgrades and finality (HQ 2026-11-10 A/B/D)', () => {
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

  const run = (now = NOW) => {
    const counters = new JobCounters();
    return ingestEventPriceReactions(store, { horizonDays: 7 }, now, counters).then(() => counters);
  };
  const row = (timeframe: string) => store.eventPriceReactions.find((r) => r.timeframe === timeframe);
  const statuses = () => Object.fromEntries(TIMEFRAMES.map((tf) => [tf, row(tf)?.data_status ?? 'NONE']));

  it('the finality wait is FORWARD (120) + one run interval (20) = 140 minutes', () => {
    expect(REACTION_FINALITY_MINUTES).toBe(140);
  });

  it('A: a full hour of minutes → every timeframe AVAILABLE', async () => {
    store.fxPrices = hour();
    await run();
    expect(Object.values(statuses())).toEqual(['AVAILABLE', 'AVAILABLE', 'AVAILABLE', 'AVAILABLE', 'AVAILABLE']);
  });

  it('A: one missing minute inside the window (both ends present) → that timeframe and longer ones UNAVAILABLE', async () => {
    store.fxPrices = hour({ skip: [9] }); // T+10m に終わる足が無い(15分の窓の途中)
    await run();
    expect(statuses()).toEqual({
      '1m': 'AVAILABLE',
      '5m': 'AVAILABLE',
      '15m': 'UNAVAILABLE',
      '30m': 'UNAVAILABLE',
      '60m': 'UNAVAILABLE',
    });
    expect(row('15m')).toMatchObject({ pips: null, max_upward: null, max_downward: null, post_release_price: null });
  });

  it('A: a missing pre-release minute → every timeframe UNAVAILABLE (no 15-minute lookback fallback)', async () => {
    store.fxPrices = [minuteRow(-3), ...hour({ skip: [-1] })];
    await run();
    expect(Object.values(statuses()).every((s) => s === 'UNAVAILABLE')).toBe(true);
    expect(row('1m')?.pre_release_price).toBeNull();
  });

  it('B: a stored AVAILABLE row is overwritten with UNAVAILABLE once a minute of its window turns UNVERIFIED, and recovers', async () => {
    store.fxPrices = hour();
    await run();
    expect(row('15m')?.data_status).toBe('AVAILABLE');
    // 照合で T+10m の分が UNVERIFIED になった(fx_prices は upsert で書き換わる)
    store.fxPrices = hour({ unverified: [9] });
    const counters = await run();
    expect(statuses()).toEqual({
      '1m': 'AVAILABLE',
      '5m': 'AVAILABLE',
      '15m': 'UNAVAILABLE',
      '30m': 'UNAVAILABLE',
      '60m': 'UNAVAILABLE',
    });
    expect(row('15m')).toMatchObject({ pips: null, max_upward: null });
    expect(counters.skipReasons.KEEP_AVAILABLE ?? 0).toBe(0);
    // 同じ状態でもう一度実行しても同じ(書き直さない)
    const again = await run();
    expect(again.success).toBe(0);
    // 分が元に戻れば AVAILABLE に戻る。行は増えない
    store.fxPrices = hour();
    await run();
    expect(row('15m')?.data_status).toBe('AVAILABLE');
    expect(store.eventPriceReactions).toHaveLength(5);
  });

  it('B: when no minute can be read at all (a suspected read failure), the stored AVAILABLE rows are kept', async () => {
    store.fxPrices = hour();
    await run();
    const before = store.eventPriceReactions.map((r) => ({ ...r }));
    store.fxPrices = [];
    const counters = await run();
    expect(store.eventPriceReactions).toEqual(before);
    expect(counters.skipReasons.KEEP_AVAILABLE).toBe(5);
  });

  it('D: a timeframe is written only once 140 minutes have passed after its window closed', async () => {
    store.fxPrices = hour();
    // 発表の 90 分後: どの時間枠も、窓の終わり + 140 分を過ぎていない
    await run(new Date(T + 90 * MIN));
    expect(store.eventPriceReactions).toEqual([]);
    // 発表の 160 分後: 1m(1+140)・5m(5+140)・15m(15+140)だけ
    await run(new Date(T + 160 * MIN));
    expect(statuses()).toEqual({
      '1m': 'AVAILABLE',
      '5m': 'AVAILABLE',
      '15m': 'AVAILABLE',
      '30m': 'NONE',
      '60m': 'NONE',
    });
    // 発表の 200 分後: 60m(60+140)まで全部
    await run(new Date(T + 200 * MIN));
    expect(Object.values(statuses()).every((s) => s === 'AVAILABLE')).toBe(true);
  });
});
