import { beforeEach, describe, expect, it } from 'vitest';
import {
  CENSUS_RETAIL_SCHEDULE_URL,
  RETAIL_SALES_SCHEDULE,
  type RetailSalesScheduleEntry,
} from '../../src/ingestion/mappings/retailSalesSchedule.js';
import {
  RETAIL_SALES_SCHEDULE_PROVIDER,
  ingestRetailSalesSchedule,
  retailSalesAnnouncementUtc,
  retailSalesProviderEventId,
} from '../../src/ingestion/pipelines/retailSalesSchedule.js';
import { JobCounters, runIngestionJob } from '../../src/ingestion/runner.js';
import { MemoryIngestionStore } from '../helpers/memoryIngestionStore.js';

/** US_RETAIL_SALES schedule → economic_events (HQ承認 2026-11-05, data-sources.md §17). */
const NOW = new Date('2026-11-05T12:00:00Z');
const now = () => NOW;

function entry(
  referencePeriod: string,
  releaseDate: string,
  overrides: Partial<RetailSalesScheduleEntry> = {},
): RetailSalesScheduleEntry {
  return {
    referencePeriod,
    releaseDate,
    sources: [CENSUS_RETAIL_SCHEDULE_URL],
    checkedAt: '2026-11-05',
    ...overrides,
  };
}

const OCT = entry('2026-10', '2026-11-17');
const NOV = entry('2026-11', '2026-12-16');
const DEC = entry('2026-12', '2027-01-15');

let store: MemoryIngestionStore;

beforeEach(() => {
  store = new MemoryIngestionStore();
  store.indicators = [
    { id: 'ind-retail', code: 'US_RETAIL_SALES', importance: 'MEDIUM', favorable_direction: 'HIGHER_IS_POSITIVE' },
  ];
});

async function run(entries: readonly RetailSalesScheduleEntry[], at: () => Date = now) {
  const counters = new JobCounters();
  const result = await ingestRetailSalesSchedule({ store, entries, now: at }, counters);
  return { result, counters };
}

const eventOf = (providerEventId: string) => store.events.find((e) => e.provider_event_id === providerEventId);

describe('RETAIL_SALES_SCHEDULE (code-reviewed table, 案A: 人が確認した表方式)', () => {
  it('has only entries confirmed on the official page, each with a source and a checked-at date', () => {
    for (const e of RETAIL_SALES_SCHEDULE) {
      expect(e.sources).toEqual([CENSUS_RETAIL_SCHEDULE_URL]);
      expect(e.checkedAt).toBe('2026-11-05');
      expect(e.referencePeriod).toMatch(/^\d{4}-\d{2}$/);
      expect(e.releaseDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('matches the official page as read on 2026-11-05 (referencePeriod → releaseDate)', () => {
    expect(RETAIL_SALES_SCHEDULE.map((e) => [e.referencePeriod, e.releaseDate])).toEqual([
      ['2026-10', '2026-11-17'],
      ['2026-11', '2026-12-16'],
      ['2026-12', '2027-01-15'],
      ['2027-01', '2027-02-17'],
      ['2027-02', '2027-03-16'],
      ['2027-03', '2027-04-16'],
      ['2027-04', '2027-05-14'],
      ['2027-05', '2027-06-16'],
      ['2027-06', '2027-07-16'],
      ['2027-07', '2027-08-16'],
      ['2027-08', '2027-09-16'],
      ['2027-09', '2027-10-15'],
      ['2027-10', '2027-11-16'],
      ['2027-11', '2027-12-15'],
    ]);
  });

  it('does not include the 2026-09 row (its release date, 2026-10-15, is before the 2026-11-05 cutoff)', () => {
    expect(RETAIL_SALES_SCHEDULE.some((e) => e.referencePeriod === '2026-09')).toBe(false);
    expect(RETAIL_SALES_SCHEDULE.some((e) => e.releaseDate === '2026-10-15')).toBe(false);
  });

  it('does not include the 2027-12 row ("To be announced at a later date" on the official page)', () => {
    expect(RETAIL_SALES_SCHEDULE.some((e) => e.referencePeriod === '2027-12')).toBe(false);
  });

  it('every releaseDate is on or after the 2026-11-05 cutoff used when the table was written', () => {
    for (const e of RETAIL_SALES_SCHEDULE) {
      expect(e.releaseDate >= '2026-11-05').toBe(true);
    }
  });

  it('referencePeriod and releaseDate are never the same (release is always the month after the data month)', () => {
    for (const e of RETAIL_SALES_SCHEDULE) {
      expect(e.releaseDate.startsWith(e.referencePeriod)).toBe(false);
    }
  });

  it('has unique, ascending provider_event_ids', () => {
    const ids = RETAIL_SALES_SCHEDULE.map(retailSalesProviderEventId);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(ids);
  });
});

describe('retailSalesAnnouncementUtc (releaseDate 08:30 America/New_York → UTC, DST-correct)', () => {
  it('standard time (EST, UTC-5): 2026-11-17 08:30 → 13:30Z', () => {
    expect(retailSalesAnnouncementUtc(OCT)?.toISOString()).toBe('2026-11-17T13:30:00.000Z');
  });

  it('summer time (EDT, UTC-4): 2027-05-14 08:30 → 12:30Z', () => {
    expect(retailSalesAnnouncementUtc(entry('2027-04', '2027-05-14'))?.toISOString()).toBe('2027-05-14T12:30:00.000Z');
  });

  it('every RETAIL_SALES_SCHEDULE entry converts to 12:30Z or 13:30Z (the real table)', () => {
    for (const e of RETAIL_SALES_SCHEDULE) {
      const iso = retailSalesAnnouncementUtc(e)?.toISOString();
      expect(iso === undefined ? iso : iso.slice(11, 19)).toMatch(/^(12|13):30:00$/);
    }
  });

  it('rejects a malformed date', () => {
    expect(retailSalesAnnouncementUtc(entry('2027-02', '2027-02-30'))).toBeNull();
    expect(retailSalesAnnouncementUtc(entry('2027-02', 'not-a-date'))).toBeNull();
  });
});

describe('ingestRetailSalesSchedule', () => {
  it('creates one SCHEDULED, EXACT, value-less US_RETAIL_SALES row per future release', async () => {
    const { result, counters } = await run([OCT, NOV, DEC]);
    expect(result).toMatchObject({ inserted: 3, updated: 0, unchanged: 0, past: 0, removed: [] });
    expect(store.events).toHaveLength(3);
    expect(eventOf('census_retail_schedule:2026-10')).toMatchObject({
      indicator_id: 'ind-retail',
      provider: RETAIL_SALES_SCHEDULE_PROVIDER,
      release_datetime: '2026-11-17T13:30:00.000Z',
      release_datetime_precision: 'EXACT',
      importance: 'MEDIUM',
      status: 'SCHEDULED',
      data_status: 'PENDING',
    });
    expect(store.snapshots).toEqual([]);
    expect(counters.fetched).toBe(3);
    expect(counters.success).toBe(3);
    expect(counters.details).toMatchObject({ inserted: 3 });
  });

  it('is idempotent: a re-run changes nothing (重複登録されない)', async () => {
    await run([OCT, NOV, DEC]);
    const before = JSON.stringify(store.events);
    const { result } = await run([OCT, NOV, DEC]);
    expect(result).toMatchObject({ inserted: 0, updated: 0, unchanged: 3 });
    expect(JSON.stringify(store.events)).toBe(before);
    expect(store.events).toHaveLength(3);
  });

  it('a changed release date updates the same row instead of creating a duplicate', async () => {
    await run([OCT]);
    const id = eventOf('census_retail_schedule:2026-10')!.id;
    const moved = entry('2026-10', '2026-11-18');
    const { result } = await run([moved]);
    expect(result).toMatchObject({ inserted: 0, updated: 1 });
    expect(store.events).toHaveLength(1);
    expect(store.events[0]).toMatchObject({ id, release_datetime: '2026-11-18T13:30:00.000Z' });
  });

  it('past releases: not created, and an existing past row is left as it is (過去日程を新規登録しない)', async () => {
    const past = entry('2026-09', '2026-10-15');
    const { result } = await run([past, OCT]);
    expect(result).toMatchObject({ past: 1, inserted: 1 });
    expect(eventOf('census_retail_schedule:2026-09')).toBeUndefined();

    // After the October release: its row stays SCHEDULED/unchanged even if the table is edited.
    const after = () => new Date('2026-11-18T00:00:00Z');
    const before = JSON.stringify(store.events);
    const edited = { ...OCT, releaseDate: '2026-11-20' };
    const second = await run([edited], after);
    expect(second.result).toMatchObject({ past: 1, updated: 0, removed: [] });
    expect(JSON.stringify(store.events)).toBe(before);
  });

  it('the default table (no entries override) applies cleanly at the fetch time', async () => {
    const counters = new JobCounters();
    const result = await ingestRetailSalesSchedule({ store, now }, counters);
    expect(result).toMatchObject({ inserted: RETAIL_SALES_SCHEDULE.length, past: 0 });
    expect(counters.errors).toBe(0);
  });

  it('an entry removed from the table is only logged, never deleted (既存のデータを変更しない)', async () => {
    await run([OCT, NOV]);
    const { result, counters } = await run([OCT]);
    expect(result.removed).toEqual(['census_retail_schedule:2026-11']);
    expect(counters.details.removed).toEqual(['census_retail_schedule:2026-11']);
    expect(eventOf('census_retail_schedule:2026-11')).toMatchObject({ status: 'SCHEDULED' });
    expect(store.events).toHaveLength(2);
  });

  it('does not touch events of another provider/indicator (既存の過去イベントや別指標のデータを変更しない)', async () => {
    store.indicators.push({
      id: 'ind-other',
      code: 'US_CPI',
      importance: 'HIGH',
      favorable_direction: 'HIGHER_IS_POSITIVE',
    });
    const other = await store.insertEvent({
      indicator_id: 'ind-other',
      provider: 'bls_schedule',
      provider_event_id: 'bls_schedule:other-indicator-untouched',
      release_datetime: '2026-12-01T13:30:00.000Z',
      release_datetime_precision: 'EXACT',
      importance: 'HIGH',
      status: 'SCHEDULED',
      data_status: 'PENDING',
    });
    await run([OCT]);
    expect(store.events.find((e) => e.id === other.id)).toEqual(other);
    expect(store.events).toHaveLength(2);
  });

  it('records the counts in ingestion_logs.details through runIngestionJob', async () => {
    const outcome = await runIngestionJob(
      store,
      { provider: RETAIL_SALES_SCHEDULE_PROVIDER, dataType: 'ECONOMIC_EVENT', job: 'ingest:retail-sales-schedule' },
      (counters) => ingestRetailSalesSchedule({ store, entries: [OCT, NOV], now }, counters).then(() => undefined),
      now,
    );
    expect(outcome.status).toBe('SUCCESS');
    expect(store.logs).toHaveLength(1);
    expect(store.logs[0]).toMatchObject({
      provider: 'census_retail_schedule',
      job: 'ingest:retail-sales-schedule',
      data_type: 'ECONOMIC_EVENT',
      fetched_count: 2,
      success_count: 2,
      details: { inserted: 2, updated: 0, unchanged: 0, past: 0, removed: [] },
    });
  });

  it('fails without a US_RETAIL_SALES indicator row (nothing written)', async () => {
    store.indicators = [];
    const { counters } = await run([OCT]);
    expect(counters.errors).toBe(1);
    expect(store.events).toEqual([]);
  });

  it('rejects duplicate referencePeriod entries within one run instead of creating two rows', async () => {
    const { counters } = await run([OCT, { ...OCT, releaseDate: '2026-11-18' }]);
    expect(counters.errors).toBe(1);
    expect(store.events).toHaveLength(1);
  });
});
