/**
 * 豪州の賃金指数 WPI の前期比(AU_WPI_QOQ、ABS データ API の WPI 1.2.0、キー 2.THRPEB.7.TOT.20.AUS.Q)。
 * 応答の形は 2026-11-18 に data.api.abs.gov.au で取った本物と同じ(四半期 'YYYY-Qn'・新しい順・UNIT_MEASURE=PCT・
 * 観測の属性は OBS_STATUS / OBS_COMMENT だけで DECIMALS なし。2026-Q3 = 1.1 は ABS の公表文「rose 1.1% in the September
 * quarter 2026」と一致)。初回値は、更新日・対象四半期・単位・数値がそろったときだけ保存する。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { attributionForIndicator, ABS_ATTRIBUTION } from '../../src/domain/attribution.js';
import {
  ABS_SERIES,
  absReleaseUrl,
  absSeriesUrl,
  absValueForPeriod,
  parseAbsValueForRelease,
} from '../../src/ingestion/adapters/absOfficialValues.js';
import { ABS_SCHEDULE, type OfficialScheduleTable } from '../../src/ingestion/mappings/gbAuCaSchedule.js';
import { officialScheduleUtc } from '../../src/ingestion/pipelines/officialScheduleTable.js';
import { ingestOfficialValues, OFFICIAL_VALUE_SOURCES } from '../../src/ingestion/pipelines/officialValues.js';
import { JobCounters } from '../../src/ingestion/runner.js';
import { MemoryIngestionStore } from '../helpers/memoryIngestionStore.js';

const WPI = ABS_SERIES.find((s) => s.indicatorCode === 'AU_WPI_QOQ')!;

/** obs: [四半期, 値]。実際の応答と同じく観測は [値] だけ(DECIMALS なし)、時間は新しい順で渡す。 */
function sdmx(obs: [string, number][], unit: string | null = 'PCT') {
  return {
    data: {
      dataSets: [
        {
          action: 'Information',
          series: {
            '0:0:0:0:0:0:0': {
              attributes: [unit === null ? null : 0, null],
              observations: Object.fromEntries(obs.map(([, value], i) => [String(i), [value]])),
            },
          },
        },
      ],
      structures: [
        {
          dimensions: { observation: [{ id: 'TIME_PERIOD', values: obs.map(([p]) => ({ id: p })) }] },
          attributes: {
            series: [
              { id: 'UNIT_MEASURE', values: unit === null ? [] : [{ id: unit }] },
              { id: 'BASE_PERIOD', values: [] },
            ],
            observation: [
              { id: 'OBS_STATUS', values: [] },
              { id: 'OBS_COMMENT', values: [] },
            ],
          },
        },
      ],
    },
  };
}
const SEP: [string, number][] = [
  ['2026-Q3', 1.1],
  ['2026-Q2', 0.7],
  ['2026-Q1', 0.8],
];

describe('AU_WPI_QOQ series (ABS WPI)', () => {
  it('is wired to the seasonally adjusted quarterly change of total hourly rates excluding bonuses', () => {
    expect(WPI).toEqual({
      quarterly: true,
      indicatorCode: 'AU_WPI_QOQ',
      dataflow: 'ABS,WPI,1.2.0',
      key: '2.THRPEB.7.TOT.20.AUS.Q',
    });
    expect(absSeriesUrl(WPI)).toBe(
      'https://data.api.abs.gov.au/rest/data/ABS,WPI,1.2.0/2.THRPEB.7.TOT.20.AUS.Q?lastNObservations=13',
    );
    expect(absReleaseUrl(WPI, '2027-02-23')).toContain('updatedAfter=2027-02-22T13:00:00Z'); // AEDT(2月)
    expect(OFFICIAL_VALUE_SOURCES.some((s) => s.indicatorCode === 'AU_WPI_QOQ')).toBe(true);
    expect(attributionForIndicator('AU_WPI_QOQ')).toEqual(ABS_ATTRIBUTION);
  });

  it('reads the quarter that the update touched (not the latest by position) when the unit is PCT', () => {
    const release = parseAbsValueForRelease(WPI, sdmx([['2026-Q3', 1.1]]), '2026-11-18', sdmx(SEP));
    expect(release).toMatchObject({
      indicatorCode: 'AU_WPI_QOQ',
      period: '2026-Q3',
      value: 1.1,
      releasedOn: '2026-11-18',
      seriesId: 'ABS,WPI,1.2.0/2.THRPEB.7.TOT.20.AUS.Q',
    });
  });

  it('returns null when nothing was updated, the unit is not PCT, the quarter is missing or the two responses disagree', () => {
    expect(parseAbsValueForRelease(WPI, sdmx([]), '2026-11-18', sdmx(SEP))).toBeNull();
    expect(parseAbsValueForRelease(WPI, sdmx([['2026-Q3', 1.1]]), '2026-11-18', sdmx(SEP, null))).toBeNull();
    expect(parseAbsValueForRelease(WPI, sdmx([['2026-Q3', 1.1]]), '2026-11-18', sdmx(SEP, 'IDX'))).toBeNull();
    expect(parseAbsValueForRelease(WPI, sdmx([['2026-Q4', 0.9]]), '2026-11-18', sdmx(SEP))).toBeNull();
    expect(parseAbsValueForRelease(WPI, sdmx([['2026-Q3', 1.0]]), '2026-11-18', sdmx(SEP))).toBeNull();
    expect(parseAbsValueForRelease(WPI, { unexpected: true }, '2026-11-18', sdmx(SEP))).toBeNull();
  });

  it('ignores a time period that is neither a month nor a quarter', () => {
    expect(parseAbsValueForRelease(WPI, sdmx([['2026', 1.1]]), '2026-11-18', sdmx([['2026', 1.1]]))).toBeNull();
    expect(absValueForPeriod(WPI, sdmx(SEP), '2026-Q9')).toBeNull();
  });

  it('reads a past quarter for the revision check (keeps 0.0 and negative values)', () => {
    expect(absValueForPeriod(WPI, sdmx(SEP), '2026-Q2')).toBe(0.7);
    expect(absValueForPeriod(WPI, sdmx(SEP), '2025-Q1')).toBeNull();
    expect(absValueForPeriod(WPI, sdmx([['2026-Q3', 0]]), '2026-Q3')).toBe(0);
    expect(absValueForPeriod(WPI, sdmx([['2026-Q3', -0.1]]), '2026-Q3')).toBe(-0.1);
    expect(absValueForPeriod(WPI, sdmx(SEP, 'IDX'), '2026-Q3')).toBeNull();
  });
});

describe('AU_WPI_QOQ schedule (latest-release page "Next Release", checked 2026-11-18)', () => {
  const entries = ABS_SCHEDULE.entries.filter((e) => e.indicatorCode === 'AU_WPI_QOQ');

  it('lists 3 releases keyed by release date, each with its quarter', () => {
    expect(entries.map((e) => `${e.key} ${e.referencePeriod} ${e.time} ${e.timeZone}`)).toEqual([
      '2027-02-23 2026-Q4 11:30 Australia/Sydney',
      '2027-05-19 2027-Q1 11:30 Australia/Sydney',
      '2027-08-18 2027-Q2 11:30 Australia/Sydney',
    ]);
    expect(entries.every((e) => e.checkedAt === '2026-11-18' && e.sources.length === 2)).toBe(true);
  });

  it('converts 11:30 Sydney to UTC across daylight saving (AEDT in February, AEST in May)', () => {
    expect(officialScheduleUtc(entries[0]!)!.toISOString()).toBe('2027-02-23T00:30:00.000Z');
    expect(officialScheduleUtc(entries[1]!)!.toISOString()).toBe('2027-05-19T01:30:00.000Z');
  });
});

class FakeFetcher {
  responses = new Map<string, unknown>();
  notFound = new Set<string>();
  failing = new Set<string>();
  getJson(url: string): Promise<unknown> {
    if (this.failing.has(url)) return Promise.reject(new Error('HTTP 503'));
    if (this.notFound.has(url)) return Promise.reject(Object.assign(new Error('abs: HTTP 404'), { status: 404 }));
    return Promise.resolve(this.responses.get(url) ?? {});
  }
}

describe('ingestOfficialValues — AU_WPI_QOQ', () => {
  const sources = OFFICIAL_VALUE_SOURCES.filter((s) => s.indicatorCode === 'AU_WPI_QOQ');
  // 2026-11-18 公表の September 2026 四半期を、表の1行として使う(実際の表は 2027-02-23 の December 2026 四半期から)
  const table: OfficialScheduleTable = {
    provider: 'abs_release_calendar',
    entries: [
      {
        indicatorCode: 'AU_WPI_QOQ',
        key: '2026-11-18',
        referencePeriod: '2026-Q3',
        releaseDate: '2026-11-18',
        time: '11:30',
        timeZone: 'Australia/Sydney',
        sources: [
          'https://www.abs.gov.au/statistics/economy/price-indexes-and-inflation/wage-price-index-australia/latest-release',
        ],
        checkedAt: '2026-11-18',
      },
    ],
  };
  const AFTER = new Date('2026-11-18T06:00:00Z');
  const fullUrl = absSeriesUrl(WPI);
  const releaseUrl = absReleaseUrl(WPI, '2026-11-18')!;
  let store: MemoryIngestionStore;
  let fetcher: FakeFetcher;

  beforeEach(() => {
    store = new MemoryIngestionStore();
    fetcher = new FakeFetcher();
    store.indicators = [
      { id: 'ind-wpi', code: 'AU_WPI_QOQ', importance: 'MEDIUM', favorable_direction: 'HIGHER_IS_POSITIVE' },
    ];
    store.events = [
      {
        id: 'ev-q3',
        indicator_id: 'ind-wpi',
        provider: 'abs_release_calendar',
        provider_event_id: 'abs_release_calendar:AU_WPI_QOQ:2026-11-18',
        importance: 'MEDIUM',
        release_datetime: '2026-11-18T00:30:00.000Z',
        release_datetime_precision: 'EXACT',
        status: 'SCHEDULED',
        data_status: 'PENDING',
      },
    ];
  });
  const run = (now = AFTER) => {
    const counters = new JobCounters();
    return ingestOfficialValues({ store, fetcher, sources, tables: [table], now: () => now }, counters).then((r) => ({
      ...r,
      counters,
    }));
  };

  it('publishes the first value with unit, source and a verification label that carries the quarter', async () => {
    fetcher.responses.set(releaseUrl, sdmx([['2026-Q3', 1.1]]));
    fetcher.responses.set(fullUrl, sdmx(SEP));
    const r = await run();
    expect(r.published).toBe(1);
    expect(store.snapshots).toEqual([
      expect.objectContaining({
        event_id: 'ev-q3',
        actual: 1.1,
        forecast: null,
        previous: null,
        unit: '%',
        source: 'Australian Bureau of Statistics',
        verification_status: 'VERIFIED',
        verification_source: 'ABS,WPI,1.2.0/2.THRPEB.7.TOT.20.AUS.Q@2026-Q3',
      }),
    ]);
    expect(store.events[0]).toMatchObject({ status: 'RELEASED', data_status: 'AVAILABLE' });
  });

  it('stays DATA_PENDING before the update (404), on a fetch failure, or when the updated quarter is not the scheduled one', async () => {
    fetcher.notFound.add(releaseUrl);
    fetcher.responses.set(fullUrl, sdmx(SEP));
    await run();
    expect(store.snapshots).toEqual([]);
    fetcher.notFound.clear();
    fetcher.failing.add(releaseUrl);
    expect((await run()).counters.skipReasons.FETCH_FAILED).toBe(1);
    fetcher.failing.clear();
    fetcher.responses.set(releaseUrl, sdmx([['2026-Q4', 0.9]]));
    fetcher.responses.set(fullUrl, sdmx([['2026-Q4', 0.9], ...SEP]));
    await run();
    expect(store.snapshots).toEqual([]);
    expect(store.events[0]).toMatchObject({ status: 'SCHEDULED', data_status: 'PENDING' });
  });

  it('a re-run adds nothing; a later revision of the same quarter goes to event_revisions, the first value stays', async () => {
    fetcher.responses.set(releaseUrl, sdmx([['2026-Q3', 1.1]]));
    fetcher.responses.set(fullUrl, sdmx(SEP));
    await run();
    expect((await run()).published).toBe(0);
    // 公表から 45 日以内の取得で 2026-Q3 が 1.0 に改定されていた場合(改定の確認は公表の 45 日後まで)
    fetcher.responses.set(fullUrl, sdmx([['2026-Q3', 1.0], ...SEP.slice(1)]));
    const r = await run(new Date('2026-12-17T06:00:00Z'));
    expect(r.revisions).toBe(1);
    expect(store.snapshots[0]!.actual).toBe(1.1);
    expect(store.revisions).toEqual([
      expect.objectContaining({ event_id: 'ev-q3', field_name: 'ACTUAL', old_value: 1.1, new_value: 1.0 }),
    ]);
  });
});
