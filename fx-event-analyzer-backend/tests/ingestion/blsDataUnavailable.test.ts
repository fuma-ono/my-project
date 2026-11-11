/**
 * CPI 2026-11-10 DATA_UNAVAILABLE 対応(案A、HQ指示 2026-11-11)。
 * 対象は表の2件(US_CPI・US_CORE_CPI の 2026-10)だけ。RELEASED・UNAVAILABLE と理由・出典を書き、実績値・サプライズは
 * 作らない。前月比を前年比にしない。何度動かしても同じ。反応値は実績値なしでも計算でき、計算後も状態は変わらない。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  BLS_DATA_UNAVAILABLE,
  BLS_DATA_UNAVAILABLE_REASON,
  isBlsDataUnavailable,
} from '../../src/ingestion/mappings/blsDataUnavailable.js';
import { BLS_SCHEDULE } from '../../src/ingestion/mappings/blsSchedule.js';
import {
  applyBlsDataUnavailable,
  type BlsDataUnavailableStore,
  type NewExplanation,
  type StoredExplanation,
} from '../../src/ingestion/pipelines/blsDataUnavailable.js';
import {
  buildBlsScheduleReleases,
  createBlsNativeResolver,
  scheduleObservationRange,
} from '../../src/ingestion/pipelines/blsCalendar.js';
import { ingestEventPriceReactions } from '../../src/ingestion/pipelines/eventReactions.js';
import { JobCounters } from '../../src/ingestion/runner.js';
import type { OfficialObservation } from '../../src/ingestion/types.js';
import { MemoryIngestionStore } from '../helpers/memoryIngestionStore.js';

const RELEASE = '2026-11-10T13:30:00.000Z';
const AFTER = new Date('2026-11-11T03:00:00Z');

const obs = (seriesId: string, period: string, value: number | null): OfficialObservation => ({
  source: 'BLS',
  seriesId,
  periodStart: `${period}-01`,
  value,
  asOfDate: '2026-11-11',
  releaseStatus: 'UNKNOWN',
});
/** BLS API の 2026-11-11 の形: 2025-10 は "-"(null)、2026-10 は公表済み。前月比の系列(CUSR…)も入れておく。 */
const BLS_NOW: OfficialObservation[] = [
  obs('CUUR0000SA0', '2025-09', 324.8),
  obs('CUUR0000SA0', '2025-10', null),
  obs('CUUR0000SA0', '2025-11', 324.122),
  obs('CUUR0000SA0', '2026-09', 336.94),
  obs('CUUR0000SA0', '2026-10', 337.511),
  obs('CUUR0000SA0L1E', '2025-10', null),
  obs('CUUR0000SA0L1E', '2026-09', 339.287),
  obs('CUUR0000SA0L1E', '2026-10', 339.921),
  obs('CUSR0000SA0', '2026-09', 336.298),
  obs('CUSR0000SA0', '2026-10', 337.476),
];

class Store extends MemoryIngestionStore implements BlsDataUnavailableStore {
  explanations: (NewExplanation & { published_at: string })[] = [];
  getLatestExplanation(eventId: string): Promise<StoredExplanation | null> {
    const rows = this.explanations.filter((e) => e.event_id === eventId).sort((a, b) => b.version - a.version);
    return Promise.resolve(rows[0] ?? null);
  }
  insertExplanation(row: NewExplanation) {
    if (this.explanations.some((e) => e.event_id === row.event_id && e.version === row.version)) {
      return Promise.reject(new Error('duplicate key event_explanations (event_id, version)'));
    }
    this.explanations.push(row);
    return Promise.resolve();
  }
}

const event = (id: string, code: string, period: string, over: Record<string, unknown> = {}) => ({
  id,
  indicator_id: `ind-${code}`,
  provider: 'bls_schedule',
  provider_event_id: `bls_schedule:${code}:${period}`,
  importance: 'HIGH',
  release_datetime: RELEASE,
  release_datetime_precision: 'EXACT' as const,
  status: 'SCHEDULED' as const,
  data_status: 'PENDING' as const,
  currency_code: 'USD',
  ...over,
});

describe('applyBlsDataUnavailable', () => {
  let store: Store;
  const run = (over: { observations?: OfficialObservation[]; now?: Date; dryRun?: boolean } = {}) => {
    const counters = new JobCounters();
    return applyBlsDataUnavailable(
      {
        store,
        entries: BLS_DATA_UNAVAILABLE,
        observations: over.observations ?? BLS_NOW,
        now: () => over.now ?? AFTER,
        ...(over.dryRun ? { dryRun: true } : {}),
      },
      counters,
    ).then((result) => ({ result, counters }));
  };

  beforeEach(() => {
    store = new Store();
    store.events = [
      event('ev-cpi', 'US_CPI', '2026-10'),
      event('ev-core', 'US_CORE_CPI', '2026-10'),
      // ほかの回・ほかの指標(触れてはいけない)
      event('ev-cpi-sep', 'US_CPI', '2026-09', { release_datetime: '2026-10-14T12:30:00.000Z' }),
      event('ev-cpi-nov', 'US_CPI', '2026-11', { release_datetime: '2026-12-10T13:30:00.000Z' }),
      event('ev-ppi', 'US_PPI', '2026-10', { release_datetime: '2026-11-13T13:30:00.000Z' }),
    ];
  });

  it('1-4. only the two 2026-10 CPI events become RELEASED / UNAVAILABLE with the reason and the BLS source; no value is written', async () => {
    const { result } = await run();
    expect(result.applied).toEqual(['US_CPI:2026-10', 'US_CORE_CPI:2026-10']);
    const byId = Object.fromEntries(store.events.map((e) => [e.id, [e.status, e.data_status]]));
    expect(byId).toEqual({
      'ev-cpi': ['RELEASED', 'UNAVAILABLE'],
      'ev-core': ['RELEASED', 'UNAVAILABLE'],
      'ev-cpi-sep': ['SCHEDULED', 'PENDING'],
      'ev-cpi-nov': ['SCHEDULED', 'PENDING'],
      'ev-ppi': ['SCHEDULED', 'PENDING'],
    });
    expect(store.snapshots).toEqual([]); // 実績値・予想・前回値・サプライズを作らない
    expect(store.explanations).toEqual([
      {
        event_id: 'ev-cpi',
        version: 1,
        explanation_type: 'FACT_SUMMARY',
        summary: 'BLSが2025年10月の指数を公表していないため、2026年10月分の前年比を計算できません。',
        source: 'U.S. Bureau of Labor Statistics',
        source_url: 'https://data.bls.gov/timeseries/CUUR0000SA0',
        published_at: RELEASE,
      },
      expect.objectContaining({ event_id: 'ev-core', source_url: 'https://data.bls.gov/timeseries/CUUR0000SA0L1E' }),
    ]);
    expect(store.explanations[1]!.summary).toBe(BLS_DATA_UNAVAILABLE_REASON);
  });

  it('5. the month-over-month series is never used as the year-over-year value (no snapshot even though CUSR has both months)', async () => {
    await run();
    expect(store.snapshots).toEqual([]);
    expect(store.explanations.every((e) => !/前月比|MoM/.test(e.summary))).toBe(true);
  });

  it('6. the table is only these two releases; the normal BLS path is unchanged for every other release', () => {
    expect(BLS_DATA_UNAVAILABLE.map((e) => `${e.indicatorCode}:${e.referencePeriod}:${e.releaseDatetimeUtc}`)).toEqual([
      'US_CPI:2026-10:2026-11-10T13:30:00.000Z',
      'US_CORE_CPI:2026-10:2026-11-10T13:30:00.000Z',
    ]);
    expect(isBlsDataUnavailable({ indicatorCode: 'US_CPI', referencePeriod: '2026-10' })).toBe(true);
    expect(isBlsDataUnavailable({ indicatorCode: 'US_CPI', referencePeriod: '2026-11' })).toBe(false);
    expect(isBlsDataUnavailable({ indicatorCode: 'US_PPI', referencePeriod: '2026-10' })).toBe(false);
    expect(
      BLS_SCHEDULE.filter((e) => isBlsDataUnavailable(e)).map((e) => `${e.indicatorCode}:${e.releaseDate}`),
    ).toEqual(['US_CPI:2026-11-10', 'US_CORE_CPI:2026-11-10']);
  });

  it('7. a re-run changes nothing (no second explanation, no second update)', async () => {
    await run();
    const second = await run();
    expect(second.result).toMatchObject({ applied: [], unchanged: ['US_CPI:2026-10', 'US_CORE_CPI:2026-10'] });
    expect(store.explanations).toHaveLength(2);
  });

  it('does nothing when a condition fails: release time differs, before the release, month not out, base month now published, value already stored', async () => {
    store.events[0]!.release_datetime = '2026-11-12T13:30:00.000Z';
    let r = await run();
    expect(r.result.skipped).toContainEqual({ key: 'US_CPI:2026-10', reason: 'RELEASE_TIME_MISMATCH' });
    store.events[0]!.release_datetime = RELEASE;

    r = await run({ now: new Date('2026-11-10T13:00:00Z') });
    expect(r.result.applied).toEqual([]);
    expect(r.counters.skipReasons.NOT_RELEASED_YET).toBe(2);

    r = await run({ observations: BLS_NOW.filter((o) => o.periodStart !== '2026-10-01') });
    expect(r.counters.skipReasons.REFERENCE_PERIOD_NOT_PUBLISHED).toBe(2);

    r = await run({
      observations: BLS_NOW.map((o) => (o.periodStart === '2025-10-01' ? { ...o, value: 325.0 } : o)),
    });
    expect(r.counters.skipReasons.BASE_PERIOD_NOW_AVAILABLE).toBe(2); // 通常の取り込みに任せる

    store.snapshots.push({ event_id: 'ev-cpi', forecast: null, actual: 3.2, previous: 3.1 } as never);
    r = await run();
    expect(r.result.skipped).toContainEqual({ key: 'US_CPI:2026-10', reason: 'HAS_RELEASE_SNAPSHOT' });
    expect(store.events.find((e) => e.id === 'ev-cpi')!.status).toBe('SCHEDULED');
    expect(r.result.unchanged).toContain('US_CORE_CPI:2026-10'); // コアCPI は最初の回で反映済み(ほかの回の条件に左右されない)
  });

  it('dry-run writes nothing and lists what it would write', async () => {
    const { result } = await run({ dryRun: true });
    expect(result.planned.map((p) => [p.key, p.event, p.explanation?.summary])).toEqual([
      ['US_CPI:2026-10', { status: 'RELEASED', data_status: 'UNAVAILABLE' }, BLS_DATA_UNAVAILABLE_REASON],
      ['US_CORE_CPI:2026-10', { status: 'RELEASED', data_status: 'UNAVAILABLE' }, BLS_DATA_UNAVAILABLE_REASON],
    ]);
    expect(store.events.find((e) => e.id === 'ev-cpi')!.status).toBe('SCHEDULED');
    expect(store.explanations).toEqual([]);
  });

  it('8-9. reactions for all 5 USD pairs x 5 timeframes are computed without an actual value (CPI and core CPI); the events stay RELEASED / UNAVAILABLE', async () => {
    await run();
    const T = Date.parse(RELEASE);
    const pair = (symbol: string, base: string, quote: string, pip: number, precision: number) => ({
      id: `p-${symbol.toLowerCase()}`,
      symbol,
      pip_size: pip,
      price_precision: precision,
      base_currency: base,
      quote_currency: quote,
    });
    // 本番の対象: USD を含む有効なペア(AUDUSD・EURUSD・GBPUSD・USDCHF・USDJPY)。EURJPY は USD を含まないので対象外
    store.fxPairs = [
      pair('AUDUSD', 'AUD', 'USD', 0.0001, 5),
      pair('EURUSD', 'EUR', 'USD', 0.0001, 5),
      pair('GBPUSD', 'GBP', 'USD', 0.0001, 5),
      pair('USDCHF', 'USD', 'CHF', 0.0001, 5),
      pair('USDJPY', 'USD', 'JPY', 0.01, 3),
      pair('EURJPY', 'EUR', 'JPY', 0.01, 3),
    ];
    const basePrice: Record<string, number> = {
      AUDUSD: 0.65,
      EURUSD: 1.08,
      GBPUSD: 1.27,
      USDCHF: 0.88,
      USDJPY: 154,
      EURJPY: 166,
    };
    store.fxPrices = store.fxPairs.flatMap((p) =>
      Array.from({ length: 76 }, (_, i) => {
        const close = basePrice[p.symbol]! + i * p.pip_size;
        return {
          fx_pair_id: p.id,
          timestamp: new Date(T + (i - 15) * 60_000).toISOString(), // 13:15 〜 14:30(DEV で確かめた 76 本と同じ範囲)
          timeframe: '1m' as const,
          open: close,
          high: close,
          low: close,
          close,
          volume: null,
          source: 'twelvedata',
          verification_status: 'SINGLE_SOURCE' as const,
          cross_check_source: null,
          cross_check_close: null,
          cross_check_diff_pips: null,
        };
      }),
    );
    const targets = ['p-audusd', 'p-eurusd', 'p-gbpusd', 'p-usdchf', 'p-usdjpy'];
    const expected = targets.flatMap((p) => ['1m', '5m', '15m', '30m', '60m'].map((tf) => [p, tf, 'AVAILABLE'])).sort();
    for (const eventId of ['ev-cpi', 'ev-core']) {
      const counters = new JobCounters();
      await ingestEventPriceReactions(store, { horizonDays: 7, eventId }, new Date('2026-11-11T03:00:00Z'), counters);
      const rows = store.eventPriceReactions.filter((r) => r.event_id === eventId);
      expect(rows).toHaveLength(25); // 5 ペア × 5 時間足
      expect(rows.map((r) => [r.fx_pair_id, r.timeframe, r.data_status]).sort()).toEqual(expected);
      expect(rows.some((r) => r.fx_pair_id === 'p-eurjpy')).toBe(false);
      expect(rows.every((r) => r.pre_release_price !== null && r.pips !== null)).toBe(true);
      expect(store.events.find((e) => e.id === eventId)).toMatchObject({
        status: 'RELEASED',
        data_status: 'UNAVAILABLE',
      });
    }
    // 同じペア・時間足・イベントで重複しない
    const keys = store.eventPriceReactions.map((r) => `${r.event_id}:${r.fx_pair_id}:${r.timeframe}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(store.snapshots).toEqual([]);
  });
});

describe('ingest:official:bls-calendar with the table', () => {
  it('puts the two releases in dataUnavailable instead of notYetAvailable / overdue, and leaves every other release as before', async () => {
    const provider = {
      name: 'bls',
      fetchObservations: (q: { seriesId: string }) => Promise.resolve(BLS_NOW.filter((o) => o.seriesId === q.seriesId)),
    };
    const official = createBlsNativeResolver(provider as never, scheduleObservationRange(BLS_SCHEDULE));
    const entries = BLS_SCHEDULE.filter((e) => e.releaseDate === '2026-11-10');
    const built = await buildBlsScheduleReleases({ official, entries, now: () => new Date('2026-12-01T00:00:00Z') });
    expect(built.dataUnavailable.map((e) => e.indicatorCode)).toEqual(['US_CPI', 'US_CORE_CPI']);
    expect(built.notYetAvailable).toEqual([]);
    expect(built.overdue).toEqual([]);
    expect(built.releases).toEqual([]); // 値の無い回は今までどおり書かない

    // 表に無い回は今までどおり(元の月が無ければ notYetAvailable)
    // 表に無い回は今までどおり: 値が作れる回(2026-09)は releases、まだ出ていない回(2026-11)は notYetAvailable
    const other = [
      { indicatorCode: 'US_CPI' as const, referencePeriod: '2026-09', releaseDate: '2026-10-14' },
      { indicatorCode: 'US_CPI' as const, referencePeriod: '2026-11', releaseDate: '2026-12-10' },
    ];
    const builtOther = await buildBlsScheduleReleases({
      official,
      entries: other,
      now: () => new Date('2026-12-11T00:00:00Z'),
    });
    expect(builtOther.dataUnavailable).toEqual([]);
    expect(builtOther.releases.map((r) => r.referencePeriod)).toEqual(['2026-09']);
    expect(builtOther.notYetAvailable.map((e) => e.referencePeriod)).toEqual(['2026-11']);
  });
});
