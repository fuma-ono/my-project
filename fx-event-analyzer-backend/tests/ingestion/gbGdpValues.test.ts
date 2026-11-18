/**
 * 英国の月次 GDP の前月比(GB_GDP_MOM、ONS 系列 ECYX)。応答の形は 2026-11-18 に
 * https://www.ons.gov.uk/economy/grossdomesticproductgdp/timeseries/ecyx/mgdp/data で取った本物と同じ
 * (unit が空・title に 'period on period growth'・2026-11-12 公表で AUG と SEP が更新、JUL は 2026-09-10 の更新)。
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

const ECYX = ONS_SERIES.find((s) => s.indicatorCode === 'GB_GDP_MOM')!;
const URL = 'https://www.ons.gov.uk/economy/grossdomesticproductgdp/timeseries/ecyx/mgdp/data';
const midnight = (date: string) => `${date}T00:00:00.000Z`;
const TITLE = 'Gross Value Added - Monthly (period on period growth) :CVM SA';

type Row = [date: string, value: string, updatedOn: string];
function ecyx(rows: Row[], releasedOn: string, overrides: Record<string, unknown> = {}) {
  return {
    description: { cdid: 'ECYX', title: TITLE, unit: '', releaseDate: midnight(releasedOn), ...overrides },
    months: rows.map(([date, value, updatedOn]) => ({ date, value, updateDate: midnight(updatedOn) })),
  };
}
const NOV12: Row[] = [
  ['2026 JUL', '0.4', '2026-09-10'],
  ['2026 AUG', '0.0', '2026-11-12'],
  ['2026 SEP', '0.2', '2026-11-12'],
];

describe('GB_GDP_MOM series (ONS ECYX)', () => {
  it('is wired to the month-on-month growth series, not the index (ECY2)', () => {
    expect(ECYX).toMatchObject({ cdid: 'ECYX', path: 'economy/grossdomesticproductgdp/timeseries/ecyx/mgdp' });
    expect(OFFICIAL_VALUE_SOURCES.some((s) => s.indicatorCode === 'GB_GDP_MOM')).toBe(true);
  });

  it('takes the last row on the release day', () => {
    expect(parseOnsValueForRelease(ECYX, ecyx(NOV12, '2026-11-12'), '2026-11-12')).toEqual({
      indicatorCode: 'GB_GDP_MOM',
      seriesId: 'ECYX',
      period: '2026-09',
      value: 0.2,
      releasedOn: '2026-11-12',
      sourceUrl: URL,
    });
  });

  it('keeps a legitimate 0.0 and a negative value (not treated as missing)', () => {
    const one = (value: string) => ecyx([['2026 AUG', value, '2026-11-12']], '2026-11-12');
    expect(parseOnsValueForRelease(ECYX, one('0.0'), '2026-11-12')!.value).toBe(0);
    expect(parseOnsValueForRelease(ECYX, one('-0.3'), '2026-11-12')!.value).toBe(-0.3);
  });

  it('returns null when the API still shows the previous release, or the title is not the growth series', () => {
    expect(parseOnsValueForRelease(ECYX, ecyx(NOV12, '2026-11-12'), '2026-12-11')).toBeNull();
    const index = ecyx(NOV12, '2026-11-12', { title: 'Gross Value Added - Monthly (Index 1dp) :CVM SA' });
    expect(parseOnsValueForRelease(ECYX, index, '2026-11-12')).toBeNull();
    expect(onsValueForPeriod(ECYX, index, '2026-09')).toBeNull();
    expect(parseOnsValueForRelease(ECYX, ecyx(NOV12, '2026-11-12', { cdid: 'ECY2' }), '2026-11-12')).toBeNull();
  });

  it('reads a past month for the revision check (Aug was updated on 2026-11-12)', () => {
    expect(onsValueForPeriod(ECYX, ecyx(NOV12, '2026-11-12'), '2026-08')).toBe(0);
    expect(onsValueForPeriod(ECYX, ecyx(NOV12, '2026-11-12'), '2026-06')).toBeNull();
  });

  it('carries the ONS attribution (OGL v3.0)', () => {
    expect(attributionForIndicator('GB_GDP_MOM')).toEqual(ONS_ATTRIBUTION);
  });
});

describe('GB_GDP_MOM schedule (each release page on https://www.ons.gov.uk/releases/, checked 2026-11-18)', () => {
  const entries = ONS_SCHEDULE.entries.filter((e) => e.indicatorCode === 'GB_GDP_MOM');

  it('lists 5 releases at 07:00 London time, keyed and referenced by the data month', () => {
    expect(entries.map((e) => `${e.key} ${e.releaseDate} ${e.time} ${e.timeZone} ${e.referencePeriod}`)).toEqual([
      '2026-10 2026-12-11 07:00 Europe/London 2026-10',
      '2026-11 2027-01-15 07:00 Europe/London 2026-11',
      '2026-12 2027-02-12 07:00 Europe/London 2026-12',
      '2027-01 2027-03-11 07:00 Europe/London 2027-01',
      '2027-02 2027-04-14 07:00 Europe/London 2027-02',
    ]);
    expect(entries.every((e) => e.checkedAt === '2026-11-18' && e.sources.length > 0)).toBe(true);
  });

  it('is 07:00Z in winter and 06:00Z once British Summer Time starts (2027-03-28)', () => {
    expect(officialScheduleUtc(entries[0]!)!.toISOString()).toBe('2026-12-11T07:00:00.000Z');
    expect(officialScheduleUtc(entries[4]!)!.toISOString()).toBe('2027-04-14T06:00:00.000Z');
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

describe('ingestOfficialValues — GB_GDP_MOM', () => {
  const sources = OFFICIAL_VALUE_SOURCES.filter((s) => s.indicatorCode === 'GB_GDP_MOM');
  // 2026-11-12 公表の September 2026 分を、表の1行として使う(実際の表は 12/11 の October 2026 分から)
  const table: OfficialScheduleTable = {
    provider: 'ons_release_calendar',
    entries: [
      {
        indicatorCode: 'GB_GDP_MOM',
        key: '2026-09',
        referencePeriod: '2026-09',
        releaseDate: '2026-11-12',
        time: '07:00',
        timeZone: 'Europe/London',
        sources: ['https://www.ons.gov.uk/releases/gdpmonthlyestimateukseptember2026'],
        checkedAt: '2026-11-18',
      },
    ],
  };
  const AFTER = new Date('2026-11-12T09:00:00Z');
  let store: MemoryIngestionStore;
  let fetcher: FakeFetcher;

  beforeEach(() => {
    store = new MemoryIngestionStore();
    fetcher = new FakeFetcher();
    store.indicators = [
      { id: 'ind-gdp', code: 'GB_GDP_MOM', importance: 'HIGH', favorable_direction: 'HIGHER_IS_POSITIVE' },
    ];
    store.events = [
      {
        id: 'ev-sep',
        indicator_id: 'ind-gdp',
        provider: 'ons_release_calendar',
        provider_event_id: 'ons_release_calendar:GB_GDP_MOM:2026-09',
        importance: 'HIGH',
        release_datetime: '2026-11-12T07:00:00.000Z',
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

  it('publishes the first value with unit, source and a verification label', async () => {
    fetcher.responses.set(URL, ecyx(NOV12, '2026-11-12'));
    const r = await run();
    expect(r.published).toBe(1);
    expect(store.snapshots).toEqual([
      expect.objectContaining({
        event_id: 'ev-sep',
        actual: 0.2,
        forecast: null,
        previous: null,
        unit: '%',
        source: 'Office for National Statistics',
        source_url: URL,
        verification_status: 'VERIFIED',
        verification_source: 'ECYX@2026-09',
      }),
    ]);
    expect(store.events[0]).toMatchObject({ status: 'RELEASED', data_status: 'AVAILABLE' });
  });

  it('stays DATA_PENDING when the API has not moved, the fetch fails, or the data month differs from the table', async () => {
    fetcher.responses.set(URL, ecyx(NOV12.slice(0, 1), '2026-10-14'));
    expect((await run()).counters.skipReasons.NOT_RELEASED_OR_DATE_MISMATCH).toBe(1);
    fetcher.failing.add(URL);
    expect((await run()).counters.skipReasons.FETCH_FAILED).toBe(1);
    fetcher.failing.clear();
    // 公表日は合うが、最後の行が 10月分(表は 9月分) — 別の月の値を使わない
    fetcher.responses.set(URL, ecyx([['2026 OCT', '0.1', '2026-11-12']], '2026-11-12'));
    await run();
    expect(store.snapshots).toEqual([]);
    expect(store.events[0]).toMatchObject({ status: 'SCHEDULED', data_status: 'PENDING' });
  });

  it('a re-run adds nothing; a later revision of September goes to event_revisions, the first value stays', async () => {
    fetcher.responses.set(URL, ecyx(NOV12, '2026-11-12'));
    await run();
    expect((await run()).published).toBe(0);
    // 12/11 の公表で September が 0.3 に改定
    fetcher.responses.set(
      URL,
      ecyx(
        [
          ['2026 SEP', '0.3', '2026-12-11'],
          ['2026 OCT', '-0.1', '2026-12-11'],
        ],
        '2026-12-11',
      ),
    );
    const r = await run(new Date('2026-12-11T09:00:00Z'));
    expect(r.revisions).toBe(1);
    expect(store.snapshots[0]!.actual).toBe(0.2);
    expect(store.revisions).toEqual([
      expect.objectContaining({ event_id: 'ev-sep', field_name: 'ACTUAL', old_value: 0.2, new_value: 0.3 }),
    ]);
  });
});
