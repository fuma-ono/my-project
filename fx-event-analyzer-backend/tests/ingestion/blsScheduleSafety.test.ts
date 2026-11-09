import { beforeEach, describe, expect, it } from 'vitest';
import type { BlsScheduleEntry } from '../../src/ingestion/mappings/blsSchedule.js';
import {
  BLS_SCHEDULE_PROVIDER,
  blsScheduleEventId,
  buildBlsScheduleReleases,
  createBlsNativeResolver,
  planBlsScheduleWrites,
  readOnlyIngestionStore,
  reconcileBlsScheduleRows,
} from '../../src/ingestion/pipelines/blsCalendar.js';
import { ingestCalendarReleases } from '../../src/ingestion/pipelines/economicCalendar.js';
import type { OfficialStatsProvider } from '../../src/ingestion/providers.js';
import { JobCounters } from '../../src/ingestion/runner.js';
import type { NewEvent } from '../../src/ingestion/store.js';
import type { OfficialObservation } from '../../src/ingestion/types.js';
import { MemoryIngestionStore } from '../helpers/memoryIngestionStore.js';

// HQ指示(2026-10-26)「BLSの安全対策」: 取りやめ・予定表から消えた行・--dry-run・内訳・
// 発表済みの行を変えないこと・未来予定の処理の失敗で過去の取り込みが止まらないこと。

/** BLS の API の代わり(月 → 値の表)。 */
class FakeBls implements OfficialStatsProvider {
  readonly name = 'BLS' as const;
  readonly supportsPointInTime = false;
  constructor(private readonly cpi: Record<string, number>) {}
  fetchObservations(query: { seriesId: string; observationStart: string; observationEnd: string }) {
    const observations: OfficialObservation[] = Object.entries(this.cpi)
      .filter(([period]) => query.seriesId === 'CUUR0000SA0' && period >= query.observationStart.slice(0, 7))
      .map(([period, value]) => ({
        source: 'BLS',
        seriesId: query.seriesId,
        periodStart: `${period}-01`,
        value,
        asOfDate: '2026-10-17',
        releaseStatus: 'UNKNOWN',
      }));
    return Promise.resolve(observations);
  }
}

const NOW = new Date('2026-10-26T00:00:00Z');
const RANGE = { start: '2024-01-01', end: '2027-12-31' };
const PAST: BlsScheduleEntry = { indicatorCode: 'US_CPI', referencePeriod: '2026-09', releaseDate: '2026-10-14' };
const FUTURE: BlsScheduleEntry = { indicatorCode: 'US_CPI', referencePeriod: '2026-10', releaseDate: '2026-11-10' };
const FUTURE_2: BlsScheduleEntry = { indicatorCode: 'US_CPI', referencePeriod: '2026-11', releaseDate: '2026-12-10' };
const CANCELLED_FUTURE: BlsScheduleEntry = {
  indicatorCode: 'US_CPI',
  referencePeriod: '2026-11',
  releaseDate: '2026-12-10',
  cancelled: true,
  cancelledNote: 'test: https://www.bls.gov/ (read 2026-10-26)',
};

function row(
  entry: Pick<BlsScheduleEntry, 'indicatorCode' | 'referencePeriod'>,
  overrides: Partial<NewEvent> = {},
): NewEvent {
  return {
    indicator_id: 'ind-cpi',
    provider: BLS_SCHEDULE_PROVIDER,
    provider_event_id: blsScheduleEventId(entry),
    release_datetime: '2026-12-10T13:30:00.000Z',
    release_datetime_precision: 'EXACT',
    importance: 'HIGH',
    status: 'SCHEDULED',
    data_status: 'PENDING',
    ...overrides,
  };
}

let store: MemoryIngestionStore;
beforeEach(() => {
  store = new MemoryIngestionStore();
  store.indicators = [{ id: 'ind-cpi', code: 'US_CPI', importance: 'HIGH', favorable_direction: 'HIGHER_IS_POSITIVE' }];
});

const statusOf = (entry: Pick<BlsScheduleEntry, 'indicatorCode' | 'referencePeriod'>) =>
  store.events.find((e) => e.provider_event_id === blsScheduleEventId(entry))?.status;

describe('buildBlsScheduleReleases + cancelled entries', () => {
  it('never builds a release for a cancelled entry (so it cannot be written back to SCHEDULED) and returns it', async () => {
    const official = createBlsNativeResolver(new FakeBls({}), RANGE);
    const built = await buildBlsScheduleReleases({ official, entries: [FUTURE, CANCELLED_FUTURE], now: () => NOW });
    expect(built.releases.map((r) => r.providerEventId)).toEqual([blsScheduleEventId(FUTURE)]);
    expect(built.cancelled).toEqual([CANCELLED_FUTURE]);
  });
});

describe('reconcileBlsScheduleRows: 取りやめ', () => {
  it('sets a SCHEDULED row CANCELLED + UNAVAILABLE', async () => {
    await store.insertEvent(row(CANCELLED_FUTURE));
    const counters = new JobCounters();
    const counts = await reconcileBlsScheduleRows({ store, entries: [CANCELLED_FUTURE] }, counters);
    expect(counts).toMatchObject({ cancelled_applied: 1, cancelled_conflicts: 0 });
    const event = store.events.find((e) => e.provider_event_id === blsScheduleEventId(CANCELLED_FUTURE))!;
    expect(event).toMatchObject({ status: 'CANCELLED', data_status: 'UNAVAILABLE' });
    expect(counters.details).toMatchObject({ cancelled_applied: 1 });
  });

  it('inserts a CANCELLED row when there is none (the calendar still shows it)', async () => {
    const counters = new JobCounters();
    const counts = await reconcileBlsScheduleRows({ store, entries: [CANCELLED_FUTURE] }, counters);
    expect(counts.cancelled_applied).toBe(1);
    expect(statusOf(CANCELLED_FUTURE)).toBe('CANCELLED');
  });

  it('leaves an already CANCELLED row alone', async () => {
    await store.insertEvent(row(CANCELLED_FUTURE, { status: 'CANCELLED', data_status: 'UNAVAILABLE' }));
    const counts = await reconcileBlsScheduleRows({ store, entries: [CANCELLED_FUTURE] }, new JobCounters());
    expect(counts).toMatchObject({ cancelled_applied: 0, cancelled_unchanged: 1 });
  });

  it('NEVER changes a RELEASED row: it is noted as a conflict instead', async () => {
    await store.insertEvent(row(CANCELLED_FUTURE, { status: 'RELEASED' }));
    const before = JSON.stringify(store.events);
    const counters = new JobCounters();
    const counts = await reconcileBlsScheduleRows({ store, entries: [CANCELLED_FUTURE] }, counters);
    expect(counts).toMatchObject({ cancelled_applied: 0, cancelled_conflicts: 1 });
    expect(JSON.stringify(store.events)).toBe(before);
    expect(counters.details.schedule_entry_conflict).toEqual([
      { provider_event_id: blsScheduleEventId(CANCELLED_FUTURE), entry: 'CANCELLED', row: 'RELEASED' },
    ]);
  });
});

describe('reconcileBlsScheduleRows: 予定表から消えた未発表の行', () => {
  it('notes an un-released row that is no longer in the table and does not change it; RELEASED rows are not listed', async () => {
    await store.insertEvent(row(FUTURE_2)); // not in the table below
    await store.insertEvent(row(PAST, { status: 'RELEASED', release_datetime: '2026-10-14T12:30:00.000Z' })); // not in the table either
    await store.insertEvent(row(FUTURE, { release_datetime: '2026-11-10T13:30:00.000Z' })); // in the table
    const counters = new JobCounters();
    const counts = await reconcileBlsScheduleRows({ store, entries: [FUTURE] }, counters);
    expect(counts.rows_not_in_table).toBe(1);
    expect(counters.details.schedule_rows_not_in_table).toEqual([
      {
        provider_event_id: blsScheduleEventId(FUTURE_2),
        status: 'SCHEDULED',
        release_datetime: '2026-12-10T13:30:00.000Z',
      },
    ]);
    expect(statusOf(FUTURE_2)).toBe('SCHEDULED');
  });
});

describe('--dry-run', () => {
  it('reconcile with dryRun writes nothing and reports what it would write', async () => {
    await store.insertEvent(row(CANCELLED_FUTURE));
    const before = JSON.stringify(store.events);
    const counters = new JobCounters();
    const counts = await reconcileBlsScheduleRows({ store, entries: [CANCELLED_FUTURE], dryRun: true }, counters);
    expect(counts.cancelled_applied).toBe(1);
    expect(JSON.stringify(store.events)).toBe(before);
    expect(counters.details.dry_run_writes).toEqual([
      {
        action: 'cancel',
        provider_event_id: blsScheduleEventId(CANCELLED_FUTURE),
        release_datetime: '2026-12-10T13:30:00.000Z',
      },
    ]);
  });

  it('the read-only store refuses every write even if dryRun is forgotten (double guard)', async () => {
    await store.insertEvent(row(CANCELLED_FUTURE));
    const before = JSON.stringify(store.events);
    const readOnly = readOnlyIngestionStore(store);
    await expect(readOnly.insertEvent(row(FUTURE))).rejects.toThrow('read-only store');
    await expect(readOnly.updateEvent('x', { status: 'CANCELLED' })).rejects.toThrow('read-only store');
    const counters = new JobCounters();
    await reconcileBlsScheduleRows({ store: readOnly, entries: [CANCELLED_FUTURE] }, counters);
    expect(counters.errors).toBe(1);
    expect(JSON.stringify(store.events)).toBe(before);
  });
});

describe('planBlsScheduleWrites (取り込みの内訳)', () => {
  it('classifies each built release without writing', async () => {
    const official = createBlsNativeResolver(new FakeBls({ '2025-09': 320, '2026-09': 332.16 }), RANGE);
    const built = await buildBlsScheduleReleases({ official, entries: [PAST, FUTURE, FUTURE_2], now: () => NOW });
    // PAST: SCHEDULED row → released_update. FUTURE: no row → scheduled_insert.
    // FUTURE_2: SCHEDULED row at another time → scheduled_reschedule.
    await store.insertEvent(row(PAST, { release_datetime: '2026-10-14T12:30:00.000Z' }));
    await store.insertEvent(row(FUTURE_2, { release_datetime: '2026-12-11T13:30:00.000Z' }));
    const before = JSON.stringify(store.events);
    const counters = new JobCounters();
    const plan = await planBlsScheduleWrites(readOnlyIngestionStore(store), built.releases, counters);
    expect(plan).toEqual({
      scheduled_insert: 1,
      scheduled_reschedule: 1,
      scheduled_unchanged: 0,
      released_insert: 0,
      released_update: 1,
      released_unchanged: 0,
      row_cancelled: 0,
    });
    expect(JSON.stringify(store.events)).toBe(before);
    expect(counters.errors).toBe(0);
  });

  it('counts RELEASED rows as unchanged and a CANCELLED row of a live entry as a conflict', async () => {
    const official = createBlsNativeResolver(new FakeBls({ '2025-09': 320, '2026-09': 332.16 }), RANGE);
    const built = await buildBlsScheduleReleases({ official, entries: [PAST, FUTURE], now: () => NOW });
    await store.insertEvent(row(PAST, { status: 'RELEASED' }));
    await store.insertEvent(row(FUTURE, { status: 'CANCELLED', data_status: 'UNAVAILABLE' }));
    const counters = new JobCounters();
    const plan = await planBlsScheduleWrites(store, built.releases, counters);
    expect(plan).toMatchObject({ released_unchanged: 1, row_cancelled: 1 });
    expect(counters.details.schedule_entry_conflict).toEqual([
      { provider_event_id: blsScheduleEventId(FUTURE), entry: 'SCHEDULED', row: 'CANCELLED' },
    ]);
  });
});

describe('a failure in the schedule checks never stops the published-value path', () => {
  it('the past release is RELEASED even when the reconcile step fails afterwards (job order + its own try/catch)', async () => {
    const official = createBlsNativeResolver(new FakeBls({ '2025-09': 320, '2026-09': 332.16 }), RANGE);
    const built = await buildBlsScheduleReleases({
      official,
      entries: [PAST, FUTURE, CANCELLED_FUTURE],
      now: () => NOW,
    });
    const counters = new JobCounters();
    await ingestCalendarReleases(BLS_SCHEDULE_PROVIDER, built.releases, { store, official }, counters);
    // The same order and guard as jobs/ingestBlsCalendar.ts.
    store.findIndicatorsByCode = () => Promise.reject(new Error('db down'));
    store.listUnreleasedEventsByProvider = () => Promise.reject(new Error('db down'));
    try {
      await reconcileBlsScheduleRows({ store, entries: [PAST, FUTURE, CANCELLED_FUTURE] }, counters);
    } catch (error) {
      counters.error(`schedule_reconcile: ${error instanceof Error ? error.message : String(error)}`);
    }
    expect(statusOf(PAST)).toBe('RELEASED');
    expect(statusOf(FUTURE)).toBe('SCHEDULED');
    expect(counters.errorMessages.some((m) => m.startsWith('schedule_reconcile: db down'))).toBe(true);
  });

  it('a failing schedule-row listing is recorded and the cancel results so far are kept', async () => {
    await store.insertEvent(row(CANCELLED_FUTURE));
    store.listUnreleasedEventsByProvider = () => Promise.reject(new Error('timeout'));
    const counters = new JobCounters();
    const counts = await reconcileBlsScheduleRows({ store, entries: [CANCELLED_FUTURE] }, counters);
    expect(counts.cancelled_applied).toBe(1);
    expect(counters.errorMessages).toEqual(['schedule_rows_not_in_table check failed: timeout']);
    expect(counters.details).toMatchObject({ cancelled_applied: 1, rows_not_in_table: 0 });
  });
});
