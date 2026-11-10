/**
 * HQ指示(2026-11-10「経済指標の市場予測値（コンセンサス）取得」): 取得元ごとに履歴を残し、発表の後は足さない・上書きしない。
 * 発表前の最終予想を実績値と比べる。市場予想と公式見通しを分ける。取得元が無ければ UNAVAILABLE。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  CONSENSUS_SOURCE_CANDIDATES,
  CONSENSUS_SOURCES,
  compareForecastsWithActual,
  finalPreReleaseForecasts,
  forecastStatus,
  type ForecastKind,
  type ForecastRow,
} from '../../src/domain/consensusForecasts.js';
import {
  eventReferencePeriod,
  ingestConsensusForecasts,
  type ConsensusAdapter,
  type ForecastEvent,
  type ForecastStore,
  type RawForecast,
} from '../../src/ingestion/pipelines/consensusForecasts.js';
import { JobCounters } from '../../src/ingestion/runner.js';

const RELEASE = '2026-11-18T07:00:00.000Z';
const SOURCE = 'Test Consensus';
const URL = 'https://example.org/consensus';
const APPROVED = [{ source: SOURCE, kind: 'MARKET_CONSENSUS' as const, indicatorCodes: ['GB_CPI'] }];

const row = (over: Partial<ForecastRow>): ForecastRow => ({
  event_id: 'ev-1',
  indicator_code: 'GB_CPI',
  reference_period: '2026-10',
  release_datetime: RELEASE,
  forecast_kind: 'MARKET_CONSENSUS',
  forecast_value: 3.6,
  unit: '%',
  source: SOURCE,
  source_url: URL,
  fetched_at: '2026-11-17T12:00:00.000Z',
  ...over,
});

class MemoryForecastStore implements ForecastStore {
  events: ForecastEvent[] = [
    {
      id: 'ev-1',
      indicator_code: 'GB_CPI',
      release_datetime: RELEASE,
      provider_event_id: 'ons_release_calendar:GB_CPI:2026-10',
    },
    {
      id: 'ev-u',
      indicator_code: 'GB_UNEMPLOYMENT_RATE',
      release_datetime: '2026-11-17T07:00:00.000Z',
      provider_event_id: 'ons_release_calendar:GB_UNEMPLOYMENT_RATE:2026-11-17',
    },
  ];
  rows: ForecastRow[] = [];
  listEventsForForecast(codes: readonly string[], fromIso: string, toIso: string) {
    return Promise.resolve(
      this.events.filter(
        (e) => codes.includes(e.indicator_code) && e.release_datetime > fromIso && e.release_datetime <= toIso,
      ),
    );
  }
  latestForecast(eventId: string, source: string, kind: ForecastKind) {
    const matches = this.rows
      .filter((r) => r.event_id === eventId && r.source === source && r.forecast_kind === kind)
      .sort((a, b) => b.fetched_at.localeCompare(a.fetched_at));
    return Promise.resolve(matches[0] ?? null);
  }
  insertForecast(r: ForecastRow) {
    this.rows.push(r);
    return Promise.resolve();
  }
}

const adapter = (raws: RawForecast[] | Error, over: Partial<ConsensusAdapter> = {}): ConsensusAdapter => ({
  source: SOURCE,
  sourceUrl: URL,
  kind: 'MARKET_CONSENSUS',
  fetch: () => (raws instanceof Error ? Promise.reject(raws) : Promise.resolve(raws)),
  ...over,
});
const raw = (over: Partial<RawForecast> = {}): RawForecast => ({
  indicatorCode: 'GB_CPI',
  referencePeriod: '2026-10',
  releaseDatetime: RELEASE,
  value: 3.6,
  unit: '%',
  ...over,
});

describe('consensus sources (2026-11-10 research)', () => {
  it('no source meets every HQ condition, so none is registered and every indicator is UNAVAILABLE', () => {
    expect(CONSENSUS_SOURCES).toEqual([]);
    expect(CONSENSUS_SOURCE_CANDIDATES.every((c) => c.verdict !== ('ADOPTED' as string))).toBe(true);
    for (const code of ['US_CPI', 'US_NFP', 'JP_CPI', 'EU_HICP', 'GB_CPI', 'AU_CPI', 'CA_UNEMPLOYMENT_RATE']) {
      expect(forecastStatus(code, 'MARKET_CONSENSUS', [])).toBe('UNAVAILABLE');
      expect(forecastStatus(code, 'OFFICIAL_PROJECTION', [])).toBe('UNAVAILABLE');
    }
  });
});

describe('finalPreReleaseForecasts / compareForecastsWithActual / forecastStatus', () => {
  it('picks, per source and kind, the last value fetched before the release; later rows are ignored', () => {
    const rows = [
      row({ forecast_value: 3.4, fetched_at: '2026-11-10T00:00:00.000Z' }),
      row({ forecast_value: 3.6, fetched_at: '2026-11-17T12:00:00.000Z' }),
      row({ forecast_value: 9.9, fetched_at: RELEASE }), // 発表の時刻ちょうど(予想ではない)
      row({ source: 'Other', forecast_value: 3.5, fetched_at: '2026-11-16T00:00:00.000Z' }),
      row({ forecast_kind: 'OFFICIAL_PROJECTION', source: 'Bank', forecast_value: 3.0 }),
      row({ release_datetime: '2026-12-16T07:00:00.000Z', forecast_value: 7 }), // 別の回
    ];
    const finals = finalPreReleaseForecasts(rows, RELEASE);
    expect(finals.map((f) => [f.forecast_kind, f.source, f.forecast_value])).toEqual([
      ['MARKET_CONSENSUS', 'Other', 3.5],
      ['MARKET_CONSENSUS', SOURCE, 3.6],
      ['OFFICIAL_PROJECTION', 'Bank', 3.0],
    ]);
  });

  it('compares the final forecast with the first actual (same unit only), keeping consensus and projection apart', () => {
    const finals = [
      row({ forecast_value: 3.6 }),
      row({ forecast_kind: 'OFFICIAL_PROJECTION', source: 'Bank', forecast_value: 3.0 }),
    ];
    const out = compareForecastsWithActual(finals, { value: 3.7, unit: '%' }, 'HIGHER_IS_POSITIVE');
    expect(out).toEqual([
      expect.objectContaining({
        forecast_kind: 'MARKET_CONSENSUS',
        forecast: 3.6,
        actual: 3.7,
        difference: 0.1,
        direction: 'POSITIVE',
      }),
      expect.objectContaining({ forecast_kind: 'OFFICIAL_PROJECTION', forecast: 3.0, actual: 3.7, difference: 0.7 }),
    ]);
    expect(compareForecastsWithActual(finals, { value: 3.7, unit: 'index' }, 'HIGHER_IS_POSITIVE')[0]).toMatchObject({
      actual: null,
      difference: null,
      direction: null,
    });
    expect(
      compareForecastsWithActual(finals, { value: null, unit: null }, 'HIGHER_IS_POSITIVE')[0]!.difference,
    ).toBeNull();
  });

  it('status: UNAVAILABLE without a source, DATA_PREPARING with a source but no forecast, AVAILABLE with one', () => {
    expect(forecastStatus('GB_CPI', 'MARKET_CONSENSUS', [], APPROVED)).toBe('DATA_PREPARING');
    expect(forecastStatus('GB_CPI', 'MARKET_CONSENSUS', [row({})], APPROVED)).toBe('AVAILABLE');
    expect(forecastStatus('GB_CPI', 'OFFICIAL_PROJECTION', [row({})], APPROVED)).toBe('UNAVAILABLE');
    expect(forecastStatus('AU_CPI', 'MARKET_CONSENSUS', [], APPROVED)).toBe('UNAVAILABLE');
  });
});

describe('ingestConsensusForecasts', () => {
  let store: MemoryForecastStore;
  const NOW = new Date('2026-11-17T12:00:00Z');
  const run = (adapters: ConsensusAdapter[], now = NOW, sources = APPROVED) => {
    const counters = new JobCounters();
    return ingestConsensusForecasts({ store, adapters, sources, now: () => now }, counters).then((r) => ({
      ...r,
      counters,
    }));
  };
  beforeEach(() => {
    store = new MemoryForecastStore();
  });

  it('stores a pre-release forecast with source, unit, period, release time and fetched time', async () => {
    const { inserted } = await run([adapter([raw()])]);
    expect(inserted).toBe(1);
    expect(store.rows).toEqual([row({ fetched_at: NOW.toISOString(), forecast_value: 3.6 })]);
  });

  it('a re-run with the same value adds nothing; a changed value adds a new row and keeps the old one', async () => {
    await run([adapter([raw()])]);
    const same = await run([adapter([raw()])], new Date('2026-11-17T18:00:00Z'));
    expect(same.inserted).toBe(0);
    expect(same.counters.skipReasons.UNCHANGED).toBe(1);
    await run([adapter([raw({ value: 3.7 })])], new Date('2026-11-18T06:00:00Z'));
    expect(store.rows.map((r) => [r.forecast_value, r.fetched_at])).toEqual([
      [3.6, NOW.toISOString()],
      [3.7, '2026-11-18T06:00:00.000Z'],
    ]);
  });

  it('nothing is added at or after the release time', async () => {
    const { counters } = await run([adapter([raw({ value: 3.8 })])], new Date(RELEASE));
    expect(store.rows).toEqual([]);
    expect(counters.skipReasons.AFTER_RELEASE).toBe(1);
  });

  it('rejects other release times, other periods, unverifiable periods, missing value/unit and uncovered indicators', async () => {
    const { counters } = await run([
      adapter([
        raw({ releaseDatetime: '2026-11-18T08:00:00.000Z' }),
        raw({ referencePeriod: '2026-09' }),
        raw({ value: Number.NaN }),
        raw({ unit: ' ' }),
        raw({
          indicatorCode: 'GB_UNEMPLOYMENT_RATE',
          referencePeriod: '2026-11',
          releaseDatetime: '2026-11-17T07:00:00.000Z',
        }),
      ]),
    ]);
    expect(store.rows).toEqual([]);
    expect(counters.skipReasons).toMatchObject({
      EVENT_MISMATCH: 1,
      PERIOD_MISMATCH: 1,
      NO_VALUE_OR_UNIT: 2,
      INDICATOR_NOT_COVERED: 1,
    });
    // 取得元が指標を持っていても、イベントの対象期間を照合できない回は入れない
    const both = [{ ...APPROVED[0]!, indicatorCodes: ['GB_CPI', 'GB_UNEMPLOYMENT_RATE'] }];
    const r = await run(
      [
        adapter([
          raw({
            indicatorCode: 'GB_UNEMPLOYMENT_RATE',
            referencePeriod: '2026-11',
            releaseDatetime: '2026-11-17T07:00:00.000Z',
          }),
        ]),
      ],
      new Date('2026-11-16T00:00:00Z'),
      both,
    );
    expect(r.counters.skipReasons.PERIOD_UNVERIFIED).toBe(1);
    expect(store.rows).toEqual([]);
  });

  it('an unapproved source, a non-https source URL or a fetch failure writes nothing', async () => {
    const a = await run([adapter([raw()], { source: 'Unknown' })]);
    expect(a.counters.skipReasons.SOURCE_NOT_APPROVED).toBe(1);
    const b = await run([adapter([raw()], { sourceUrl: 'http://example.org' })]);
    expect(b.counters.skipReasons.NO_SOURCE_URL).toBe(1);
    const c = await run([adapter(new Error('HTTP 503'))]);
    expect(c.counters.skipReasons.FETCH_FAILED).toBe(1);
    expect(store.rows).toEqual([]);
  });

  it('with the registered sources (none), the job writes nothing', async () => {
    const counters = new JobCounters();
    const r = await ingestConsensusForecasts({ store, adapters: [adapter([raw()])], now: () => NOW }, counters);
    expect(r.inserted).toBe(0);
    expect(store.rows).toEqual([]);
  });

  it('eventReferencePeriod reads only an explicit YYYY-MM suffix', () => {
    expect(eventReferencePeriod('ons_release_calendar:GB_CPI:2026-10')).toBe('2026-10');
    expect(eventReferencePeriod('abs_release_calendar:AU_CPI:2026-11-25')).toBeNull();
    expect(eventReferencePeriod(null)).toBeNull();
  });
});
