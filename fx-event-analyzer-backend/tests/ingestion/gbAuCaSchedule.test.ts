/**
 * 英国・豪州・カナダの公表予定(HQ指示 2026-11-10「6地域の経済指標拡張・実装準備」)。人が公式ページで確認した表と、
 * 表から economic_events を作る共通の処理。時刻の変換(夏時間)・重複しない・過去の回を作らない・過去/RELEASED の行を
 * 守る・指標が無いときに何も書かない、を確かめる。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  ABS_SCHEDULE,
  GB_AU_CA_SCHEDULES,
  ONS_SCHEDULE,
  STATCAN_SCHEDULE,
  type OfficialScheduleEntry,
  type OfficialScheduleTable,
} from '../../src/ingestion/mappings/gbAuCaSchedule.js';
import {
  ingestOfficialScheduleTables,
  officialScheduleProviderEventId,
  officialScheduleUtc,
} from '../../src/ingestion/pipelines/officialScheduleTable.js';
import { JobCounters } from '../../src/ingestion/runner.js';
import { MemoryIngestionStore } from '../helpers/memoryIngestionStore.js';

const NOW = new Date('2026-11-10T06:00:00Z');
const CODES = [
  'GB_CPI',
  'GB_CORE_CPI',
  'GB_UNEMPLOYMENT_RATE',
  'AU_CPI',
  'AU_UNEMPLOYMENT_RATE',
  'CA_CPI',
  'CA_UNEMPLOYMENT_RATE',
];

const at = (entry: Partial<OfficialScheduleEntry>): OfficialScheduleEntry => ({
  indicatorCode: 'GB_CPI',
  key: '2026-10',
  releaseDate: '2026-11-18',
  time: '07:00',
  timeZone: 'Europe/London',
  sources: ['https://www.ons.gov.uk/releasecalendar'],
  checkedAt: '2026-11-10',
  ...entry,
});

describe('the tables read from the official pages on 2026-11-10', () => {
  it('ONS: CPI and core CPI (same release, 2026-11-18 07:00) and the UK labour market (4 releases)', () => {
    expect(ONS_SCHEDULE.entries.map((e) => `${e.indicatorCode} ${e.releaseDate} ${e.time} ${e.timeZone}`)).toEqual([
      'GB_CPI 2026-11-18 07:00 Europe/London',
      'GB_CORE_CPI 2026-11-18 07:00 Europe/London',
      'GB_UNEMPLOYMENT_RATE 2026-11-17 07:00 Europe/London',
      'GB_UNEMPLOYMENT_RATE 2026-12-15 07:00 Europe/London',
      'GB_UNEMPLOYMENT_RATE 2027-01-19 07:00 Europe/London',
      'GB_UNEMPLOYMENT_RATE 2027-02-16 07:00 Europe/London',
    ]);
  });

  it('ABS: CPI and Labour Force (6 releases each, 11:30 Australia/Sydney), keyed by the release date (no guessed data month)', () => {
    const byCode = (code: string) =>
      ABS_SCHEDULE.entries.filter((e) => e.indicatorCode === code).map((e) => e.releaseDate);
    expect(byCode('AU_CPI')).toEqual([
      '2026-11-25',
      '2027-01-06',
      '2027-01-27',
      '2027-02-24',
      '2027-03-24',
      '2027-04-28',
    ]);
    expect(byCode('AU_UNEMPLOYMENT_RATE')).toEqual([
      '2026-11-19',
      '2026-12-17',
      '2027-01-21',
      '2027-02-18',
      '2027-03-25',
      '2027-04-15',
    ]);
    for (const e of ABS_SCHEDULE.entries) expect(e.key).toBe(e.releaseDate);
  });

  it('StatCan: CPI (5) and Labour Force Survey (4), 08:30 Eastern, keyed by the data month the official JSON gives', () => {
    expect(STATCAN_SCHEDULE.entries.map((e) => `${e.indicatorCode} ${e.key} ${e.releaseDate}`)).toEqual([
      'CA_CPI 2026-10 2026-11-16',
      'CA_CPI 2026-11 2026-12-14',
      'CA_CPI 2026-12 2027-01-18',
      'CA_CPI 2027-01 2027-02-16',
      'CA_CPI 2027-02 2027-03-15',
      'CA_UNEMPLOYMENT_RATE 2026-11 2026-12-04',
      'CA_UNEMPLOYMENT_RATE 2026-12 2027-01-08',
      'CA_UNEMPLOYMENT_RATE 2027-01 2027-02-05',
      'CA_UNEMPLOYMENT_RATE 2027-02 2027-03-12',
    ]);
  });

  it('every entry is in the future at the check date, has a source and unique provider_event_id', () => {
    for (const table of GB_AU_CA_SCHEDULES) {
      const ids = table.entries.map((e) => officialScheduleProviderEventId(table.provider, e));
      expect(new Set(ids).size).toBe(ids.length);
      for (const e of table.entries) {
        expect(officialScheduleUtc(e)!.getTime()).toBeGreaterThan(NOW.getTime());
        expect(e.sources.length).toBeGreaterThanOrEqual(1); // ABS の対象月のある回は latest-release ページも
        expect(e.checkedAt).toBe('2026-11-10');
      }
    }
  });
});

describe('officialScheduleUtc (daylight saving per time zone)', () => {
  it('London: GMT in November (07:00 → 07:00Z), BST in summer (07:00 → 06:00Z)', () => {
    expect(officialScheduleUtc(at({ releaseDate: '2026-11-18' }))?.toISOString()).toBe('2026-11-18T07:00:00.000Z');
    expect(officialScheduleUtc(at({ releaseDate: '2027-06-16' }))?.toISOString()).toBe('2027-06-16T06:00:00.000Z');
  });

  it('Sydney: AEDT until early April (11:30 → 00:30Z), AEST after (11:30 → 01:30Z)', () => {
    const syd = (releaseDate: string) =>
      officialScheduleUtc(at({ releaseDate, time: '11:30', timeZone: 'Australia/Sydney' }));
    expect(syd('2026-11-25')?.toISOString()).toBe('2026-11-25T00:30:00.000Z');
    expect(syd('2027-04-15')?.toISOString()).toBe('2027-04-15T01:30:00.000Z'); // 公式ページの表記も AEST
  });

  it('Toronto: EST in winter (08:30 → 13:30Z), EDT from March (08:30 → 12:30Z)', () => {
    const tor = (releaseDate: string) =>
      officialScheduleUtc(at({ releaseDate, time: '08:30', timeZone: 'America/Toronto' }));
    expect(tor('2026-11-16')?.toISOString()).toBe('2026-11-16T13:30:00.000Z');
    expect(tor('2027-03-15')?.toISOString()).toBe('2027-03-15T12:30:00.000Z');
  });

  it('rejects malformed or impossible dates and times (no guessed instant)', () => {
    expect(officialScheduleUtc(at({ releaseDate: '2026-02-30' }))).toBeNull();
    expect(officialScheduleUtc(at({ releaseDate: '18/11/2026' }))).toBeNull();
    expect(officialScheduleUtc(at({ time: '7:00' }))).toBeNull();
    expect(officialScheduleUtc(at({ time: '24:00' }))).toBeNull();
  });
});

describe('ingestOfficialScheduleTables', () => {
  let store: MemoryIngestionStore;
  beforeEach(() => {
    store = new MemoryIngestionStore();
    store.indicators = CODES.map((code, i) => ({
      id: `ind-${i}`,
      code,
      importance: code.endsWith('CPI') && !code.includes('CORE') ? 'HIGH' : 'MEDIUM',
      favorable_direction: 'HIGHER_IS_POSITIVE',
    }));
  });
  const run = (tables: readonly OfficialScheduleTable[] = GB_AU_CA_SCHEDULES, now = NOW) => {
    const counters = new JobCounters();
    return ingestOfficialScheduleTables({ store, tables, now: () => now }, counters).then((result) => ({
      result,
      counters,
    }));
  };

  it('creates one SCHEDULED, EXACT, value-less row per entry (27 rows) with each indicator', async () => {
    const { result, counters } = await run();
    expect(result).toMatchObject({ inserted: 27, updated: 0, unchanged: 0, past: 0 });
    expect(counters.errors).toBe(0);
    expect(store.events).toHaveLength(27);
    expect(
      store.events.every(
        (e) => e.status === 'SCHEDULED' && e.data_status === 'PENDING' && e.release_datetime_precision === 'EXACT',
      ),
    ).toBe(true);
    expect(store.snapshots).toEqual([]);
    expect(store.events.filter((e) => e.provider === 'ons_release_calendar')).toHaveLength(6);
  });

  it('is idempotent (no duplicate rows on a re-run)', async () => {
    await run();
    const { result } = await run();
    expect(result).toMatchObject({ inserted: 0, unchanged: 27 });
    expect(store.events).toHaveLength(27);
  });

  it('a changed official date updates the same row (no duplicate); a past or RELEASED row is never changed', async () => {
    await run([
      {
        provider: 'p',
        entries: [at({ key: 'a', releaseDate: '2026-11-18' }), at({ key: 'b', releaseDate: '2026-11-19' })],
      },
    ]);
    store.events.find((e) => e.provider_event_id === 'p:GB_CPI:b')!.status = 'RELEASED';
    const { result } = await run([
      {
        provider: 'p',
        entries: [at({ key: 'a', releaseDate: '2026-11-20' }), at({ key: 'b', releaseDate: '2026-11-21' })],
      },
    ]);
    expect(result).toMatchObject({ updated: 1, inserted: 0 });
    expect(store.events.find((e) => e.provider_event_id === 'p:GB_CPI:a')!.release_datetime).toBe(
      '2026-11-20T07:00:00.000Z',
    );
    expect(store.events.find((e) => e.provider_event_id === 'p:GB_CPI:b')!.release_datetime).toBe(
      '2026-11-19T07:00:00.000Z',
    );
    // 公表時刻を過ぎたら、表の日付が変わっても触らない
    const later = new Date('2026-11-21T00:00:00Z');
    const { result: afterward } = await run(
      [{ provider: 'p', entries: [at({ key: 'a', releaseDate: '2026-12-01' })] }],
      later,
    );
    expect(afterward.past).toBe(1);
    expect(store.events.find((e) => e.provider_event_id === 'p:GB_CPI:a')!.release_datetime).toBe(
      '2026-11-20T07:00:00.000Z',
    );
  });

  it('a table whose indicator row is missing writes nothing and reports an error; other tables still apply', async () => {
    store.indicators = store.indicators.filter((i) => !i.code.startsWith('AU_'));
    const { counters } = await run();
    expect(counters.errors).toBe(1);
    expect(store.events.some((e) => e.provider === 'abs_release_calendar')).toBe(false);
    expect(store.events).toHaveLength(27 - 12);
  });

  it('an entry removed from the table is only logged, never deleted', async () => {
    await run([{ provider: 'p', entries: [at({ key: 'a' }), at({ key: 'b', releaseDate: '2026-11-19' })] }]);
    const { result } = await run([{ provider: 'p', entries: [at({ key: 'a' })] }]);
    expect(result.removed).toEqual(['p:GB_CPI:b']);
    expect(store.events).toHaveLength(2);
  });

  it('rejects a duplicate entry within one run instead of creating two rows', async () => {
    const { counters } = await run([{ provider: 'p', entries: [at({}), at({})] }]);
    expect(counters.errors).toBe(1);
    expect(store.events).toHaveLength(1);
  });
});
