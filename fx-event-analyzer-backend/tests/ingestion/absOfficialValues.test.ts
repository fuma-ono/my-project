/**
 * 豪州 ABS(SDMX)の発表値(HQ追加指示 2026-11-10)。応答の形は 2026-11-10 に data.api.abs.gov.au で取った本物と同じ
 * (系列の属性 UNIT_MEASURE、観測の属性 DECIMALS、観測の次元 TIME_PERIOD)。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  ABS_SERIES,
  absReleaseUrl,
  absValueForPeriod,
  parseAbsValueForRelease,
} from '../../src/ingestion/adapters/absOfficialValues.js';
import { HttpError } from '../../src/ingestion/http.js';
import { ABS_SCHEDULE, type OfficialScheduleTable } from '../../src/ingestion/mappings/gbAuCaSchedule.js';
import { ingestOfficialValues, OFFICIAL_VALUE_SOURCES } from '../../src/ingestion/pipelines/officialValues.js';
import { JobCounters } from '../../src/ingestion/runner.js';
import { MemoryIngestionStore } from '../helpers/memoryIngestionStore.js';

const LF = ABS_SERIES.find((s) => s.indicatorCode === 'AU_UNEMPLOYMENT_RATE')!;
const CPI = ABS_SERIES.find((s) => s.indicatorCode === 'AU_CPI')!;

/** obs: [月, 値, DECIMALS の位置(null = なし)] */
function sdmx(obs: [string, number, number | null][], unit = 'PCT') {
  return {
    data: {
      dataSets: [
        {
          series: {
            '0:0:0:0:0:0': {
              attributes: [0, 0],
              observations: Object.fromEntries(obs.map(([, value, dec], i) => [String(i), [value, null, null, dec]])),
            },
          },
        },
      ],
      structures: [
        {
          dimensions: { observation: [{ id: 'TIME_PERIOD', values: obs.map(([p]) => ({ id: p })) }] },
          attributes: {
            series: [
              { id: 'UNIT_MEASURE', values: [{ id: unit }] },
              { id: 'UNIT_MULT', values: [{ id: '0' }] },
            ],
            observation: [
              { id: 'OBS_STATUS', values: [] },
              { id: 'OBS_COMMENT', values: [] },
              { id: 'DECIMALS', values: [{ id: '1' }] },
            ],
          },
        },
      ],
    },
  };
}

/**
 * updatedAfter の応答(差分)。本物と同じく Delete と Replace の2つの dataSet で、Replace の系列の UNIT_MEASURE は空。
 * obs: 更新された観測 [月, 値]。
 */
function delta(obs: [string, number][]) {
  const periods = ['2026-08', ...obs.map(([p]) => p)];
  return {
    data: {
      dataSets: [
        { action: 'Delete', series: { '0:0:0:0:0:0': { attributes: [0, 0], observations: { '0': [1, 0, 0, 0] } } } },
        {
          action: 'Replace',
          series: {
            '0:0:0:0:0:0': {
              attributes: [1, null],
              observations: Object.fromEntries(obs.map(([, v], i) => [String(i + 1), [v, null, null, 0]])),
            },
          },
        },
      ],
      structures: [
        {
          dimensions: { observation: [{ id: 'TIME_PERIOD', values: periods.map((p) => ({ id: p })) }] },
          attributes: {
            series: [
              { id: 'UNIT_MEASURE', values: [{ id: '1' }, { id: '' }] },
              { id: 'UNIT_MULT', values: [{ id: '1' }] },
            ],
            observation: [
              { id: 'OBS_STATUS', values: [{ id: '1' }] },
              { id: 'OBS_COMMENT', values: [{}] },
              { id: 'DECIMALS', values: [{ id: '1' }] },
            ],
          },
        },
      ],
    },
  };
}

describe('ABS SDMX adapter', () => {
  it('reads the last observation, rounded to the official DECIMALS (4.71834873 → 4.7)', () => {
    const body = sdmx([
      ['2026-08', 4.65160785, 0],
      ['2026-09', 4.71834873, 0],
    ]);
    // 公表日の差分(本物と同じ形: 2026-09 だけが Replace、単位は空)+ 系列全体
    expect(parseAbsValueForRelease(LF, delta([['2026-09', 4.71834873]]), '2026-10-15', body)).toEqual({
      indicatorCode: 'AU_UNEMPLOYMENT_RATE',
      seriesId: 'ABS,LF,1.0.0/M13.3.1599.20.AUS.M',
      period: '2026-09',
      value: 4.7,
      releasedOn: '2026-10-15',
      sourceUrl: 'https://data.api.abs.gov.au/rest/data/ABS,LF,1.0.0/M13.3.1599.20.AUS.M?lastNObservations=13',
    });
    expect(absValueForPeriod(LF, body, '2026-08')).toBe(4.7);
    expect(absValueForPeriod(CPI, sdmx([['2026-09', 4.3, null]]), '2026-09')).toBe(4.3); // DECIMALS なし → そのまま
  });

  it('rejects a unit other than PCT, an empty body and malformed periods', () => {
    const upd = delta([['2026-09', 4.3]]);
    expect(parseAbsValueForRelease(CPI, upd, '2026-10-28', sdmx([['2026-09', 4.3, null]], 'IDX'))).toBeNull();
    expect(parseAbsValueForRelease(CPI, {}, '2026-10-28', sdmx([['2026-09', 4.3, null]]))).toBeNull();
    expect(parseAbsValueForRelease(CPI, upd, '2026-10-28', {})).toBeNull();
    expect(parseAbsValueForRelease(CPI, upd, '2026-10-28', sdmx([['2026-08', 4.0, null]]))).toBeNull(); // 全体にその月が無い
    expect(parseAbsValueForRelease(CPI, upd, '2026-10-28', sdmx([['2026-09', 4.4, null]]))).toBeNull(); // 値が違う
    expect(absValueForPeriod(CPI, delta([['2026-09', 4.3]]), '2026-09')).toBeNull(); // 差分だけでは単位が無い
    expect(absValueForPeriod(CPI, sdmx([['2026-Q3', 4.3, null]]), '2026-Q3')).toBeNull();
  });

  it('the release URL asks only for updates after 00:00 Sydney on the release day (AEDT/AEST)', () => {
    expect(absReleaseUrl(CPI, '2026-11-25')).toBe(
      'https://data.api.abs.gov.au/rest/data/ABS,CPI,2.0.0/3.10001.10.50.M?updatedAfter=2026-11-24T13:00:00Z&lastNObservations=13',
    );
    expect(absReleaseUrl(LF, '2027-04-15')).toContain('updatedAfter=2027-04-14T14:00:00Z'); // AEST(4月)
  });

  it('every ABS release has a reference period (3 from the latest-release pages, 3 from the release calendar), and the key stays the release date', () => {
    const periods = ABS_SCHEDULE.entries.map((e) => [e.indicatorCode, e.releaseDate, e.referencePeriod ?? null]);
    expect(periods).toEqual([
      ['AU_CPI', '2026-11-25', '2026-10'],
      ['AU_CPI', '2027-01-06', '2026-11'],
      ['AU_CPI', '2027-01-27', '2026-12'],
      ['AU_CPI', '2027-02-24', '2027-01'],
      ['AU_CPI', '2027-03-24', '2027-02'],
      ['AU_CPI', '2027-04-28', '2027-03'],
      ['AU_UNEMPLOYMENT_RATE', '2026-11-19', '2026-10'],
      ['AU_UNEMPLOYMENT_RATE', '2026-12-17', '2026-11'],
      ['AU_UNEMPLOYMENT_RATE', '2027-01-21', '2026-12'],
      ['AU_UNEMPLOYMENT_RATE', '2027-02-18', '2027-01'],
      ['AU_UNEMPLOYMENT_RATE', '2027-03-25', '2027-02'],
      ['AU_UNEMPLOYMENT_RATE', '2027-04-15', '2027-03'],
    ]);
    for (const e of ABS_SCHEDULE.entries) expect(e.key).toBe(e.releaseDate); // provider_event_id は変えない
  });
});

class FakeFetcher {
  responses = new Map<string, unknown>();
  notFound = new Set<string>();
  calls: string[] = [];
  getJson(url: string): Promise<unknown> {
    this.calls.push(url);
    if (this.notFound.has(url)) return Promise.reject(new HttpError('abs: HTTP 404', 404, false));
    return Promise.resolve(this.responses.get(url) ?? {});
  }
}

describe('ingestOfficialValues — ABS', () => {
  const sources = OFFICIAL_VALUE_SOURCES.filter((s) => s.indicatorCode === 'AU_UNEMPLOYMENT_RATE');
  const table: OfficialScheduleTable = {
    provider: 'abs_release_calendar',
    entries: ABS_SCHEDULE.entries.filter((e) => e.indicatorCode === 'AU_UNEMPLOYMENT_RATE'),
  };
  const RELEASE_URL = absReleaseUrl(LF, '2026-11-19')!;
  const BASE_URL = 'https://data.api.abs.gov.au/rest/data/ABS,LF,1.0.0/M13.3.1599.20.AUS.M?lastNObservations=13';
  const AFTER = new Date('2026-11-19T02:00:00Z'); // 11:30 AEDT = 00:30Z の後
  let store: MemoryIngestionStore;
  let fetcher: FakeFetcher;

  beforeEach(() => {
    store = new MemoryIngestionStore();
    fetcher = new FakeFetcher();
    store.indicators = [
      { id: 'ind-au-u', code: 'AU_UNEMPLOYMENT_RATE', importance: 'MEDIUM', favorable_direction: 'LOWER_IS_POSITIVE' },
    ];
    store.events = [
      {
        id: 'ev-au',
        indicator_id: 'ind-au-u',
        provider: 'abs_release_calendar',
        provider_event_id: 'abs_release_calendar:AU_UNEMPLOYMENT_RATE:2026-11-19',
        importance: 'MEDIUM',
        release_datetime: '2026-11-19T00:30:00.000Z',
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

  it('publishes October once the series was updated on the release day', async () => {
    fetcher.responses.set(
      BASE_URL,
      sdmx([
        ['2026-09', 4.71834873, 0],
        ['2026-10', 4.7612, 0],
      ]),
    );
    fetcher.responses.set(RELEASE_URL, delta([['2026-10', 4.7612]]));
    const r = await run();
    expect(r.published).toBe(1);
    expect(store.snapshots[0]).toMatchObject({
      event_id: 'ev-au',
      actual: 4.8,
      unit: '%',
      source: 'Australian Bureau of Statistics',
      verification_source: 'ABS,LF,1.0.0/M13.3.1599.20.AUS.M@2026-10',
      forecast: null,
      previous: null,
    });
    expect(store.events[0]).toMatchObject({ status: 'RELEASED', data_status: 'AVAILABLE' });
  });

  it('404 NoRecordsFound (not updated since the release day began) keeps DATA_PENDING', async () => {
    fetcher.notFound.add(RELEASE_URL);
    const r = await run();
    expect(store.snapshots).toEqual([]);
    expect(store.events[0]!.status).toBe('SCHEDULED');
    expect(r.counters.skipReasons.NOT_RELEASED_OR_DATE_MISMATCH).toBe(1);
  });

  it('an update that still ends in September (period mismatch) saves nothing — no previous value is reused', async () => {
    fetcher.responses.set(BASE_URL, sdmx([['2026-09', 4.71834873, 0]]));
    fetcher.responses.set(RELEASE_URL, delta([['2026-09', 4.71834873]]));
    const r = await run();
    expect(store.snapshots).toEqual([]);
    expect(r.counters.skipReasons.PERIOD_MISMATCH).toBe(1);
  });

  it('more than 7 days after the release no first value is taken (it could already be revised)', async () => {
    fetcher.responses.set(BASE_URL, sdmx([['2026-10', 4.7612, 0]]));
    fetcher.responses.set(RELEASE_URL, delta([['2026-10', 4.7612]]));
    const r = await run(new Date('2026-11-27T01:00:00Z'));
    expect(store.snapshots).toEqual([]);
    expect(r.counters.skipReasons.TOO_LATE_FOR_FIRST_RELEASE).toBe(1);
  });

  it('a later revision goes to event_revisions; the first value stays', async () => {
    fetcher.responses.set(BASE_URL, sdmx([['2026-10', 4.7612, 0]]));
    fetcher.responses.set(RELEASE_URL, delta([['2026-10', 4.7612]]));
    await run();
    fetcher.responses.set(
      BASE_URL,
      sdmx([
        ['2026-10', 4.6903, 0],
        ['2026-11', 4.7, 0],
      ]),
    );
    const r = await run(new Date('2026-12-17T02:00:00Z'));
    expect(r.revisions).toBe(1);
    expect(store.snapshots[0]!.actual).toBe(4.8);
    expect(store.revisions).toEqual([
      expect.objectContaining({ event_id: 'ev-au', field_name: 'ACTUAL', old_value: 4.8, new_value: 4.7 }),
    ]);
  });
});
