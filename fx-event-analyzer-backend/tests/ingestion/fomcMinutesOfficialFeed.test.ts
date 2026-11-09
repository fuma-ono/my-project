/**
 * FOMC 議事要旨の公式スケジュール自動更新(HQ指示 2026-11-05「公式スケジュール自動更新」)。
 * FRB の calendar.json に載った議事要旨だけを、会合の表のどの会合の分か照らし合わせて足す。日付を作らない・
 * 既にある予定を消さない・上書きしない・重複させない・取れなければ表だけで入れる、を確かめる。
 * calendar.json は偽物(下の feed())。2027年の議事要旨の日付は、テスト用の値(実際の公表日ではない)。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { FRB_CALENDAR_URL, parseFrbFomcMinutes } from '../../src/ingestion/adapters/frbCalendar.js';
import { FOMC_MINUTES_SCHEDULE, FOMC_SCHEDULE } from '../../src/ingestion/mappings/fomcSchedule.js';
import {
  FOMC_MINUTES_PROVIDER,
  ingestFomcMinutesSchedule,
  mergeOfficialMinutes,
} from '../../src/ingestion/pipelines/fomcSchedule.js';
import { JobCounters } from '../../src/ingestion/runner.js';
import { MemoryIngestionStore } from '../helpers/memoryIngestionStore.js';

const NOW = new Date('2026-11-05T07:00:00Z');

/** calendar.json の形(type "FOMC"・title "FOMC Minutes"・month・days・time)。 */
function feed(items: { month: string; days: string; time?: string; title?: string; type?: string }[]) {
  return {
    events: [
      { type: 'FOMC', title: 'FOMC Meeting', month: '2026-12', days: '9', time: '2:00 p.m.' },
      {
        type: 'Speeches',
        title: 'Speech - Governor Michael S. Barr',
        month: '2026-11',
        days: '12',
        time: '10:00 a.m.',
      },
      ...items.map((item) => ({
        type: item.type ?? 'FOMC',
        title: item.title ?? 'FOMC Minutes',
        month: item.month,
        days: item.days,
        time: item.time ?? '2:00 p.m.',
      })),
    ],
  };
}

/** 今の calendar.json と同じ: 議事要旨は 2026-12-30 まで(2027年は無い)。 */
const CURRENT_FEED = feed([
  { month: '2026-10', days: '7' },
  { month: '2026-11', days: '18' },
  { month: '2026-12', days: '30' },
]);
/** 2027-01-26〜27 の会合の議事要旨が載った後(日付はテスト用)。 */
const FEED_WITH_2027 = feed([
  { month: '2026-11', days: '18' },
  { month: '2026-12', days: '30' },
  { month: '2027-02', days: '17' },
]);

const minutesRows = (store: MemoryIngestionStore) =>
  store.events
    .filter((e) => e.provider === FOMC_MINUTES_PROVIDER)
    .map((e) => [e.provider_event_id, e.indicator_id, e.status, e.release_datetime]);

describe('parseFrbFomcMinutes', () => {
  it('reads only "FOMC Minutes" items with a date and a time, once per date', () => {
    const result = parseFrbFomcMinutes(
      feed([
        { month: '2026-12', days: '30' },
        { month: '2026-12', days: '30', title: ' FOMC Minutes' }, // 同じ日(前の空白は無視)
        { month: '', days: '21', type: 'events' }, // 古い年の、月が空の項目
        { month: '2027-02', days: '17', time: '' },
      ]),
    );
    expect(result.releases).toEqual([{ date: '2026-12-30', time: '14:00' }]);
    expect(result.skipped).toEqual([
      { title: 'FOMC Minutes', reason: 'DATE_UNREADABLE' },
      { title: 'FOMC Minutes', reason: 'TIME_MISSING', date: '2027-02-17' },
    ]);
  });
});

describe('mergeOfficialMinutes', () => {
  const source = { url: FRB_CALENDAR_URL, fetchedAt: NOW };

  it('adds nothing while calendar.json has no minutes beyond the table (no 2027 dates are made up)', () => {
    const { releases } = parseFrbFomcMinutes(CURRENT_FEED);
    const merge = mergeOfficialMinutes(FOMC_MINUTES_SCHEDULE, FOMC_SCHEDULE, releases, source);
    expect(merge.entries).toEqual([...FOMC_MINUTES_SCHEDULE]);
    expect(merge).toMatchObject({ added: [], conflicts: [], unmatched: [], past: 1 });
  });

  it('adds a newly published minutes date for the meeting just before it, with the feed date and source', () => {
    const { releases } = parseFrbFomcMinutes(FEED_WITH_2027);
    const merge = mergeOfficialMinutes(FOMC_MINUTES_SCHEDULE, FOMC_SCHEDULE, releases, source);
    expect(merge.added).toEqual([{ meetingEnd: '2027-01-27', date: '2027-02-17', time: '14:00' }]);
    const added = merge.entries.at(-1)!;
    expect(added).toMatchObject({
      meetingStart: '2027-01-26',
      meetingEnd: '2027-01-27',
      announcement: { date: '2027-02-17', time: '14:00', timeZone: 'America/New_York' },
      provisional: true, // 会合が暫定なので議事要旨も暫定(表の決まりと同じ)
      sources: [FRB_CALENDAR_URL],
      officialFeed: { url: FRB_CALENDAR_URL, fetchedAt: NOW.toISOString() },
    });
    // 表の行はそのまま
    expect(merge.entries.slice(0, FOMC_MINUTES_SCHEDULE.length)).toEqual([...FOMC_MINUTES_SCHEDULE]);
  });

  it('keeps the table when the feed disagrees, and only reports the conflict', () => {
    const { releases } = parseFrbFomcMinutes(feed([{ month: '2026-11', days: '19' }]));
    const merge = mergeOfficialMinutes(FOMC_MINUTES_SCHEDULE, FOMC_SCHEDULE, releases, source);
    expect(merge.entries).toEqual([...FOMC_MINUTES_SCHEDULE]);
    expect(merge.conflicts).toEqual([
      { meetingEnd: '2026-10-28', table: '2026-11-18 14:00', feed: '2026-11-19 14:00' },
    ]);
  });

  it('does not add minutes it cannot tie to one meeting of the table', () => {
    const { releases } = parseFrbFomcMinutes(
      feed([
        { month: '2028-02', days: '05' }, // 表の最後の会合(2027-12-08)から42日より後
        { month: '2027-03', days: '17' }, // 2027-03-16〜17 の会合の日(次の会合が始まっている)
        { month: '2027-02', days: '17' },
        { month: '2027-02', days: '24' }, // 同じ会合(2027-01-27)の2つ目
      ]),
    );
    const merge = mergeOfficialMinutes(FOMC_MINUTES_SCHEDULE, FOMC_SCHEDULE, releases, source);
    expect(merge.added.map((a) => a.date)).toEqual(['2027-02-17']);
    expect(merge.unmatched).toEqual([
      { date: '2027-02-24', time: '14:00', reason: 'DUPLICATE_FOR_MEETING' },
      { date: '2027-03-17', time: '14:00', reason: 'AFTER_NEXT_MEETING' },
      { date: '2028-02-05', time: '14:00', reason: 'TOO_FAR_FROM_MEETING' },
    ]);
  });

  it('does not tie minutes to a cancelled meeting', () => {
    const meetings = FOMC_SCHEDULE.map((m) =>
      m.meetingEnd === '2027-01-27' ? { ...m, cancelled: { note: 'test' } } : m,
    );
    const { releases } = parseFrbFomcMinutes(FEED_WITH_2027);
    const merge = mergeOfficialMinutes(FOMC_MINUTES_SCHEDULE, meetings, releases, source);
    // 2027-02-17 の前の(中止でない)会合は 2026-12-09 で、42日より前 — どの会合の分か決められないので足さない
    expect(merge.added).toEqual([]);
    expect(merge.conflicts).toEqual([]);
    expect(merge.unmatched).toEqual([{ date: '2027-02-17', time: '14:00', reason: 'TOO_FAR_FROM_MEETING' }]);
  });
});

describe('ingestFomcMinutesSchedule', () => {
  let store: MemoryIngestionStore;

  beforeEach(() => {
    store = new MemoryIngestionStore();
    store.indicators = [
      { id: 'ind-fomc', code: 'US_FOMC', importance: 'HIGH', favorable_direction: 'NEUTRAL' },
      { id: 'ind-min', code: 'US_FOMC_MINUTES', importance: 'MEDIUM', favorable_direction: 'NEUTRAL' },
    ];
  });

  const run = (body: unknown, now = NOW) => {
    const counters = new JobCounters();
    const fetchMinutes = () => Promise.resolve(parseFrbFomcMinutes(body));
    return ingestFomcMinutesSchedule({ store, fetchMinutes, now: () => now }, counters).then((result) => ({
      result,
      counters,
    }));
  };

  it('with the current calendar.json, writes the table rows only (same as before)', async () => {
    const { result, counters } = await run(CURRENT_FEED);
    expect(result).toMatchObject({ inserted: 2 });
    expect(minutesRows(store)).toEqual([
      ['fomc_minutes_schedule:2026-10-28', 'ind-min', 'SCHEDULED', '2026-11-18T19:00:00.000Z'],
      ['fomc_minutes_schedule:2026-12-09', 'ind-min', 'SCHEDULED', '2026-12-30T19:00:00.000Z'],
    ]);
    expect(counters.details.official_feed).toMatchObject({ status: 'OK', url: FRB_CALENDAR_URL, added: [] });
  });

  it('adds the newly published minutes once; a rerun adds no duplicate', async () => {
    const first = await run(FEED_WITH_2027);
    expect(first.result).toMatchObject({ inserted: 3 });
    expect(minutesRows(store).at(-1)).toEqual([
      'fomc_minutes_schedule:2027-01-27',
      'ind-min',
      'SCHEDULED',
      '2027-02-17T19:00:00.000Z',
    ]);
    expect(first.counters.details.official_feed).toMatchObject({
      status: 'OK',
      added: [{ meetingEnd: '2027-01-27', date: '2027-02-17', time: '14:00' }],
    });

    const again = await run(FEED_WITH_2027);
    expect(again.result).toMatchObject({ inserted: 0, unchanged: 3 });
    expect(minutesRows(store)).toHaveLength(3);
  });

  it('never moves a row it added earlier when the feed later shows another date (logged as a conflict)', async () => {
    await run(FEED_WITH_2027);
    const moved = feed([
      { month: '2026-11', days: '18' },
      { month: '2026-12', days: '30' },
      { month: '2027-02', days: '18' },
    ]);
    const { result, counters } = await run(moved);
    expect(result).toMatchObject({ inserted: 0, updated: 0 });
    expect(minutesRows(store).at(-1)?.[3]).toBe('2027-02-17T19:00:00.000Z');
    expect(counters.details.official_feed_conflicts).toEqual([
      {
        provider_event_id: 'fomc_minutes_schedule:2027-01-27',
        in_db: '2027-02-17T19:00:00.000Z',
        in_feed: '2027-02-18T19:00:00.000Z',
        source: FRB_CALENDAR_URL,
      },
    ]);
  });

  it('keeps a row it added earlier when the minutes disappear from the feed (not deleted or cancelled)', async () => {
    await run(FEED_WITH_2027);
    const { result } = await run(CURRENT_FEED);
    expect(result.removed).toEqual(['fomc_minutes_schedule:2027-01-27']); // ログに出すだけ
    expect(minutesRows(store).at(-1)).toEqual([
      'fomc_minutes_schedule:2027-01-27',
      'ind-min',
      'SCHEDULED',
      '2027-02-17T19:00:00.000Z',
    ]);
  });

  it('when calendar.json cannot be fetched, writes the table only and records it (no error)', async () => {
    const counters = new JobCounters();
    const fetchMinutes = () => Promise.reject(new Error('HTTP 503 from www.federalreserve.gov'));
    const result = await ingestFomcMinutesSchedule({ store, fetchMinutes, now: () => NOW }, counters);
    expect(result).toMatchObject({ inserted: 2 });
    expect(counters.errorMessages).toEqual([]);
    expect(counters.details.official_feed).toEqual({
      status: 'UNAVAILABLE',
      url: FRB_CALENDAR_URL,
      fetched_at: NOW.toISOString(),
      error: 'HTTP 503 from www.federalreserve.gov',
    });
  });

  it('a broken calendar.json (not the expected shape) is also UNAVAILABLE, and existing rows stay', async () => {
    await run(FEED_WITH_2027);
    const counters = new JobCounters();
    const fetchMinutes = () => Promise.resolve(parseFrbFomcMinutes({ unexpected: true }));
    const result = await ingestFomcMinutesSchedule({ store, fetchMinutes, now: () => NOW }, counters);
    expect(counters.details.official_feed).toMatchObject({ status: 'UNAVAILABLE' });
    expect(result.removed).toEqual(['fomc_minutes_schedule:2027-01-27']);
    expect(minutesRows(store)).toHaveLength(3);
  });

  it('does not touch the meeting rows (US_FOMC)', async () => {
    await run(FEED_WITH_2027);
    expect(store.events.every((e) => e.indicator_id === 'ind-min')).toBe(true);
  });
});
