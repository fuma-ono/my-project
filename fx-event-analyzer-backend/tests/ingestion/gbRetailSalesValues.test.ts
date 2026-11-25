/**
 * 英国の小売売上高の前月比(GB_RETAIL_SALES_MOM、ONS 系列 J5EC・データセット DRSI)。応答の形は 2026-11-18 に
 * https://www.ons.gov.uk/businessindustryandtrade/retailindustry/timeseries/j5ec/drsi/data で取った本物と同じ
 * (unit '%'・2026-10-23 公表で 2026 JUL -0.4 / AUG 0.7 / SEP -0.4、更新日は 22日 23:00Z = ロンドン 23日 00:00 BST)。
 * 初回値は、API の公表日・対象月(公表予定の表の referencePeriod)・数値・出典がそろったときだけ保存する。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { attributionForIndicator, ONS_ATTRIBUTION } from '../../src/domain/attribution.js';
import {
  ONS_SERIES,
  onsValueForPeriod,
  parseOnsValueForRelease,
} from '../../src/ingestion/adapters/gbCaOfficialValues.js';
import { ONS_SCHEDULE, type OfficialScheduleTable } from '../../src/ingestion/mappings/gbAuCaSchedule.js';
import { officialScheduleUtc } from '../../src/ingestion/pipelines/officialScheduleTable.js';
import { ingestOfficialValues, OFFICIAL_VALUE_SOURCES } from '../../src/ingestion/pipelines/officialValues.js';
import { JobCounters } from '../../src/ingestion/runner.js';
import { MemoryIngestionStore } from '../helpers/memoryIngestionStore.js';

const J5EC = ONS_SERIES.find((s) => s.indicatorCode === 'GB_RETAIL_SALES_MOM')!;
const URL = 'https://www.ons.gov.uk/businessindustryandtrade/retailindustry/timeseries/j5ec/drsi/data';
const TITLE = 'RSI:Month on prev month % change:All Business All retail inc fuel VOL SA';
/** 英国時間(夏時間)の日付の 00:00 = 前日 23:00Z。 */
const bst = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) - 3600_000).toISOString();

type Row = [date: string, value: string, updatedOn: string];
function j5ec(rows: Row[], releasedOn: string, overrides: Record<string, unknown> = {}) {
  return {
    description: { cdid: 'J5EC', title: TITLE, unit: '%', releaseDate: bst(releasedOn), ...overrides },
    months: rows.map(([date, value, updatedOn]) => ({ date, value, updateDate: bst(updatedOn) })),
  };
}
const OCT23: Row[] = [
  ['2026 JUL', '-0.4', '2026-10-23'],
  ['2026 AUG', '0.7', '2026-10-23'],
  ['2026 SEP', '-0.4', '2026-10-23'],
];

describe('GB_RETAIL_SALES_MOM series (ONS J5EC)', () => {
  it('is wired to the all-retail-including-fuel volume month-on-month series', () => {
    expect(J5EC).toMatchObject({ cdid: 'J5EC', path: 'businessindustryandtrade/retailindustry/timeseries/j5ec/drsi' });
    expect(OFFICIAL_VALUE_SOURCES.some((s) => s.indicatorCode === 'GB_RETAIL_SALES_MOM')).toBe(true);
  });

  it('takes the last row on the release day (London date, BST)', () => {
    expect(parseOnsValueForRelease(J5EC, j5ec(OCT23, '2026-10-23'), '2026-10-23')).toEqual({
      indicatorCode: 'GB_RETAIL_SALES_MOM',
      seriesId: 'J5EC',
      period: '2026-09',
      value: -0.4,
      releasedOn: '2026-10-23',
      sourceUrl: URL,
    });
  });

  it('returns null before the release, for another series or title (e.g. the year-on-year series), and blank values', () => {
    expect(parseOnsValueForRelease(J5EC, j5ec(OCT23, '2026-10-23'), '2026-11-20')).toBeNull();
    const yoy = j5ec(OCT23, '2026-10-23', {
      title: 'RSI:All retail inc fuel:All Business:VOL SA:% change on same month a year ago',
    });
    expect(parseOnsValueForRelease(J5EC, yoy, '2026-10-23')).toBeNull();
    expect(parseOnsValueForRelease(J5EC, j5ec(OCT23, '2026-10-23', { cdid: 'J5EB' }), '2026-10-23')).toBeNull();
    expect(
      parseOnsValueForRelease(J5EC, j5ec([['2026 SEP', '', '2026-10-23']], '2026-10-23'), '2026-10-23'),
    ).toBeNull();
    expect(
      parseOnsValueForRelease(J5EC, j5ec([['2026 SEP', '-', '2026-10-23']], '2026-10-23'), '2026-10-23'),
    ).toBeNull();
  });

  it('reads a past month for the revision check', () => {
    expect(onsValueForPeriod(J5EC, j5ec(OCT23, '2026-10-23'), '2026-08')).toBe(0.7);
    expect(onsValueForPeriod(J5EC, j5ec(OCT23, '2026-10-23'), '2026-05')).toBeNull();
  });

  it('carries the ONS attribution (OGL v3.0)', () => {
    expect(attributionForIndicator('GB_RETAIL_SALES_MOM')).toEqual(ONS_ATTRIBUTION);
  });
});

describe('GB_RETAIL_SALES_MOM schedule (each release page on https://www.ons.gov.uk/releases/, checked 2026-11-18)', () => {
  const entries = ONS_SCHEDULE.entries.filter((e) => e.indicatorCode === 'GB_RETAIL_SALES_MOM');

  it('lists 6 releases at 07:00 London time, keyed and referenced by the data month', () => {
    expect(entries.map((e) => `${e.key} ${e.releaseDate} ${e.referencePeriod}`)).toEqual([
      '2026-10 2026-11-20 2026-10',
      '2026-11 2026-12-18 2026-11',
      '2026-12 2027-01-22 2026-12',
      '2027-01 2027-02-19 2027-01',
      '2027-02 2027-03-25 2027-02',
      '2027-03 2027-04-23 2027-03',
    ]);
    expect(entries.every((e) => e.time === '07:00' && e.timeZone === 'Europe/London')).toBe(true);
  });

  it('is 07:00Z in winter and 06:00Z in British Summer Time', () => {
    expect(officialScheduleUtc(entries[0]!)!.toISOString()).toBe('2026-11-20T07:00:00.000Z');
    expect(officialScheduleUtc(entries[5]!)!.toISOString()).toBe('2027-04-23T06:00:00.000Z');
  });
});

class FakeFetcher {
  responses = new Map<string, unknown>();
  failing = new Set<string>();
  getJson(url: string): Promise<unknown> {
    if (this.failing.has(url)) return Promise.reject(new Error('HTTP 503'));
    return Promise.resolve(this.responses.get(url) ?? {});
  }
}

describe('ingestOfficialValues — GB_RETAIL_SALES_MOM', () => {
  const sources = OFFICIAL_VALUE_SOURCES.filter((s) => s.indicatorCode === 'GB_RETAIL_SALES_MOM');
  // 2026-10-23 公表の September 2026 分を、表の1行として使う(実際の表は 11/20 の October 2026 分から)
  const table: OfficialScheduleTable = {
    provider: 'ons_release_calendar',
    entries: [
      {
        indicatorCode: 'GB_RETAIL_SALES_MOM',
        key: '2026-09',
        referencePeriod: '2026-09',
        releaseDate: '2026-10-23',
        time: '07:00',
        timeZone: 'Europe/London',
        sources: ['https://www.ons.gov.uk/releases/retailsalesgreatbritainseptember2026'],
        checkedAt: '2026-11-18',
      },
    ],
  };
  const AFTER = new Date('2026-10-23T09:00:00Z');
  let store: MemoryIngestionStore;
  let fetcher: FakeFetcher;

  beforeEach(() => {
    store = new MemoryIngestionStore();
    fetcher = new FakeFetcher();
    store.indicators = [
      { id: 'ind-rs', code: 'GB_RETAIL_SALES_MOM', importance: 'MEDIUM', favorable_direction: 'HIGHER_IS_POSITIVE' },
    ];
    store.events = [
      {
        id: 'ev-sep',
        indicator_id: 'ind-rs',
        provider: 'ons_release_calendar',
        provider_event_id: 'ons_release_calendar:GB_RETAIL_SALES_MOM:2026-09',
        importance: 'MEDIUM',
        release_datetime: '2026-10-23T06:00:00.000Z',
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

  it('publishes the first value (negative values included) with unit, source and a verification label', async () => {
    fetcher.responses.set(URL, j5ec(OCT23, '2026-10-23'));
    const r = await run();
    expect(r.published).toBe(1);
    expect(store.snapshots).toEqual([
      expect.objectContaining({
        event_id: 'ev-sep',
        actual: -0.4,
        forecast: null,
        previous: null,
        unit: '%',
        source: 'Office for National Statistics',
        source_url: URL,
        verification_status: 'VERIFIED',
        verification_source: 'J5EC@2026-09',
      }),
    ]);
    expect(store.events[0]).toMatchObject({ status: 'RELEASED', data_status: 'AVAILABLE' });
  });

  it('stays DATA_PENDING when the API has not moved, the fetch fails, or the last row is another month', async () => {
    fetcher.responses.set(URL, j5ec([['2026 AUG', '0.7', '2026-09-18']], '2026-09-18'));
    expect((await run()).counters.skipReasons.NOT_RELEASED_OR_DATE_MISMATCH).toBe(1);
    fetcher.failing.add(URL);
    expect((await run()).counters.skipReasons.FETCH_FAILED).toBe(1);
    fetcher.failing.clear();
    fetcher.responses.set(URL, j5ec([['2026 OCT', '0.1', '2026-10-23']], '2026-10-23'));
    await run();
    expect(store.snapshots).toEqual([]);
    expect(store.events[0]).toMatchObject({ status: 'SCHEDULED', data_status: 'PENDING' });
  });

  it('a re-run adds nothing; a later revision of September goes to event_revisions, the first value stays', async () => {
    fetcher.responses.set(URL, j5ec(OCT23, '2026-10-23'));
    await run();
    expect((await run()).published).toBe(0);
    // 11/20 の公表で September が -0.2 に改定
    fetcher.responses.set(
      URL,
      j5ec(
        [
          ['2026 SEP', '-0.2', '2026-11-20'],
          ['2026 OCT', '0.5', '2026-11-20'],
        ],
        '2026-11-20',
      ),
    );
    const r = await run(new Date('2026-11-20T09:00:00Z'));
    expect(r.revisions).toBe(1);
    expect(store.snapshots[0]!.actual).toBe(-0.4);
    expect(store.revisions).toEqual([
      expect.objectContaining({ event_id: 'ev-sep', field_name: 'ACTUAL', old_value: -0.4, new_value: -0.2 }),
    ]);
  });
});
