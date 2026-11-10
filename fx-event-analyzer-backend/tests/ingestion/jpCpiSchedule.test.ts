/**
 * JP_CPI(日本の消費者物価指数 全国)の公表予定 → economic_events(HQ指示 2026-11-10「経済指標の網羅性改善」)。
 * 人が e-Stat の公表予定を読んで書いた表。推測の日付を作らない・時刻の変換(日本時間 → UTC)・重複しない・過去の回を
 * 作らない・既存のデータを壊さない、を確かめる。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  ESTAT_CPI_SCHEDULE_URL,
  JP_CPI_SCHEDULE,
  JP_CPI_TIME_ZONE,
  type JpCpiScheduleEntry,
} from '../../src/ingestion/mappings/jpCpiSchedule.js';
import {
  ingestJpCpiSchedule,
  JP_CPI_SCHEDULE_PROVIDER,
  jpCpiAnnouncementUtc,
  jpCpiProviderEventId,
} from '../../src/ingestion/pipelines/jpCpiSchedule.js';
import { JobCounters } from '../../src/ingestion/runner.js';
import { MemoryIngestionStore } from '../helpers/memoryIngestionStore.js';

const NOW = new Date('2026-11-10T06:00:00Z');
const now = () => NOW;

const entry = (referencePeriod: string, releaseDate: string): JpCpiScheduleEntry => ({
  referencePeriod,
  releaseDate,
  sources: [ESTAT_CPI_SCHEDULE_URL],
  checkedAt: '2026-11-10',
});

let store: MemoryIngestionStore;
beforeEach(() => {
  store = new MemoryIngestionStore();
  store.indicators = [{ id: 'ind-jp-cpi', code: 'JP_CPI', importance: 'HIGH', favorable_direction: 'NEUTRAL' }];
});

async function run(entries: readonly JpCpiScheduleEntry[], at: () => Date = now) {
  const counters = new JobCounters();
  const result = await ingestJpCpiSchedule({ store, entries, now: at }, counters);
  return { result, counters };
}

describe('JP_CPI_SCHEDULE (the table read from the e-Stat release calendar on 2026-11-10)', () => {
  it('matches the official page (全国 の各月分、これから公表される回だけ)', () => {
    expect(JP_CPI_SCHEDULE.map((e) => [e.referencePeriod, e.releaseDate])).toEqual([
      ['2026-10', '2026-11-20'],
      ['2026-11', '2026-12-18'],
      ['2026-12', '2027-01-22'],
      ['2027-01', '2027-02-19'],
      ['2027-02', '2027-03-19'],
    ]);
    for (const e of JP_CPI_SCHEDULE) {
      expect(e.sources).toEqual([ESTAT_CPI_SCHEDULE_URL]);
      expect(e.checkedAt).toBe('2026-11-10');
    }
  });

  it('has unique, ascending provider_event_ids', () => {
    const ids = JP_CPI_SCHEDULE.map(jpCpiProviderEventId);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(ids);
    expect(ids[0]).toBe(`${JP_CPI_SCHEDULE_PROVIDER}:2026-10`);
  });
});

describe('jpCpiAnnouncementUtc (Asia/Tokyo 08:30 → UTC, no daylight saving)', () => {
  it('08:30 JST is 23:30 UTC on the previous day, in winter and in summer alike', () => {
    expect(JP_CPI_TIME_ZONE).toBe('Asia/Tokyo');
    expect(jpCpiAnnouncementUtc(entry('2026-10', '2026-11-20'))?.toISOString()).toBe('2026-11-19T23:30:00.000Z');
    expect(jpCpiAnnouncementUtc(entry('2027-06', '2027-07-23'))?.toISOString()).toBe('2027-07-22T23:30:00.000Z');
    expect(jpCpiAnnouncementUtc(entry('2026-12', '2027-01-22'))?.toISOString()).toBe('2027-01-21T23:30:00.000Z'); // 年をまたぐ
  });

  it('rejects malformed or non-existent dates (no guessed date)', () => {
    expect(jpCpiAnnouncementUtc(entry('2026-10', '2026/11/20'))).toBeNull();
    expect(jpCpiAnnouncementUtc(entry('2026-10', '2026-02-30'))).toBeNull();
  });
});

describe('ingestJpCpiSchedule', () => {
  it('creates one SCHEDULED, EXACT, value-less JP_CPI row per future release', async () => {
    const { result } = await run(JP_CPI_SCHEDULE);
    expect(result).toMatchObject({ inserted: 5, updated: 0, unchanged: 0, past: 0 });
    expect(store.events).toHaveLength(5);
    for (const e of store.events) {
      expect(e).toMatchObject({
        indicator_id: 'ind-jp-cpi',
        provider: JP_CPI_SCHEDULE_PROVIDER,
        status: 'SCHEDULED',
        data_status: 'PENDING',
        release_datetime_precision: 'EXACT',
        importance: 'HIGH',
      });
    }
    expect(store.snapshots).toEqual([]); // 値は入れない
  });

  it('is idempotent: a re-run creates no duplicate and changes nothing', async () => {
    await run(JP_CPI_SCHEDULE);
    const { result } = await run(JP_CPI_SCHEDULE);
    expect(result).toMatchObject({ inserted: 0, unchanged: 5 });
    expect(store.events).toHaveLength(5);
  });

  it('a past release is not created (no past row from the table)', async () => {
    const { result } = await run([entry('2026-09', '2026-10-23'), entry('2026-10', '2026-11-20')]);
    expect(result).toMatchObject({ inserted: 1, past: 1 });
    expect(store.events.map((e) => e.provider_event_id)).toEqual([`${JP_CPI_SCHEDULE_PROVIDER}:2026-10`]);
  });

  it('fails without a JP_CPI indicator row and writes nothing', async () => {
    store.indicators = [];
    const { counters } = await run(JP_CPI_SCHEDULE);
    expect(counters.errors).toBe(1);
    expect(store.events).toEqual([]);
  });

  it('rejects duplicate referencePeriod entries within one run', async () => {
    const { counters } = await run([entry('2026-10', '2026-11-20'), entry('2026-10', '2026-11-20')]);
    expect(counters.errors).toBe(1);
    expect(store.events).toHaveLength(1);
  });
});
