/**
 * ECB の週間予定(HQ判断 2026-10-27 案A)。保存した本物のページ(2026-10-27 取得、連絡先は削除)で確かめる。
 */
import { describe, expect, it } from 'vitest';
import {
  ECB_WEEKLY_PROVIDER,
  parseEcbDate,
  parseEcbTime,
  parseEcbWeeklySchedule,
} from '../../src/ingestion/adapters/ecbWeeklySchedule.js';
import { ingestSpeeches } from '../../src/ingestion/pipelines/speeches.js';
import { JobCounters } from '../../src/ingestion/runner.js';
import { fixture, MemoryIngestionStore } from '../helpers/memoryIngestionStore.js';

describe('parseEcbWeeklySchedule (recorded page, 2026-10-23〜10-30)', () => {
  it('takes only Board member entries with an exact CET time, converted from Europe/Berlin (winter, UTC+1)', async () => {
    const { speeches, skipped, entries } = parseEcbWeeklySchedule(await fixture('ecb-weekly-schedule.html'));
    expect(entries).toBe(24);
    expect(speeches.map((s) => [s.speakerName, s.startsAt, s.kind])).toEqual([
      ['Frank Elderson', '2026-10-26T05:00:00.000Z', 'SPEECH'], // 06:00 CET / 9:00 local time(エレバン UTC+4)
      ['Piero Cipollone', '2026-10-29T15:50:00.000Z', 'SPEECH'], // 16:50 CET
      ['Philip R. Lane', '2026-10-30T16:10:00.000Z', 'SPEECH'], // 17:10 CET/09:10 local time(サンフランシスコ PDT UTC−7)
    ]);
    expect(speeches.every((s) => s.provider === ECB_WEEKLY_PROVIDER && s.timePrecision === 'EXACT')).toBe(true);
    expect(skipped.map((s) => s.reason).sort()).toEqual(
      ['NOT_PUBLIC', 'SUMMER_TIME_UNVERIFIED', 'SUMMER_TIME_UNVERIFIED'].sort(),
    );
  });

  it('keeps out items on summer-time days (10/23 is before the 10/25 switch) — the meaning of "CET" there is unverified', async () => {
    const { skipped } = parseEcbWeeklySchedule(await fixture('ecb-weekly-schedule.html'));
    const summer = skipped.filter((s) => s.reason === 'SUMMER_TIME_UNVERIFIED').map((s) => s.title.split(':')[0]);
    expect(summer.sort()).toEqual(['Patrick Montagner', 'Piero Cipollone']);
  });

  it('reads summer-time items as CEST only when explicitly verified', async () => {
    const { speeches } = parseEcbWeeklySchedule(await fixture('ecb-weekly-schedule.html'), {
      summerTimeVerified: true,
    });
    const cipollone = speeches.find((s) => s.startsAt.startsWith('2026-10-23') && s.speakerName === 'Piero Cipollone');
    expect(cipollone).toMatchObject({
      speakerName: 'Piero Cipollone',
      startsAt: '2026-10-23T14:00:00.000Z',
      kind: 'DISCUSSION',
    });
  });

  it('leaves out non-public items (the informal dinner)', async () => {
    const { skipped } = parseEcbWeeklySchedule(await fixture('ecb-weekly-schedule.html'));
    expect(skipped.find((s) => s.reason === 'NOT_PUBLIC')?.title).toMatch(/^Christine Lagarde: Informal dinner/);
  });

  it('throws (instead of returning 0 silently) when the page structure is not recognised', () => {
    expect(() => parseEcbWeeklySchedule('<html><body><div>new layout</div></body></html>')).toThrow(/structure/);
  });

  it('returns nothing (no error) for a week with no Board member entries', () => {
    const html =
      '<dl><dt>Monday, 2 November 2026</dt><dd><strong>Event:</strong> Statistics <br><strong>Time:</strong> 10:00</dd></dl>';
    expect(parseEcbWeeklySchedule(html)).toMatchObject({ speeches: [], skipped: [], entries: 1 });
  });

  it('skips entries without an exact time, and duplicate rows on the page', () => {
    const entry = (time: string) =>
      `<dt>Monday, 2 November 2026</dt><dd><strong>Board member:</strong> Philip R. Lane<br><strong>Event:</strong> Keynote speech<br><strong>Time:</strong> ${time}<br></dd>`;
    const html = `<dl>${entry('10:00 CET')}${entry('10:00 CET')}${entry('to be confirmed')}</dl>`;
    const { speeches, skipped } = parseEcbWeeklySchedule(html);
    expect(speeches).toHaveLength(1);
    expect(speeches[0]!.startsAt).toBe('2026-11-02T09:00:00.000Z');
    expect(skipped.map((s) => s.reason)).toEqual(['DUPLICATE_ON_PAGE', 'TIME_MISSING']);
  });
});

describe('parseEcbDate / parseEcbTime', () => {
  it('parses the page formats', () => {
    expect(parseEcbDate('Friday, 30 October 2026')).toEqual([2026, 10, 30]);
    expect(parseEcbDate('Someday')).toBeNull();
    expect(parseEcbTime('17:10 CET/09:10 local time')).toEqual({ hour: 17, minute: 10 });
    expect(parseEcbTime('06:00 CET / 9:00 local time')).toEqual({ hour: 6, minute: 0 });
    expect(parseEcbTime('10:00')).toBeNull(); // CET の書かれていない時刻は使わない
  });
});

describe('ECB weekly schedule → speech_events', () => {
  it('ingests known speakers once (rerun does not duplicate), skips unknown ones', async () => {
    const store = new MemoryIngestionStore();
    store.speakers = [
      { id: 'sp-lane', name: 'フィリップ・レーン', organization: 'ECB' },
      { id: 'sp-elderson', name: 'フランク・エルダーソン', organization: 'ECB' },
      { id: 'sp-cipollone', name: 'ピエロ・チポローネ', organization: 'ECB' },
    ];
    const { speeches } = parseEcbWeeklySchedule(await fixture('ecb-weekly-schedule.html'));
    const now = () => new Date('2026-10-27T12:00:00Z');
    await ingestSpeeches(ECB_WEEKLY_PROVIDER, speeches, { store, now }, new JobCounters());
    const counters = new JobCounters();
    await ingestSpeeches(ECB_WEEKLY_PROVIDER, speeches, { store, now }, counters);
    expect(store.speeches.map((s) => [s.speaker_id, s.statement_datetime, s.status])).toEqual([
      ['sp-elderson', '2026-10-26T05:00:00.000Z', 'DELIVERED'],
      ['sp-cipollone', '2026-10-29T15:50:00.000Z', 'SCHEDULED'],
      ['sp-lane', '2026-10-30T16:10:00.000Z', 'SCHEDULED'],
    ]);
    expect(counters.errorMessages).toEqual([]);
  });

  it('records a scheduled speech that disappeared from the page (cancelled / moved) without deleting it', async () => {
    // 消えた予定を記録するのは、その取得の最新の時刻までの範囲(既存の仕組み)。ページの範囲より先の予定は対象にしない。
    const store = new MemoryIngestionStore();
    store.speakers = [
      { id: 'sp-lane', name: 'フィリップ・レーン', organization: 'ECB' },
      { id: 'sp-cipollone', name: 'ピエロ・チポローネ', organization: 'ECB' },
    ];
    const { speeches } = parseEcbWeeklySchedule(await fixture('ecb-weekly-schedule.html'));
    const now = () => new Date('2026-10-27T12:00:00Z');
    await ingestSpeeches(ECB_WEEKLY_PROVIDER, speeches, { store, now }, new JobCounters());
    const counters = new JobCounters();
    await ingestSpeeches(
      ECB_WEEKLY_PROVIDER,
      speeches.filter((s) => s.speakerName !== 'Piero Cipollone'),
      { store, now },
      counters,
    );
    expect(store.speeches).toHaveLength(2); // 消さない
    expect(counters.details.disappeared_scheduled_speeches).toEqual(['2026-10-29_1650_piero-cipollone']);
  });
});
