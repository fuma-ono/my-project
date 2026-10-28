/**
 * ECB の週間予定(HQ判断 2026-10-27 案A)。保存した本物のページ(2026-10-27 取得、連絡先は削除)で確かめる。
 */
import { describe, expect, it } from 'vitest';
import {
  ECB_TIME_ZONE,
  ECB_WEEKLY_PROVIDER,
  ecbReconcileOptions,
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

  it('reports the days the page covers, including entries without a Board member (R3)', async () => {
    // 10/23(金、夏時間 UTC+2)00:00 〜 10/30 の翌日 10/31(冬時間 UTC+1)00:00
    expect(parseEcbWeeklySchedule(await fixture('ecb-weekly-schedule.html')).coverage).toEqual({
      fromIso: '2026-10-22T22:00:00.000Z',
      toIso: '2026-10-30T23:00:00.000Z',
    });
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

  it('without reconcile (the default, as for FRB): a disappeared scheduled speech is only logged', async () => {
    // 消えた予定を記録するのは、その取得の最新の時刻までの範囲(既存の仕組み)。ページの範囲より先の予定は対象にしない。
    // ジョブは ECB の週間予定にだけ reconcile を渡す(下の describe)。
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

// HQ判断 2026-10-28 R1〜R3: 消えた予定を中止・時刻の変更として扱う(ECB の週間予定だけ)。
describe('ECB weekly schedule → speech_events: reconcile disappeared speeches', () => {
  const day = (date: string, ...bodies: string[]) => bodies.map((body) => `<dt>${date}</dt><dd>${body}</dd>`).join('');
  const board = (name: string, time: string, event = 'Keynote speech') =>
    `<strong>Board member:</strong> ${name}<br><strong>Event:</strong> ${event}<br><strong>Time:</strong> ${time}<br>`;
  const lane = (time: string, event?: string) => board('Philip R. Lane', time, event);
  const cip = (time: string) => board('Piero Cipollone', time, 'Speech');
  const schnabel = (time: string) => board('Isabel Schnabel', time, 'Speech');
  const stats = '<strong>Event:</strong> Statistics<br><strong>Time:</strong> 10:00<br>';
  const page = (...days: string[]) => `<dl>${days.join('')}</dl>`;
  /** 11/2(月)〜11/6(金)を範囲にするページ(実際のページは前後の日も載せる)。 */
  const weekPage = (...days: string[]) =>
    page(day('Monday, 2 November 2026', stats), ...days, day('Friday, 6 November 2026', stats));
  const NOW = new Date('2026-11-02T06:00:00Z'); // 月曜 07:00 CET

  function newStore(): MemoryIngestionStore {
    const store = new MemoryIngestionStore();
    store.speakers = [
      { id: 'sp-lane', name: 'フィリップ・レーン', organization: 'ECB' },
      { id: 'sp-cip', name: 'ピエロ・チポローネ', organization: 'ECB' },
      { id: 'sp-schnabel', name: 'イザベル・シュナーベル', organization: 'ECB' },
    ];
    return store;
  }
  async function ingest(store: MemoryIngestionStore, html: string, now = NOW): Promise<JobCounters> {
    const result = parseEcbWeeklySchedule(html);
    const counters = new JobCounters();
    await ingestSpeeches(
      ECB_WEEKLY_PROVIDER,
      result.speeches,
      { store, now: () => now, reconcile: ecbReconcileOptions(result) },
      counters,
    );
    return counters;
  }
  const rows = (store: MemoryIngestionStore) =>
    store.speeches.map((row) => [row.provider_event_id, row.statement_datetime, row.status]);
  const WEEK = page(
    day('Monday, 2 November 2026', stats),
    day('Tuesday, 3 November 2026', lane('10:00 CET')),
    day('Thursday, 5 November 2026', cip('12:00 CET')),
    day('Friday, 6 November 2026', stats),
  );

  it('R1 deleted: the speech becomes CANCELLED (kept, not deleted); the others are untouched', async () => {
    const store = newStore();
    await ingest(store, WEEK);
    const counters = await ingest(
      store,
      page(day('Tuesday, 3 November 2026', lane('10:00 CET')), day('Friday, 6 November 2026', stats)),
    );
    expect(rows(store)).toEqual([
      ['2026-11-03_1000_philip-r-lane', '2026-11-03T09:00:00.000Z', 'SCHEDULED'],
      ['2026-11-05_1200_piero-cipollone', '2026-11-05T11:00:00.000Z', 'CANCELLED'],
    ]);
    expect(counters.details.cancelled_speeches).toEqual(['2026-11-05_1200_piero-cipollone']);
    expect(counters.details.disappeared_scheduled_speeches).toEqual(['2026-11-05_1200_piero-cipollone']);
  });

  it('R2 time changed on the same day: one row, moved (the DB trigger records RESCHEDULED)', async () => {
    const store = newStore();
    await ingest(store, WEEK);
    const moved = page(
      day('Tuesday, 3 November 2026', lane('11:30 CET')),
      day('Thursday, 5 November 2026', cip('12:00 CET')),
    );
    const counters = await ingest(store, moved);
    expect(rows(store)).toEqual([
      ['2026-11-03_1130_philip-r-lane', '2026-11-03T10:30:00.000Z', 'SCHEDULED'],
      ['2026-11-05_1200_piero-cipollone', '2026-11-05T11:00:00.000Z', 'SCHEDULED'],
    ]);
    expect(counters.details.rescheduled_speeches).toEqual([
      { from: '2026-11-03_1000_philip-r-lane', to: '2026-11-03_1130_philip-r-lane' },
    ]);
    expect(counters.details.cancelled_speeches).toBeUndefined();
    // 次の取得(同じページ)では何も変わらない
    const again = await ingest(store, moved);
    expect(store.speeches).toHaveLength(2);
    expect(again.details.disappeared_scheduled_speeches).toBeUndefined();
  });

  it('R2 moved to another day: the old one is CANCELLED and the new one added (not matched across days)', async () => {
    const store = newStore();
    await ingest(store, WEEK);
    await ingest(
      store,
      weekPage(
        day('Wednesday, 4 November 2026', lane('10:00 CET')),
        day('Thursday, 5 November 2026', cip('12:00 CET')),
      ),
    );
    expect(rows(store)).toEqual([
      ['2026-11-03_1000_philip-r-lane', '2026-11-03T09:00:00.000Z', 'CANCELLED'],
      ['2026-11-05_1200_piero-cipollone', '2026-11-05T11:00:00.000Z', 'SCHEDULED'],
      ['2026-11-04_1000_philip-r-lane', '2026-11-04T09:00:00.000Z', 'SCHEDULED'],
    ]);
  });

  it("speaker changed: the old speaker's row is CANCELLED, the new speaker gets a new row", async () => {
    const store = newStore();
    await ingest(store, WEEK);
    const counters = await ingest(
      store,
      page(day('Tuesday, 3 November 2026', lane('10:00 CET')), day('Thursday, 5 November 2026', lane('12:00 CET'))),
    );
    expect(rows(store)).toEqual([
      ['2026-11-03_1000_philip-r-lane', '2026-11-03T09:00:00.000Z', 'SCHEDULED'],
      ['2026-11-05_1200_piero-cipollone', '2026-11-05T11:00:00.000Z', 'CANCELLED'],
      ['2026-11-05_1200_philip-r-lane', '2026-11-05T11:00:00.000Z', 'SCHEDULED'],
    ]);
    expect(counters.details.rescheduled_speeches).toBeUndefined();
  });

  it("ambiguous (two of the speaker's items on the day both changed): cancel + add, never guess a match", async () => {
    const store = newStore();
    await ingest(store, page(day('Tuesday, 3 November 2026', lane('10:00 CET'), lane('15:00 CET', 'Panel'))));
    await ingest(store, page(day('Tuesday, 3 November 2026', lane('11:00 CET'), lane('16:00 CET', 'Panel'))));
    expect(rows(store).map(([, at, status]) => `${at} ${status}`)).toEqual([
      '2026-11-03T09:00:00.000Z CANCELLED',
      '2026-11-03T14:00:00.000Z CANCELLED',
      '2026-11-03T10:00:00.000Z SCHEDULED',
      '2026-11-03T15:00:00.000Z SCHEDULED',
    ]);
  });

  it('re-listed: a CANCELLED speech that comes back on the page is SCHEDULED again (same row)', async () => {
    const store = newStore();
    await ingest(store, WEEK);
    await ingest(store, weekPage(day('Tuesday, 3 November 2026', lane('10:00 CET'))));
    expect(store.speeches.find((row) => row.speaker_id === 'sp-cip')?.status).toBe('CANCELLED');
    await ingest(store, WEEK);
    expect(rows(store)).toEqual([
      ['2026-11-03_1000_philip-r-lane', '2026-11-03T09:00:00.000Z', 'SCHEDULED'],
      ['2026-11-05_1200_piero-cipollone', '2026-11-05T11:00:00.000Z', 'SCHEDULED'],
    ]);
  });

  it('re-listed at the original time after a move: still one row (moved back)', async () => {
    const store = newStore();
    await ingest(store, WEEK);
    await ingest(
      store,
      page(day('Tuesday, 3 November 2026', lane('11:30 CET')), day('Thursday, 5 November 2026', cip('12:00 CET'))),
    );
    await ingest(store, WEEK);
    expect(rows(store)).toEqual([
      ['2026-11-03_1000_philip-r-lane', '2026-11-03T09:00:00.000Z', 'SCHEDULED'],
      ['2026-11-05_1200_piero-cipollone', '2026-11-05T11:00:00.000Z', 'SCHEDULED'],
    ]);
  });

  // HQ判断 2026-10-28「統合前レビュー」A1・A2: 読み切れなかった項目がある日は、削除と読み漏れを区別できない → 中止にせず警告
  describe('partial parse: deleted or unread cannot be told apart → held (warned), never CANCELLED', () => {
    async function expectHeld(changed: string, heldId: string, reason?: string) {
      const store = newStore();
      await ingest(store, WEEK);
      const counters = await ingest(store, changed);
      expect(store.speeches.find((row) => row.provider_event_id === heldId)?.status).toBe('SCHEDULED');
      expect(counters.details.held_disappearances).toEqual([heldId]);
      expect(counters.details.cancelled_speeches).toBeUndefined();
      if (reason) expect(counters.details.cancel_suppressed).toEqual([expect.objectContaining({ reason })]);
      return { store, counters };
    }
    const CIP = '2026-11-05_1200_piero-cipollone';

    it('the time became "to be confirmed" (TIME_MISSING): the old time stays, warned', async () => {
      await expectHeld(
        weekPage(
          day('Tuesday, 3 November 2026', lane('10:00 CET')),
          day('Thursday, 5 November 2026', cip('to be confirmed')),
        ),
        CIP,
      );
    });

    it("one item's Time label is unreadable while the others parse", async () => {
      const broken = cip('12:00 CET').replace('<strong>Time:</strong>', '<strong>Hour:</strong>');
      const { store } = await expectHeld(
        weekPage(day('Tuesday, 3 November 2026', lane('10:00 CET')), day('Thursday, 5 November 2026', broken)),
        CIP,
      );
      expect(store.speeches.find((row) => row.speaker_id === 'sp-lane')?.status).toBe('SCHEDULED');
    });

    it('the "Board member" label is there but the name cannot be read', async () => {
      const broken = cip('12:00 CET').replace('<strong>Board member:</strong>', '<b>Board member:</b>');
      await expectHeld(
        weekPage(day('Tuesday, 3 November 2026', lane('10:00 CET')), day('Thursday, 5 November 2026', broken)),
        CIP,
      );
    });

    it('a new spelling of the name (SPEAKER_UNKNOWN in the pipeline)', async () => {
      const respelled = cip('12:00 CET').replace('Piero Cipollone', 'Piero Cipolone');
      await expectHeld(
        weekPage(day('Tuesday, 3 November 2026', lane('10:00 CET')), day('Thursday, 5 November 2026', respelled)),
        CIP,
      );
    });

    it('the event text now matches a non-public word ("private sector" — maybe a false match)', async () => {
      const privateSector = board('Piero Cipollone', '12:00 CET', 'Speech on private sector investment');
      await expectHeld(
        weekPage(day('Tuesday, 3 November 2026', lane('10:00 CET')), day('Thursday, 5 November 2026', privateSector)),
        CIP,
      );
    });

    it('a Board member item with an unreadable date: the whole page is held (PAGE_ANOMALY)', async () => {
      const store = newStore();
      await ingest(store, WEEK);
      const counters = await ingest(
        store,
        weekPage(day('Tuesday, 3 November 2026', lane('10:00 CET')), day('Jeudi 5 novembre', cip('12:00 CET'))),
      );
      expect(rows(store).map(([, , status]) => status)).toEqual(['SCHEDULED', 'SCHEDULED']);
      expect(counters.details.cancel_suppressed).toEqual([{ reason: 'PAGE_ANOMALY', detail: 'DATE_UNPARSEABLE' }]);
      expect(counters.details.held_disappearances).toEqual([CIP]);
    });

    it('the hold is per day: a speech deleted on a fully-read day is still CANCELLED', async () => {
      const store = newStore();
      await ingest(
        store,
        weekPage(
          day('Tuesday, 3 November 2026', lane('10:00 CET')),
          day('Wednesday, 4 November 2026', schnabel('10:00 CET')),
          day('Thursday, 5 November 2026', cip('12:00 CET')),
        ),
      );
      // 11/3 のレーンは削除(その日は全部読めた)。11/5 はチポローネが時刻なしで読み切れない → 保留
      const counters = await ingest(
        store,
        weekPage(
          day('Wednesday, 4 November 2026', schnabel('10:00 CET')),
          day('Thursday, 5 November 2026', cip('to be confirmed')),
        ),
      );
      expect(counters.details.cancelled_speeches).toEqual(['2026-11-03_1000_philip-r-lane']);
      expect(counters.details.held_disappearances).toEqual([CIP]);
    });

    it("reports the uncertain days from the parser (recorded page: 10/23 summer time, Lagarde's dinner day)", async () => {
      const result = parseEcbWeeklySchedule(await fixture('ecb-weekly-schedule.html'));
      expect(result.pageAnomaly).toBeNull();
      expect(result.uncertainDays).toEqual(
        [...new Set(result.skipped.filter((s) => s.reason !== 'DUPLICATE_ON_PAGE').map((s) => s.day!))].sort(),
      );
      expect(result.uncertainDays).toContain('2026-10-23');
    });
  });

  // A3: 同じ日・同じ話者の別の予定を、日時の変更と取り違えない
  it('A3: same speaker, same day, but another event (title differs) → CANCELLED + new, not a time change', async () => {
    const store = newStore();
    await ingest(store, WEEK);
    const counters = await ingest(
      store,
      weekPage(
        day('Tuesday, 3 November 2026', lane('15:00 CET', 'Panel discussion on payments')),
        day('Thursday, 5 November 2026', cip('12:00 CET')),
      ),
    );
    expect(counters.details.rescheduled_speeches).toBeUndefined();
    expect(rows(store)).toEqual([
      ['2026-11-03_1000_philip-r-lane', '2026-11-03T09:00:00.000Z', 'CANCELLED'],
      ['2026-11-05_1200_piero-cipollone', '2026-11-05T11:00:00.000Z', 'SCHEDULED'],
      ['2026-11-03_1500_philip-r-lane', '2026-11-03T14:00:00.000Z', 'SCHEDULED'],
    ]);
  });

  it('item 3: rows outside the page (past, later weeks) and past rows on the page are never changed', async () => {
    const store = newStore();
    // 前の週(10/30)・ページの中の今より前(11/2 05:00Z)・ページより先(11/12)。10/29 に取り込んだ
    await ingest(
      store,
      page(
        day('Friday, 30 October 2026', lane('17:10 CET')),
        day('Monday, 2 November 2026', schnabel('06:00 CET')),
        day('Thursday, 12 November 2026', cip('12:00 CET')),
      ),
      new Date('2026-10-29T00:00:00Z'),
    );
    const counters = await ingest(
      store,
      page(day('Monday, 2 November 2026', stats), day('Tuesday, 3 November 2026', lane('10:00 CET'))),
    );
    expect(rows(store)).toEqual([
      ['2026-10-30_1710_philip-r-lane', '2026-10-30T16:10:00.000Z', 'SCHEDULED'],
      ['2026-11-02_0600_isabel-schnabel', '2026-11-02T05:00:00.000Z', 'SCHEDULED'],
      ['2026-11-12_1200_piero-cipollone', '2026-11-12T11:00:00.000Z', 'SCHEDULED'],
      ['2026-11-03_1000_philip-r-lane', '2026-11-03T09:00:00.000Z', 'SCHEDULED'],
    ]);
    expect(counters.details.disappeared_scheduled_speeches).toBeUndefined();
    expect(counters.details.cancelled_speeches).toBeUndefined();
  });

  it('R3: the latest speech on the page disappearing is detected (the range runs to the end of the last day)', async () => {
    const store = newStore();
    await ingest(store, WEEK);
    // チポローネ(ページの最後の発言)が消えた。前の判定(最新の発言の時刻まで)では 11/3 までしか見なかった
    const counters = await ingest(
      store,
      page(day('Tuesday, 3 November 2026', lane('10:00 CET')), day('Friday, 6 November 2026', stats)),
    );
    expect(counters.details.cancelled_speeches).toEqual(['2026-11-05_1200_piero-cipollone']);
  });

  it('known limit: a day before the first day on the page is not covered (left as is; R4 warns after 24h)', async () => {
    // ページが先へ進み、11/3 の日付がページから無くなった。11/3 の行は範囲の外なので変えない(誤って中止にしないため)
    const store = newStore();
    await ingest(store, WEEK);
    await ingest(
      store,
      page(day('Wednesday, 4 November 2026', lane('10:00 CET')), day('Thursday, 5 November 2026', cip('12:00 CET'))),
    );
    expect(store.speeches.find((row) => row.provider_event_id === '2026-11-03_1000_philip-r-lane')?.status).toBe(
      'SCHEDULED',
    );
  });

  it('safety valve — 0 items fetched: nothing is changed', async () => {
    const store = newStore();
    await ingest(store, WEEK);
    const counters = await ingest(store, weekPage());
    expect(rows(store).map(([, , status]) => status)).toEqual(['SCHEDULED', 'SCHEDULED']);
    expect(counters.details.cancel_suppressed).toEqual([{ reason: 'NO_ITEMS', disappeared: 2 }]);
  });

  it('safety valve — parse anomaly (the Time label renamed → every item TIME_MISSING): nothing is changed', async () => {
    const store = newStore();
    await ingest(store, WEEK);
    const counters = await ingest(store, WEEK.replace(/<strong>Time:<\/strong>/g, '<strong>Hour:</strong>'));
    expect(rows(store).map(([, , status]) => status)).toEqual(['SCHEDULED', 'SCHEDULED']);
    expect(counters.details.cancel_suppressed).toEqual([{ reason: 'NO_ITEMS', disappeared: 2 }]);
  });

  it('safety valve — an unknown page structure throws before anything is read or written', () => {
    expect(() => parseEcbWeeklySchedule('<html><body>maintenance</body></html>')).toThrow(/structure/);
  });

  it('safety valve — mass disappearance (3 of 4) is not applied; up to 2 always are', async () => {
    const store = newStore();
    await ingest(
      store,
      weekPage(
        day('Tuesday, 3 November 2026', lane('10:00 CET'), cip('15:00 CET')),
        day('Wednesday, 4 November 2026', schnabel('10:00 CET')),
        day('Thursday, 5 November 2026', cip('12:00 CET')),
      ),
    );
    const counters = await ingest(store, weekPage(day('Thursday, 5 November 2026', cip('12:00 CET'))));
    expect(rows(store).every(([, , status]) => status === 'SCHEDULED')).toBe(true);
    expect(counters.details.cancel_suppressed).toEqual([
      { reason: 'MASS_DISAPPEARANCE', disappeared: 3, scheduled: 4 },
    ]);

    const small = newStore();
    await ingest(small, WEEK);
    await ingest(small, weekPage(day('Wednesday, 4 November 2026', schnabel('10:00 CET'))));
    expect(rows(small).map(([id, , status]) => `${id} ${status}`)).toEqual([
      '2026-11-03_1000_philip-r-lane CANCELLED',
      '2026-11-05_1200_piero-cipollone CANCELLED',
      '2026-11-04_1000_isabel-schnabel SCHEDULED',
    ]);
  });

  it('unknown coverage: nothing is changed', async () => {
    const store = newStore();
    await ingest(store, WEEK);
    const { speeches } = parseEcbWeeklySchedule(page(day('Tuesday, 3 November 2026', lane('10:00 CET'))));
    const counters = new JobCounters();
    await ingestSpeeches(
      ECB_WEEKLY_PROVIDER,
      speeches,
      { store, now: () => NOW, reconcile: { coverage: null, timeZone: ECB_TIME_ZONE } },
      counters,
    );
    expect(store.speeches.every((row) => row.status === 'SCHEDULED')).toBe(true);
    expect(counters.details.cancel_suppressed).toEqual([{ reason: 'NO_COVERAGE' }]);
  });

  it('no side effect on other providers: FRB rows in the same period are never changed', async () => {
    const store = newStore();
    store.speeches.push({
      speaker_id: 'sp-lane',
      provider: 'frb_calendar',
      provider_event_id: '2026-11-03_1000_x_speech',
      title: '講演',
      statement_datetime: '2026-11-03T09:00:00.000Z',
      importance: 'HIGH',
      status: 'SCHEDULED',
    });
    await ingest(store, WEEK);
    const counters = await ingest(store, weekPage(day('Thursday, 5 November 2026', cip('12:00 CET'))));
    expect(counters.details.cancelled_speeches).toEqual(['2026-11-03_1000_philip-r-lane']); // ECB の行は中止
    expect(store.speeches.find((row) => row.provider === 'frb_calendar')).toMatchObject({
      provider_event_id: '2026-11-03_1000_x_speech',
      status: 'SCHEDULED',
    });
  });
});
