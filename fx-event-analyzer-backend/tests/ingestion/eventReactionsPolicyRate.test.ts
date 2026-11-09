/**
 * HQ指示(2026-11-10「FOMC 案3」): 政策金利(fomc_policy_decisions)が記録済みの FOMC の会合も、価格反応の計算の
 * 対象にする。会合の行は SCHEDULED・PENDING のまま(api-design v1.47)で、状態は変えない。RELEASED の発表の
 * 扱いは変えない。--event-id(settings.eventId)で1件だけを、期間に関係なく計算できる。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { ingestEventPriceReactions } from '../../src/ingestion/pipelines/eventReactions.js';
import { JobCounters } from '../../src/ingestion/runner.js';
import { MemoryIngestionStore } from '../helpers/memoryIngestionStore.js';

const MIN = 60_000;
const FOMC_AT = '2026-10-28T18:00:00Z'; // 7日の範囲の外(NOW の12日前)
const NFP_AT = '2026-11-06T13:30:00Z'; // 7日の範囲の内
const NOW = new Date('2026-11-09T12:00:00Z');

function candles(releaseIso: string) {
  const t = Date.parse(releaseIso);
  // T−5 〜 T+59(1・5・15・30・60分に足りる)
  return Array.from({ length: 65 }, (_, i) => {
    const close = 150 + i * 0.01;
    return {
      fx_pair_id: 'pair-usdjpy',
      timestamp: new Date(t + (i - 5) * MIN).toISOString(),
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
  });
}

function event(id: string, at: string, status: 'SCHEDULED' | 'RELEASED' | 'CANCELLED', indicator: string) {
  return {
    id,
    indicator_id: indicator,
    provider: 'test',
    provider_event_id: `test:${id}`,
    importance: 'HIGH' as const,
    release_datetime: at,
    release_datetime_precision: 'EXACT' as const,
    status,
    data_status: status === 'RELEASED' ? ('AVAILABLE' as const) : ('PENDING' as const),
    currency_code: 'USD',
  };
}

function decision(eventId: string) {
  return {
    event_id: eventId,
    target_range_lower: 3.75,
    target_range_upper: 4,
    announced_at: FOMC_AT,
    effective_date: '2026-10-29',
    source: 'test',
    source_url: 'https://example.test',
    fetched_at: '2026-11-06T10:55:51Z',
  };
}

describe('ingestEventPriceReactions: FOMC meetings with a recorded policy rate (HQ 2026-11-10 案3)', () => {
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
    store.fxPrices = [...candles(FOMC_AT), ...candles(NFP_AT)];
  });

  const run = (settings: { eventId?: string; range?: { fromIso: string; toIso: string } } = {}, now = NOW) => {
    const counters = new JobCounters();
    return ingestEventPriceReactions(store, { horizonDays: 7, ...settings }, now, counters).then(() => counters);
  };
  const rowsOf = (eventId: string) => store.eventPriceReactions.filter((r) => r.event_id === eventId);

  it('a SCHEDULED meeting with a recorded policy rate is calculated, and its status is not changed', async () => {
    const recent = '2026-11-05T18:00:00Z';
    store.events = [event('fomc-recent', recent, 'SCHEDULED', 'ind-fomc')];
    store.fomcPolicyDecisions = [decision('fomc-recent')];
    store.fxPrices = candles(recent);
    const counters = await run();
    expect(counters.errors).toBe(0);
    expect(rowsOf('fomc-recent').map((r) => r.timeframe)).toEqual(['1m', '5m', '15m', '30m', '60m']);
    expect(rowsOf('fomc-recent').every((r) => r.data_status === 'AVAILABLE')).toBe(true);
    // 状態は SCHEDULED・PENDING のまま(このジョブは economic_events を変えない)
    expect(store.events[0]).toMatchObject({ status: 'SCHEDULED', data_status: 'PENDING' });
  });

  it('a SCHEDULED meeting without a policy rate is not calculated (as before)', async () => {
    const recent = '2026-11-05T18:00:00Z';
    store.events = [event('fomc-no-decision', recent, 'SCHEDULED', 'ind-fomc')];
    store.fxPrices = candles(recent);
    await run();
    expect(rowsOf('fomc-no-decision')).toEqual([]);
  });

  it('a CANCELLED meeting is not calculated even with a decision row', async () => {
    const recent = '2026-11-05T18:00:00Z';
    store.events = [event('fomc-cancelled', recent, 'CANCELLED', 'ind-fomc')];
    store.fomcPolicyDecisions = [decision('fomc-cancelled')];
    store.fxPrices = candles(recent);
    await run();
    expect(rowsOf('fomc-cancelled')).toEqual([]);
  });

  it('the 7-day horizon still applies to meetings (an old meeting needs --event-id)', async () => {
    store.events = [
      event('fomc-1028', FOMC_AT, 'SCHEDULED', 'ind-fomc'),
      event('nfp-1106', NFP_AT, 'RELEASED', 'ind-nfp'),
    ];
    store.fomcPolicyDecisions = [decision('fomc-1028')];
    await run();
    expect(rowsOf('fomc-1028')).toEqual([]);
    // RELEASED の発表はいつもどおり
    expect(rowsOf('nfp-1106')).toHaveLength(5);
  });

  it('--event-id calculates only that meeting, regardless of the horizon', async () => {
    store.events = [
      event('fomc-1028', FOMC_AT, 'SCHEDULED', 'ind-fomc'),
      event('nfp-1106', NFP_AT, 'RELEASED', 'ind-nfp'),
    ];
    store.fomcPolicyDecisions = [decision('fomc-1028')];
    const counters = await run({ eventId: 'fomc-1028' });
    expect(counters.errors).toBe(0);
    expect(rowsOf('fomc-1028')).toHaveLength(5);
    expect(rowsOf('nfp-1106')).toEqual([]); // 指定していない発表は書かない
    expect(store.events.find((e) => e.id === 'fomc-1028')).toMatchObject({
      status: 'SCHEDULED',
      data_status: 'PENDING',
    });
  });

  it('--event-id also works for a RELEASED event outside the horizon', async () => {
    store.events = [event('old-nfp', FOMC_AT, 'RELEASED', 'ind-nfp')];
    const counters = await run({ eventId: 'old-nfp' });
    expect(counters.errors).toBe(0);
    expect(rowsOf('old-nfp')).toHaveLength(5);
  });

  it('--event-id for an event that is neither RELEASED nor a recorded meeting writes nothing and fails', async () => {
    store.events = [event('cpi-scheduled', FOMC_AT, 'SCHEDULED', 'ind-cpi')];
    const counters = await run({ eventId: 'cpi-scheduled' });
    expect(counters.errors).toBe(1);
    expect(store.eventPriceReactions).toEqual([]);
  });

  it('re-running does not duplicate or rewrite unchanged rows', async () => {
    store.events = [event('fomc-1028', FOMC_AT, 'SCHEDULED', 'ind-fomc')];
    store.fomcPolicyDecisions = [decision('fomc-1028')];
    await run({ eventId: 'fomc-1028' });
    const first = store.eventPriceReactions.map((r) => ({ ...r }));
    const counters = await run({ eventId: 'fomc-1028' });
    expect(store.eventPriceReactions).toHaveLength(5);
    expect(store.eventPriceReactions).toEqual(first);
    expect(counters.success).toBe(0);
  });

  it('a meeting that is also RELEASED is listed once', async () => {
    const recent = '2026-11-05T18:00:00Z';
    store.events = [event('fomc-both', recent, 'RELEASED', 'ind-fomc')];
    store.fomcPolicyDecisions = [decision('fomc-both')];
    store.fxPrices = candles(recent);
    const counters = await run();
    expect(counters.fetched).toBe(1);
    expect(rowsOf('fomc-both')).toHaveLength(5);
  });
});
