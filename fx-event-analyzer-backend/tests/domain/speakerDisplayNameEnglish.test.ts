/**
 * HQ決定 2026-11-18: BoC・RBA の話者名は公式の英語表記(speakers.name)。表示は「姓 + 半角スペース + 役職」(例: Macklem BoC総裁)。
 * 日本語名(FRB・ECB・日銀)の表示は従来どおり。Home(toHomeSpeechItem)とカレンダー更新の通知(calendarUpdateSubject)は同じ関数を使う。
 */
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { attributionForOrganization } from '../../src/domain/attribution.js';
import { calendarUpdateSubject } from '../../src/domain/calendarUpdates.js';
import { speakerDisplayName, toHomeSpeechItem, type HomeSpeechSource } from '../../src/domain/homeSpeeches.js';
import type { NotificationCandidate } from '../../src/domain/notifications.js';
import { SPEAKER_ALIASES, findSpeakerAlias } from '../../src/ingestion/mappings/speakers.js';

const NINE: [string, string, string, string][] = [
  // [organization, 公式の英語名, 役職(日本語)、期待する表示]
  ['BoC', 'Tiff Macklem', 'BoC総裁', 'Macklem BoC総裁'],
  ['BoC', 'Carolyn Rogers', 'BoC上級副総裁', 'Rogers BoC上級副総裁'],
  ['BoC', 'Toni Gravelle', 'BoC副総裁', 'Gravelle BoC副総裁'],
  ['BoC', 'Marc-André Gosselin', 'BoC副総裁', 'Gosselin BoC副総裁'],
  ['BoC', 'Nicolas Vincent', 'BoC副総裁', 'Vincent BoC副総裁'],
  ['BoC', 'Michelle Alexopoulos', 'BoC外部副総裁', 'Alexopoulos BoC外部副総裁'],
  ['RBA', 'Michele Bullock', 'RBA総裁', 'Bullock RBA総裁'],
  ['RBA', 'Andrew Hauser', 'RBA副総裁', 'Hauser RBA副総裁'],
  [
    'RBA',
    'Sarah Hunter',
    'RBA総裁補佐（経済担当・チーフエコノミスト）',
    'Hunter RBA総裁補佐（経済担当・チーフエコノミスト）',
  ],
];

describe('speakerDisplayName: English names', () => {
  it.each(NINE)('%s %s → 姓 + 半角スペース + 役職', (_org, name, title, expected) => {
    expect(speakerDisplayName(name, title)).toBe(expected);
  });

  it('family name = the last word; hyphenated given names / surnames stay one word', () => {
    expect(speakerDisplayName('Marc-André Gosselin', 'BoC副総裁')).toBe('Gosselin BoC副総裁');
    expect(speakerDisplayName('Anne Smith-Jones', 'RBA副総裁')).toBe('Smith-Jones RBA副総裁');
    expect(speakerDisplayName('Jean-Pierre Roy-Martin', 'X')).toBe('Roy-Martin X');
    expect(speakerDisplayName("Aoife O'Brien", 'X')).toBe("O'Brien X");
    expect(speakerDisplayName('  Tiff   Macklem  ', '  BoC総裁  ')).toBe('Macklem BoC総裁');
  });

  it('a trailing suffix (Jr. / Sr. / II / III) is not the family name', () => {
    expect(speakerDisplayName('Martin Luther King Jr.', 'X')).toBe('King X');
    expect(speakerDisplayName('John Smith III', 'X')).toBe('Smith X');
  });

  it('single-word names, empty values and null are handled safely', () => {
    expect(speakerDisplayName('Macklem', 'BoC総裁')).toBe('Macklem BoC総裁');
    expect(speakerDisplayName('Tiff Macklem', '')).toBe('Macklem');
    expect(speakerDisplayName('Tiff Macklem', null)).toBe('Macklem');
    expect(speakerDisplayName('Tiff Macklem', undefined)).toBe('Macklem');
    expect(speakerDisplayName('', 'BoC総裁')).toBe('BoC総裁');
    expect(speakerDisplayName('   ', 'BoC総裁')).toBe('BoC総裁');
    expect(speakerDisplayName(null, 'BoC総裁')).toBe('BoC総裁');
    expect(speakerDisplayName(undefined, null)).toBe('');
    expect(speakerDisplayName('', '')).toBe('');
    expect(speakerDisplayName('Jr.', 'X')).toBe('Jr. X'); // 語が1つだけなら、そのまま(取り除かない)
  });
});

describe('speakerDisplayName: Japanese names are unchanged (FRB / ECB / BoJ)', () => {
  it.each([
    ['ジェローム・パウエル', 'FRB理事', 'パウエルFRB理事'],
    ['クリスティーヌ・ラガルド', 'ECB総裁', 'ラガルドECB総裁'],
    ['植田和男', '日本銀行総裁', '植田和男日本銀行総裁'],
    ['フィリップ・レーン', 'ECB理事（チーフエコノミスト）', 'レーンECB理事（チーフエコノミスト）'],
    ['ジェローム･パウエル', 'FRB理事', 'パウエルFRB理事'], // 半角の中点
    ['ジェローム・', 'FRB理事', 'ジェローム・FRB理事'], // 末尾の中点は区切りにしない(従来どおり)
  ])('%s + %s → %s', (name, title, expected) => {
    expect(speakerDisplayName(name, title)).toBe(expected);
  });

  it('a mixed name (Japanese + Latin) keeps the existing Japanese rule', () => {
    expect(speakerDisplayName('ティフ・Macklem', 'BoC総裁')).toBe('MacklemBoC総裁');
  });
});

describe('Home and the calendar-update notification show the same text', () => {
  it.each(NINE)('%s %s', (organization, name, title, expected) => {
    const source: HomeSpeechSource = {
      speech_id: '50000000-0000-0000-0000-000000000001',
      title: 't',
      summary: null,
      statement_datetime: '2026-11-17T10:00:00+00:00',
      speaker: { name, title, organization, country_code: organization === 'BoC' ? 'CA' : 'AU' },
    };
    const home = toHomeSpeechItem(source, 'https://api.example.com').speaker_name;
    const notification = calendarUpdateSubject({
      kind: 'SPEECH',
      speaker_name: name,
      speaker_title: title,
    } as unknown as NotificationCandidate);
    expect(home).toBe(expected);
    expect(notification).toBe(home);
  });

  it('existing FRB / ECB: both surfaces still show 姓 + 役職 as before', () => {
    const source: HomeSpeechSource = {
      speech_id: '50000000-0000-0000-0000-000000000002',
      title: 't',
      summary: null,
      statement_datetime: '2026-11-17T10:00:00+00:00',
      speaker: { name: 'ジェローム・パウエル', title: 'FRB理事', organization: 'FRB', country_code: 'US' },
    };
    expect(toHomeSpeechItem(source, 'https://api.example.com').speaker_name).toBe('パウエルFRB理事');
    expect(
      calendarUpdateSubject({
        kind: 'SPEECH',
        speaker_name: 'ジェローム・パウエル',
        speaker_title: 'FRB理事',
      } as unknown as NotificationCandidate),
    ).toBe('パウエルFRB理事');
  });
});

describe('speaker definitions: English names are the key, with no duplicate registration', () => {
  const bocRba = SPEAKER_ALIASES.filter((a) => a.organization === 'BoC' || a.organization === 'RBA');

  it('the 9 names are exactly the official English names, and each resolves from its source spelling', () => {
    expect(bocRba.map((a) => a.name)).toEqual(NINE.map(([, name]) => name));
    for (const [organization, name] of NINE) {
      expect(findSpeakerAlias(organization, name, SPEAKER_ALIASES)?.name).toBe(name);
      expect(findSpeakerAlias(organization, `Governor ${name}`, SPEAKER_ALIASES)?.name).toBe(name);
    }
    // アクセントなしの綴りでも同じ話者に解決する(新しい話者を作らない)
    expect(findSpeakerAlias('BoC', 'Marc-Andre Gosselin', SPEAKER_ALIASES)?.name).toBe('Marc-André Gosselin');
  });

  it('no duplicate (organization, name) in the table, and the migration inserts each name exactly once', async () => {
    const keys = SPEAKER_ALIASES.map((a) => `${a.organization}|${a.name}`);
    expect(new Set(keys).size).toBe(keys.length);
    const sql = await readFile(
      new URL('../../supabase/migrations/20261118000004_boc_rba_speakers.sql', import.meta.url),
      'utf8',
    );
    for (const [organization, name, title] of NINE) {
      const row = new RegExp(`\\('${name}', '${title.replace(/[（）]/g, '.')}', '${organization}',`, 'u');
      expect(sql.match(row)).not.toBeNull();
      expect(sql.split(`('${name}',`).length - 1).toBe(1);
    }
    // 重複登録の防止(2回流しても増えない)
    expect(sql).toContain(
      'where not exists (select 1 from speakers s where s.organization = v.organization and s.name = v.name)',
    );
  });

  it('FRB / ECB entries keep their Japanese names (no change)', () => {
    expect(findSpeakerAlias('FRB', 'Jerome H. Powell', SPEAKER_ALIASES)?.name).toBe('ジェローム・パウエル');
    expect(findSpeakerAlias('ECB', 'Christine Lagarde', SPEAKER_ALIASES)?.name).toBe('クリスティーヌ・ラガルド');
    expect(attributionForOrganization('BoC')).not.toBeNull();
  });
});
