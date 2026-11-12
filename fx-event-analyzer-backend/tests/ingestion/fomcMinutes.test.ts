/**
 * FOMC 議事要旨(HQ指示 2026-10-27「会合日とは別イベントにする」「公式発表日が確認できるものだけ」)。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { FOMC_MINUTES_SCHEDULE, FOMC_SCHEDULE } from '../../src/ingestion/mappings/fomcSchedule.js';
import {
  FOMC_MINUTES_PROVIDER,
  FOMC_MINUTES_TARGET,
  FOMC_SCHEDULE_PROVIDER,
  fomcAnnouncementUtc,
  fomcMinutesProviderEventId,
  ingestFomcSchedule,
} from '../../src/ingestion/pipelines/fomcSchedule.js';
import { JobCounters } from '../../src/ingestion/runner.js';
import { MemoryIngestionStore } from '../helpers/memoryIngestionStore.js';

const NOW = () => new Date('2026-10-27T12:00:00Z');

describe('FOMC_MINUTES_SCHEDULE (calendar.json "FOMC Minutes" only)', () => {
  it('has only the officially published minutes dates, 14:00 New York (not the meeting time)', () => {
    expect(FOMC_MINUTES_SCHEDULE.map((e) => [e.meetingEnd, fomcAnnouncementUtc(e)?.toISOString()])).toEqual([
      ['2026-10-28', '2026-11-18T19:00:00.000Z'], // 14:00 EST(米国は 11/1 に冬時間)
      ['2026-12-09', '2026-12-30T19:00:00.000Z'],
    ]);
  });

  it('is a different event from the meeting it reports on (different date, provider and id)', () => {
    for (const minutes of FOMC_MINUTES_SCHEDULE) {
      const meeting = FOMC_SCHEDULE.find((m) => m.meetingEnd === minutes.meetingEnd)!;
      expect(fomcAnnouncementUtc(minutes)!.getTime()).toBeGreaterThan(fomcAnnouncementUtc(meeting)!.getTime());
      expect(fomcMinutesProviderEventId(minutes)).toBe(`fomc_minutes_schedule:${minutes.meetingEnd}`);
      // 会合が暫定なら、その議事要旨も暫定
      expect(minutes.provisional).toBe(meeting.provisional);
    }
  });
});

describe('ingestFomcSchedule with FOMC_MINUTES_TARGET', () => {
  let store: MemoryIngestionStore;

  beforeEach(() => {
    store = new MemoryIngestionStore();
    store.indicators = [
      { id: 'ind-fomc', code: 'US_FOMC', importance: 'HIGH', favorable_direction: 'NEUTRAL' },
      { id: 'ind-min', code: 'US_FOMC_MINUTES', importance: 'MEDIUM', favorable_direction: 'NEUTRAL' },
    ];
  });

  it('writes SCHEDULED rows for the minutes indicator only, without values; a rerun changes nothing', async () => {
    const first = await ingestFomcSchedule({ store, target: FOMC_MINUTES_TARGET, now: NOW }, new JobCounters());
    expect(first).toMatchObject({ inserted: 2, provisional: 1, past: 0 });
    expect(
      store.events.map((e) => [e.provider, e.provider_event_id, e.indicator_id, e.status, e.release_datetime]),
    ).toEqual([
      [FOMC_MINUTES_PROVIDER, 'fomc_minutes_schedule:2026-10-28', 'ind-min', 'SCHEDULED', '2026-11-18T19:00:00.000Z'],
      [FOMC_MINUTES_PROVIDER, 'fomc_minutes_schedule:2026-12-09', 'ind-min', 'SCHEDULED', '2026-12-30T19:00:00.000Z'],
    ]);
    expect(store.events.map((e) => e.importance)).toEqual(['MEDIUM', 'MEDIUM']);
    expect(store.snapshots).toEqual([]);

    const again = await ingestFomcSchedule({ store, target: FOMC_MINUTES_TARGET, now: NOW }, new JobCounters());
    expect(again).toMatchObject({ inserted: 0, unchanged: 2 });
    expect(store.events).toHaveLength(2);
  });

  it('does not touch the meeting rows (fomc_schedule), and the meeting run does not touch the minutes', async () => {
    await ingestFomcSchedule({ store, now: NOW }, new JobCounters());
    const meetings = store.events.length;
    await ingestFomcSchedule({ store, target: FOMC_MINUTES_TARGET, now: NOW }, new JobCounters());
    expect(store.events.filter((e) => e.provider === FOMC_SCHEDULE_PROVIDER)).toHaveLength(meetings);
    expect(store.events.filter((e) => e.provider === FOMC_MINUTES_PROVIDER)).toHaveLength(2);
    const rerun = await ingestFomcSchedule({ store, now: NOW }, new JobCounters());
    expect(rerun.removed).toEqual([]); // 議事要旨の行を「表から消えた会合」と取り違えない
  });

  it('reports an error (and writes nothing) when the minutes indicator row is missing', async () => {
    store.indicators = store.indicators.filter((i) => i.code !== 'US_FOMC_MINUTES');
    const counters = new JobCounters();
    await ingestFomcSchedule({ store, target: FOMC_MINUTES_TARGET, now: NOW }, counters);
    expect(counters.errorMessages).toEqual(['economic_indicators has no US_FOMC_MINUTES row']);
    expect(store.events).toEqual([]);
  });

  it('never creates minutes whose release is already past', async () => {
    const result = await ingestFomcSchedule(
      { store, target: FOMC_MINUTES_TARGET, now: () => new Date('2026-12-01T00:00:00Z') },
      new JobCounters(),
    );
    expect(result).toMatchObject({ inserted: 1, past: 1 });
  });
});
