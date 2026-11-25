/**
 * 日銀・ECB の金融政策会合の日程(HQ指示 2026-11-25)。公式ページで確認した表(DATE_ONLY・日程だけ)、夏時間の変換
 * (Europe/Berlin)、冪等、dry-run、指標が無いときに何も書かない、ワークフローの手動 target を確かめる。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  BOJ_ECB_SCHEDULES,
  BOJ_DECISION_DATES,
  BOJ_MEETING_PROVIDER,
  ECB_DECISION_DATES,
  ECB_MEETING_PROVIDER,
} from '../../src/ingestion/mappings/centralBankSchedule.js';
import {
  ingestOfficialScheduleTables,
  officialScheduleUtc,
} from '../../src/ingestion/pipelines/officialScheduleTable.js';
import { readOnlyIngestionStore } from '../../src/ingestion/pipelines/blsCalendar.js';
import { JobCounters } from '../../src/ingestion/runner.js';
import { MemoryIngestionStore } from '../helpers/memoryIngestionStore.js';

const NOW = new Date('2026-11-25T06:00:00Z');
const now = () => NOW;
const [bojTable, ecbTable] = BOJ_ECB_SCHEDULES;

let store: MemoryIngestionStore;
beforeEach(() => {
  store = new MemoryIngestionStore();
  store.indicators = [
    { id: 'ind-boj', code: 'BOJ_RATE', importance: 'HIGH', favorable_direction: 'NEUTRAL' },
    { id: 'ind-ecb', code: 'EU_ECB_RATE', importance: 'HIGH', favorable_direction: 'NEUTRAL' },
  ];
});

describe('the tables read from the official pages on 2026-11-25', () => {
  it('BOJ: decision days (2nd day of each 2-day meeting) shown on the official page, future only', () => {
    expect(BOJ_DECISION_DATES).toEqual([
      '2026-12-18',
      '2027-01-22',
      '2027-03-18',
      '2027-04-28',
      '2027-06-11',
      '2027-07-22',
      '2027-09-22',
      '2027-10-29',
      '2027-12-17',
    ]);
  });
  it('ECB: Day 2 of each monetary policy meeting shown on the official calendar', () => {
    expect(ECB_DECISION_DATES).toEqual([
      '2026-12-17',
      '2027-02-04',
      '2027-03-18',
      '2027-04-29',
      '2027-06-10',
      '2027-07-22',
      '2027-09-09',
      '2027-10-28',
      '2027-12-16',
    ]);
  });
  it('keys are the stable meeting month (not the date); meeting period and decision day are kept apart', () => {
    expect(bojTable!.entries[0]).toMatchObject({
      key: '2026-12',
      releaseDate: '2026-12-18',
      meeting: { startDate: '2026-12-17', endDate: '2026-12-18' },
      provisional: false,
    });
    expect(ecbTable!.entries[1]).toMatchObject({
      key: '2027-02',
      releaseDate: '2027-02-04',
      meeting: { startDate: '2027-02-03', endDate: '2027-02-04' },
    });
    for (const table of BOJ_ECB_SCHEDULES) {
      expect(new Set(table.entries.map((e) => e.key)).size).toBe(table.entries.length);
      for (const e of table.entries) {
        expect(e.meeting!.endDate).toBe(e.releaseDate);
        expect(e.meeting!.startDate < e.meeting!.endDate).toBe(true);
      }
    }
  });

  it('every entry is DATE_ONLY (the pages give no time), checked on 2026-11-25, with its source', () => {
    for (const table of BOJ_ECB_SCHEDULES) {
      for (const e of table.entries) {
        expect(e.precision).toBe('DATE_ONLY');
        expect(e.checkedAt).toBe('2026-11-25');
        expect(e.sources).toHaveLength(1);
      }
    }
    expect(bojTable!.provider).toBe(BOJ_MEETING_PROVIDER);
    expect(ecbTable!.provider).toBe(ECB_MEETING_PROVIDER);
  });
});

describe('time zone handling (Europe/Berlin 14:15 reference time, Asia/Tokyo 12:00)', () => {
  const utc = (table: typeof bojTable, date: string) =>
    officialScheduleUtc(table!.entries.find((e) => e.releaseDate === date)!)?.toISOString();
  it('ECB winter (CET, UTC+1) and summer (CEST, UTC+2), including around the 2027-03-28 switch', () => {
    expect(utc(ecbTable, '2026-12-17')).toBe('2026-12-17T13:15:00.000Z');
    expect(utc(ecbTable, '2027-02-04')).toBe('2027-02-04T13:15:00.000Z');
    expect(utc(ecbTable, '2027-03-18')).toBe('2027-03-18T13:15:00.000Z'); // まだ CET
    expect(utc(ecbTable, '2027-04-29')).toBe('2027-04-29T12:15:00.000Z'); // CEST
    expect(utc(ecbTable, '2027-10-28')).toBe('2027-10-28T12:15:00.000Z'); // 10/31 の前なので CEST
    expect(utc(ecbTable, '2027-12-16')).toBe('2027-12-16T13:15:00.000Z');
  });
  it('BOJ has no daylight saving: 12:00 JST = 03:00 UTC', () => {
    expect(utc(bojTable, '2026-12-18')).toBe('2026-12-18T03:00:00.000Z');
    expect(utc(bojTable, '2027-07-22')).toBe('2027-07-22T03:00:00.000Z');
  });
});

describe('ingestOfficialScheduleTables with the BOJ/ECB tables', () => {
  it('creates 18 SCHEDULED, DATE_ONLY, value-less events under two providers', async () => {
    const result = await ingestOfficialScheduleTables({ store, tables: BOJ_ECB_SCHEDULES, now }, new JobCounters());
    expect(result).toMatchObject({ inserted: 18, updated: 0, past: 0 });
    expect(store.events).toHaveLength(18);
    for (const e of store.events) {
      expect(e).toMatchObject({ status: 'SCHEDULED', data_status: 'PENDING', release_datetime_precision: 'DATE_ONLY' });
    }
    expect(store.events.filter((e) => e.provider === BOJ_MEETING_PROVIDER)).toHaveLength(9);
    expect(store.events.filter((e) => e.indicator_id === 'ind-ecb')).toHaveLength(9);
    expect(store.snapshots).toEqual([]);
  });

  it('is idempotent', async () => {
    await ingestOfficialScheduleTables({ store, tables: BOJ_ECB_SCHEDULES, now }, new JobCounters());
    const again = await ingestOfficialScheduleTables({ store, tables: BOJ_ECB_SCHEDULES, now }, new JobCounters());
    expect(again).toMatchObject({ inserted: 0, updated: 0, unchanged: 18 });
    expect(store.events).toHaveLength(18);
  });

  it('dry run through the read-only store plans 18 INSERTs and writes nothing', async () => {
    const planned = await ingestOfficialScheduleTables(
      { store: readOnlyIngestionStore(store), tables: BOJ_ECB_SCHEDULES, now, dryRun: true },
      new JobCounters(),
    );
    expect(planned.inserted).toBe(18);
    expect(planned.plan.every((p) => p.action === 'INSERT')).toBe(true);
    expect(store.events).toEqual([]);
  });

  it('without EU_ECB_RATE: BOJ is written, the ECB table errors and writes nothing', async () => {
    store.indicators = store.indicators.filter((i) => i.code === 'BOJ_RATE');
    const counters = new JobCounters();
    await ingestOfficialScheduleTables({ store, tables: BOJ_ECB_SCHEDULES, now }, counters);
    expect(counters.errors).toBe(1);
    expect(store.events).toHaveLength(9);
    expect(store.events.every((e) => e.provider === BOJ_MEETING_PROVIDER)).toBe(true);
  });
});

describe('schedule changes, source and display (HQ 2026-11-25)', () => {
  const run = (tables = BOJ_ECB_SCHEDULES, dryRun = false, st = store) =>
    ingestOfficialScheduleTables({ store: st, tables, now, dryRun }, new JobCounters());
  const moved = (patch: object, ecb = true) =>
    BOJ_ECB_SCHEDULES.map((t) =>
      t.provider !== (ecb ? ECB_MEETING_PROVIDER : BOJ_MEETING_PROVIDER)
        ? t
        : { ...t, entries: t.entries.map((e, i) => (i === 0 ? { ...e, ...patch } : e)) },
    );

  it('saves the meeting period and the official source URL per event (no values anywhere)', async () => {
    await run();
    expect(store.eventMeetings).toHaveLength(18);
    const ecbEvent = store.events.find((e) => e.provider_event_id === 'ecb_meeting_schedule:EU_ECB_RATE:2026-12')!;
    expect(store.eventMeetings.find((m) => m.event_id === ecbEvent.id)).toEqual({
      event_id: ecbEvent.id,
      meeting_start_date: '2026-12-16',
      meeting_end_date: '2026-12-17',
      source_url: 'https://www.ecb.europa.eu/press/calendars/mgcgc/html/index.en.html',
      checked_at: '2026-11-25',
    });
    expect(store.eventMeetings.every((m) => m.source_url.startsWith('https://'))).toBe(true);
    expect(store.snapshots).toEqual([]);
  });

  it('a moved meeting (same key, new date) updates the same row and the meeting period; no duplicate', async () => {
    await run();
    const before = store.events.length;
    await run(moved({ releaseDate: '2026-12-18', meeting: { startDate: '2026-12-17', endDate: '2026-12-18' } }));
    const rows = store.events.filter((e) => e.provider === ECB_MEETING_PROVIDER);
    expect(store.events).toHaveLength(before);
    expect(rows.find((e) => e.provider_event_id.endsWith(':2026-12'))!.release_datetime).toBe(
      '2026-12-18T13:15:00.000Z',
    );
    expect(store.eventMeetings.filter((m) => m.meeting_end_date === '2026-12-18')).toHaveLength(2); // BOJ と ECB
  });

  it('cancelled: true marks the existing row CANCELLED (kept); restoring it makes it SCHEDULED again', async () => {
    await run();
    await run(moved({ cancelled: true }));
    const row = () => store.events.find((e) => e.provider_event_id === 'ecb_meeting_schedule:EU_ECB_RATE:2026-12')!;
    expect(row().status).toBe('CANCELLED');
    await run(moved({}));
    expect(row().status).toBe('SCHEDULED');
  });

  it('cancelled: true for a meeting not in the DB writes nothing', async () => {
    const counters = new JobCounters();
    await ingestOfficialScheduleTables({ store, tables: moved({ cancelled: true }), now }, counters);
    expect(store.events).toHaveLength(17);
  });

  it('provisional: true sets is_provisional (and back to false when confirmed)', async () => {
    await run(moved({ provisional: true }, false));
    const row = () => store.events.find((e) => e.provider_event_id === 'boj_meeting_schedule:BOJ_RATE:2026-12')!;
    expect(row().is_provisional).toBe(true);
    await run();
    expect(row().is_provisional).toBe(false);
  });

  it('dry run shows JST (CET 14:15 = 22:15 JST, CEST 14:15 = 21:15 JST) and writes no meeting', async () => {
    const planned = await run(BOJ_ECB_SCHEDULES, true, store);
    const jst = (id: string) => planned.plan.find((p) => p.provider_event_id === id)!.release_datetime_jst;
    expect(jst('ecb_meeting_schedule:EU_ECB_RATE:2026-12')).toBe('2026-12-17 22:15 JST');
    expect(jst('ecb_meeting_schedule:EU_ECB_RATE:2027-04')).toBe('2027-04-29 21:15 JST');
    expect(jst('boj_meeting_schedule:BOJ_RATE:2026-12')).toBe('2026-12-18 12:00 JST');
    expect(store.eventMeetings).toEqual([]);
  });
});

describe('ingestion workflow targets', () => {
  const wf = readFileSync(
    join(process.cwd(), '..', '.github', 'workflows', 'fx-event-analyzer-ingestion.yml'),
    'utf8',
  ).replace(/\r\n/g, '\n');
  const steps = wf.split('\n      - name: ').slice(1);
  it.each([
    ['boj-ecb-schedule-dry-run', 'npm run -s ingest:boj-ecb-schedule -- --dry-run'],
    ['boj-ecb-schedule', 'npm run -s ingest:boj-ecb-schedule'],
  ])('target %s: manual only, after the DEV check, no secrets', (target, command) => {
    const found = steps.filter((s) => s.includes(`inputs.target == '${target}'`));
    expect(found).toHaveLength(1);
    const step = found[0]!;
    expect(step).toContain("steps.check.outputs.ready == 'true'");
    expect(step).toContain("github.event_name == 'workflow_dispatch'");
    expect(step).not.toContain('github.event.schedule');
    expect(step).not.toContain('secrets.');
    expect(step.includes(`run: ${command}\n`) || step.endsWith(`run: ${command}`)).toBe(true);
  });
});
