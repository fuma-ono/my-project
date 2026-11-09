/**
 * HQ判断 2026-10-27: FOMC の記者会見を要人発言として取り込む / ECB の役員を話者に登録する。
 */
import { describe, expect, it } from 'vitest';
import { parseEcbPressRss } from '../../src/ingestion/adapters/ecbPress.js';
import { FOMC_PRESS_CONFERENCE_SPEAKER, parseFrbCalendar } from '../../src/ingestion/adapters/frbCalendar.js';
import { findSpeakerAlias, SPEAKER_ALIASES } from '../../src/ingestion/mappings/speakers.js';
import { ingestSpeeches, speechTitle } from '../../src/ingestion/pipelines/speeches.js';
import { JobCounters } from '../../src/ingestion/runner.js';
import { fixture, MemoryIngestionStore } from '../helpers/memoryIngestionStore.js';

/** The calendar.json entries of an FOMC meeting day (shape recorded 2026-10-26). */
function fomcDay(month: string, days: string) {
  return [
    { title: 'FOMC Meeting', time: '2:00 p.m.', month, days, type: 'FOMC' },
    { title: 'FOMC Press Conference', time: '2:30 p.m.', month, days, type: 'FOMC' },
  ];
}

describe('FOMC press conference (calendar.json type "FOMC")', () => {
  const body = {
    events: [
      ...fomcDay('2026-10', '28'),
      ...fomcDay('2026-12', '9'),
      { title: 'FOMC Minutes', time: '2:00 p.m.', month: '2026-11', days: '18', type: 'FOMC' },
      {
        title: 'Speech - Governor Christopher J. Waller',
        time: '10:00 a.m.',
        month: '2026-10',
        days: '1',
        type: 'Speeches',
      },
    ],
  };

  it('takes only the press conference (not the meeting / minutes, which are indicator events)', () => {
    const { speeches, skipped } = parseFrbCalendar(body);
    const press = speeches.filter((s) => s.kind === 'PRESS_CONFERENCE');
    expect(press.map((s) => s.startsAt)).toEqual([
      '2026-10-28T18:30:00.000Z', // 2:30 p.m. EDT (UTC−4)
      '2026-12-09T19:30:00.000Z', // 2:30 p.m. EST (UTC−5、米国は 11/1 に標準時)
    ]);
    expect(speeches.filter((s) => s.kind !== 'PRESS_CONFERENCE').map((s) => s.speakerName)).toEqual([
      'Christopher J. Waller',
    ]);
    expect(skipped).toEqual([]);
  });

  it('attributes it to the FRB chair, with its own id, title and timePrecision EXACT', () => {
    const press = parseFrbCalendar(body).speeches.find((s) => s.kind === 'PRESS_CONFERENCE')!;
    expect(press).toMatchObject({
      provider: 'frb_calendar',
      providerEventId: '2026-10-28_1430_kevin-warsh_press_conference',
      speakerName: FOMC_PRESS_CONFERENCE_SPEAKER,
      organization: 'FRB',
      topic: 'FOMC',
      timePrecision: 'EXACT',
    });
    expect(speechTitle(press)).toBe('記者会見: FOMC');
    expect(findSpeakerAlias('FRB', press.speakerName, SPEAKER_ALIASES)?.nameJa).toBe('ケビン・ウォーシュ');
  });

  it('ingests it as the chair speech (HIGH) once, and a rerun does not duplicate it', async () => {
    const store = new MemoryIngestionStore();
    store.speakers = [{ id: 'sp-warsh', name: 'ケビン・ウォーシュ', organization: 'FRB' }];
    const now = () => new Date('2026-10-27T12:00:00Z');
    const { speeches } = parseFrbCalendar(body);
    await ingestSpeeches('frb_calendar', speeches, { store, now }, new JobCounters());
    await ingestSpeeches('frb_calendar', speeches, { store, now }, new JobCounters());
    const rows = store.speeches.filter((s) => s.title === '記者会見: FOMC');
    expect(rows.map((r) => [r.statement_datetime, r.importance, r.status])).toEqual([
      ['2026-10-28T18:30:00.000Z', 'HIGH', 'SCHEDULED'],
      ['2026-12-09T19:30:00.000Z', 'HIGH', 'SCHEDULED'],
    ]);
  });
});

describe('ECB Executive Board speakers', () => {
  it.each([
    ['Philip R. Lane', 'フィリップ・レーン'],
    ['Isabel Schnabel', 'イザベル・シュナーベル'],
    ['Piero Cipollone', 'ピエロ・チポローネ'],
    ['Frank Elderson', 'フランク・エルダーソン'],
    ['Christine Lagarde', 'クリスティーヌ・ラガルド'],
  ])('resolves "%s" to %s (MEDIUM except Lagarde)', (name, nameJa) => {
    const alias = findSpeakerAlias('ECB', name, SPEAKER_ALIASES);
    expect(alias?.nameJa).toBe(nameJa);
    expect(alias?.importance).toBe(nameJa === 'クリスティーヌ・ラガルド' ? 'HIGH' : 'MEDIUM');
  });

  it('still skips ECB RSS items as TIME_NOT_EXACT (publication time is never used as the speech time)', async () => {
    const store = new MemoryIngestionStore();
    const speeches = parseEcbPressRss(await fixture('ecb-press-rss.xml'));
    const counters = new JobCounters();
    await ingestSpeeches(
      'ecb_press_rss',
      speeches,
      { store, now: () => new Date('2026-10-15T12:00:00Z'), pastDays: 3650 },
      counters,
    );
    expect(store.speeches).toEqual([]);
    expect(Object.keys(counters.skipReasons)).toEqual(['TIME_NOT_EXACT']);
  });
});
