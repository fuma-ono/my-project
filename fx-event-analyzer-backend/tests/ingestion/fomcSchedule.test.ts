import { beforeEach, describe, expect, it } from 'vitest';
import {
  FOMC_ANNOUNCEMENT_TIME,
  FOMC_MEETINGS_PAGE_URL,
  FOMC_SCHEDULE,
  FOMC_TIME_ZONE,
  FRB_CALENDAR_JSON_URL,
  type FomcScheduleEntry,
} from '../../src/ingestion/mappings/fomcSchedule.js';
import {
  FOMC_SCHEDULE_PROVIDER,
  fomcAnnouncementUtc,
  fomcProviderEventId,
  ingestFomcSchedule,
} from '../../src/ingestion/pipelines/fomcSchedule.js';
import { JobCounters, runIngestionJob } from '../../src/ingestion/runner.js';
import { MemoryIngestionStore } from '../helpers/memoryIngestionStore.js';

/** FOMC schedule → economic_events (HQ承認 2026-10-22 Task 3, data-sources.md §15). */
const NOW = new Date('2026-10-22T02:00:00Z');
const now = () => NOW;

function entry(
  meetingStart: string,
  meetingEnd: string,
  overrides: Partial<FomcScheduleEntry> = {},
): FomcScheduleEntry {
  return {
    meetingStart,
    meetingEnd,
    announcement: { date: meetingEnd, time: '14:00', timeZone: 'America/New_York' },
    sep: false,
    provisional: false,
    sources: [FOMC_MEETINGS_PAGE_URL, FRB_CALENDAR_JSON_URL],
    checkedAt: '2026-10-22',
    ...overrides,
  };
}

const OCT = entry('2026-10-27', '2026-10-28');
const DEC = entry('2026-12-08', '2026-12-09', { sep: true, provisional: true });
const JAN = entry('2027-01-26', '2027-01-27', { provisional: true });

let store: MemoryIngestionStore;

beforeEach(() => {
  store = new MemoryIngestionStore();
  store.indicators = [
    { id: 'ind-fomc', code: 'US_FOMC', importance: 'HIGH', favorable_direction: 'HIGHER_IS_POSITIVE' },
  ];
});

async function run(entries: readonly FomcScheduleEntry[], at: () => Date = now) {
  const counters = new JobCounters();
  const result = await ingestFomcSchedule({ store, entries, now: at }, counters);
  return { result, counters };
}

const eventOf = (providerEventId: string) => store.events.find((e) => e.provider_event_id === providerEventId);

describe('FOMC_SCHEDULE (code-reviewed table)', () => {
  it('keeps meeting dates and the announcement apart: announcement = 14:00 New York on meetingEnd', () => {
    for (const e of FOMC_SCHEDULE) {
      expect(e.announcement).toEqual({ date: e.meetingEnd, time: FOMC_ANNOUNCEMENT_TIME, timeZone: FOMC_TIME_ZONE });
      expect(e.meetingStart < e.meetingEnd).toBe(true);
      // A two-day meeting: the day after meetingStart.
      const next = new Date(Date.parse(`${e.meetingStart}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
      expect(e.meetingEnd).toBe(next);
      expect(e.sources).toEqual([FOMC_MEETINGS_PAGE_URL, FRB_CALENDAR_JSON_URL]);
      expect(e.checkedAt).toBe('2026-10-22');
      expect(e.cancelled).toBeUndefined();
    }
  });

  it('matches the official pages as read on 2026-10-22 (dates, SEP *, provisional)', () => {
    expect(FOMC_SCHEDULE.map((e) => [e.meetingStart, e.meetingEnd, e.sep, e.provisional])).toEqual([
      ['2026-10-27', '2026-10-28', false, false],
      ['2026-12-08', '2026-12-09', true, true],
      ['2027-01-26', '2027-01-27', false, true],
      ['2027-03-16', '2027-03-17', true, true],
      ['2027-04-27', '2027-04-28', false, true],
      ['2027-06-08', '2027-06-09', true, true],
      ['2027-07-27', '2027-07-28', false, true],
      ['2027-09-14', '2027-09-15', true, true],
      ['2027-10-26', '2027-10-27', false, true],
      ['2027-12-07', '2027-12-08', true, true],
    ]);
  });

  it('has unique, ascending provider_event_ids', () => {
    const ids = FOMC_SCHEDULE.map(fomcProviderEventId);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(ids);
  });
});

describe('fomcAnnouncementUtc (America/New_York → UTC, DST-correct)', () => {
  it('summer time (EDT, UTC-4): 2026-10-28 14:00 → 18:00Z', () => {
    expect(fomcAnnouncementUtc(OCT)?.toISOString()).toBe('2026-10-28T18:00:00.000Z');
  });

  it('winter time (EST, UTC-5): 2026-12-09 14:00 → 19:00Z', () => {
    expect(fomcAnnouncementUtc(DEC)?.toISOString()).toBe('2026-12-09T19:00:00.000Z');
  });

  it('2027 entries: 2027-01-27 → 19:00Z (EST), 2027-06-09 → 18:00Z (EDT)', () => {
    expect(fomcAnnouncementUtc(JAN)?.toISOString()).toBe('2027-01-27T19:00:00.000Z');
    expect(fomcAnnouncementUtc(entry('2027-06-08', '2027-06-09'))?.toISOString()).toBe('2027-06-09T18:00:00.000Z');
  });

  it('rejects a malformed date or time', () => {
    expect(fomcAnnouncementUtc(entry('2027-02-29', '2027-02-30'))).toBeNull();
    expect(fomcAnnouncementUtc({ ...OCT, announcement: { ...OCT.announcement, time: '2pm' } })).toBeNull();
  });
});

describe('ingestFomcSchedule', () => {
  it('creates one SCHEDULED, EXACT, value-less US_FOMC row per future meeting', async () => {
    const { result, counters } = await run([OCT, DEC, JAN]);
    expect(result).toMatchObject({ inserted: 3, updated: 0, unchanged: 0, cancelled: 0, provisional: 2, removed: [] });
    expect(store.events).toHaveLength(3);
    expect(eventOf('fomc_schedule:2026-10-28')).toMatchObject({
      indicator_id: 'ind-fomc',
      provider: FOMC_SCHEDULE_PROVIDER,
      release_datetime: '2026-10-28T18:00:00.000Z',
      release_datetime_precision: 'EXACT',
      importance: 'HIGH',
      status: 'SCHEDULED',
      data_status: 'PENDING',
      is_provisional: false,
    });
    expect(eventOf('fomc_schedule:2026-12-09')).toMatchObject({
      release_datetime: '2026-12-09T19:00:00.000Z',
      is_provisional: true,
    });
    expect(store.snapshots).toEqual([]);
    expect(counters.fetched).toBe(3);
    expect(counters.success).toBe(3);
    expect(counters.details).toMatchObject({ inserted: 3, provisional: 2 });
  });

  it('is idempotent: a re-run changes nothing and records no schedule change', async () => {
    await run([OCT, DEC, JAN]);
    const before = JSON.stringify(store.events);
    const { result } = await run([OCT, DEC, JAN]);
    expect(result).toMatchObject({ inserted: 0, updated: 0, unchanged: 3, provisional: 2 });
    expect(JSON.stringify(store.events)).toBe(before);
    expect(store.scheduleChanges).toEqual([]);
  });

  it('a changed announcement time updates the same row (RESCHEDULED by the DB trigger)', async () => {
    await run([OCT]);
    const id = eventOf('fomc_schedule:2026-10-28')!.id;
    const moved = { ...OCT, announcement: { ...OCT.announcement, time: '14:30' } };
    const { result, counters } = await run([moved]);
    expect(result).toMatchObject({ inserted: 0, updated: 1 });
    expect(store.events).toHaveLength(1);
    expect(store.events[0]).toMatchObject({ id, release_datetime: '2026-10-28T18:30:00.000Z' });
    expect(store.scheduleChanges).toEqual([
      {
        target_id: id,
        change_type: 'RESCHEDULED',
        old_datetime: '2026-10-28T18:00:00.000Z',
        new_datetime: '2026-10-28T18:30:00.000Z',
      },
    ]);
    expect(counters.details.rescheduled).toHaveLength(1);
  });

  it('a moved meeting date keeps the row via eventKey', async () => {
    await run([JAN]);
    const id = eventOf('fomc_schedule:2027-01-27')!.id;
    const moved = entry('2027-02-02', '2027-02-03', { provisional: true, eventKey: '2027-01-27' });
    const { result } = await run([moved]);
    expect(result).toMatchObject({ inserted: 0, updated: 1, removed: [] });
    expect(store.events).toEqual([expect.objectContaining({ id, release_datetime: '2027-02-03T19:00:00.000Z' })]);
    expect(store.scheduleChanges.map((c) => c.change_type)).toEqual(['RESCHEDULED']);
  });

  it('provisional → confirmed flips is_provisional only (no schedule change)', async () => {
    await run([DEC]);
    const updates: unknown[] = [];
    const original = store.updateEvent.bind(store);
    store.updateEvent = (eventId, patch) => {
      updates.push(patch);
      return original(eventId, patch);
    };
    const { result } = await run([{ ...DEC, provisional: false }]);
    expect(result).toMatchObject({ updated: 1, provisional: 0 });
    expect(updates).toEqual([{ is_provisional: false }]);
    expect(eventOf('fomc_schedule:2026-12-09')).toMatchObject({
      release_datetime: '2026-12-09T19:00:00.000Z',
      is_provisional: false,
      status: 'SCHEDULED',
    });
    expect(store.scheduleChanges).toEqual([]);
  });

  it('cancelled → status CANCELLED once (with the note in the log); a cancelled meeting is never created', async () => {
    await run([DEC]);
    const cancelledDec = { ...DEC, cancelled: { note: 'FRB announcement 2026-11-30' } };
    const cancelledJan = { ...JAN, cancelled: { note: 'never created' } };
    const first = await run([cancelledDec, cancelledJan]);
    expect(first.result).toMatchObject({ cancelled: 1, inserted: 0 });
    expect(eventOf('fomc_schedule:2026-12-09')?.status).toBe('CANCELLED');
    expect(eventOf('fomc_schedule:2027-01-27')).toBeUndefined();
    expect(first.counters.details.cancelled_notes).toEqual([
      { provider_event_id: 'fomc_schedule:2026-12-09', note: 'FRB announcement 2026-11-30' },
    ]);
    expect(store.scheduleChanges.map((c) => c.change_type)).toEqual(['CANCELLED']);

    const second = await run([cancelledDec]);
    expect(second.result).toMatchObject({ cancelled: 0, unchanged: 1 });
    expect(store.scheduleChanges).toHaveLength(1);
  });

  it('an entry removed from the table is only logged, never deleted or cancelled', async () => {
    await run([OCT, DEC]);
    const { result, counters } = await run([OCT]);
    expect(result.removed).toEqual(['fomc_schedule:2026-12-09']);
    expect(counters.details.removed).toEqual(['fomc_schedule:2026-12-09']);
    expect(eventOf('fomc_schedule:2026-12-09')).toMatchObject({ status: 'SCHEDULED' });
    expect(store.events).toHaveLength(2);
  });

  it('past meetings: not created, and an existing past row is left as it is', async () => {
    const past = entry('2026-09-15', '2026-09-16');
    const { result } = await run([past, OCT]);
    expect(result).toMatchObject({ past: 1, inserted: 1 });
    expect(eventOf('fomc_schedule:2026-09-16')).toBeUndefined();

    // After the October meeting: its row stays SCHEDULED/unchanged even if the table is edited.
    const after = () => new Date('2026-10-29T00:00:00Z');
    const before = JSON.stringify(store.events);
    const edited = { ...OCT, announcement: { ...OCT.announcement, time: '15:00' } };
    const second = await run([edited], after);
    expect(second.result).toMatchObject({ past: 1, updated: 0, removed: [] });
    expect(JSON.stringify(store.events)).toBe(before);
    // A removed past row is not reported as removed either.
    expect((await run([], after)).result.removed).toEqual([]);
  });

  it('records the counts in ingestion_logs.details through runIngestionJob', async () => {
    const outcome = await runIngestionJob(
      store,
      { provider: FOMC_SCHEDULE_PROVIDER, dataType: 'ECONOMIC_EVENT', job: 'ingest:fomc-schedule' },
      (counters) => ingestFomcSchedule({ store, entries: [OCT, DEC, JAN], now }, counters).then(() => undefined),
      now,
    );
    expect(outcome.status).toBe('SUCCESS');
    expect(store.logs).toHaveLength(1);
    expect(store.logs[0]).toMatchObject({
      provider: 'fomc_schedule',
      job: 'ingest:fomc-schedule',
      data_type: 'ECONOMIC_EVENT',
      fetched_count: 3,
      success_count: 3,
      details: { inserted: 3, updated: 0, unchanged: 0, cancelled: 0, provisional: 2, past: 0, removed: [] },
    });
  });

  it('fails without a US_FOMC indicator row (nothing written)', async () => {
    store.indicators = [];
    const { counters } = await run([OCT]);
    expect(counters.errors).toBe(1);
    expect(store.events).toEqual([]);
  });

  it('the default table applies cleanly at the fetch time', async () => {
    const counters = new JobCounters();
    const result = await ingestFomcSchedule({ store, now }, counters);
    expect(result).toMatchObject({ inserted: 10, provisional: 9, past: 0 });
    expect(counters.errors).toBe(0);
  });
});
