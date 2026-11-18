/**
 * Speaker name aliases (CODE-REVIEWED CONFIG, data-sources.md §5). Sources
 * write names in English with titles and middle initials ("Governor
 * Christopher J. Waller"); speakers.name is Japanese ("クリストファー・
 * ウォラー"). A speech is ingested only when its speaker resolves through
 * this table to an existing speakers row (organization + name). Unknown
 * names are skipped and logged — never auto-created, because a wrong
 * match would attach a speech (and its FX reaction) to the wrong person.
 *
 * To add a speaker: insert the speakers row (migration, with title and
 * country/currency), then add the alias here.
 */
import type { SpeechKind } from '../types.js';

export interface SpeakerAlias {
  organization: string;
  /** speakers.name (Japanese). */
  nameJa: string;
  /** Name forms used by the sources (compared after normalizeSpeakerName). */
  aliases: readonly string[];
  importance: 'LOW' | 'MEDIUM' | 'HIGH';
}

export const SPEAKER_ALIASES: readonly SpeakerAlias[] = [
  // FRB Board (as of 2026-10-13, assets/speaker-photos/SOURCES.md).
  { organization: 'FRB', nameJa: 'ケビン・ウォーシュ', aliases: ['Kevin Warsh', 'Kevin M. Warsh'], importance: 'HIGH' },
  {
    organization: 'FRB',
    nameJa: 'フィリップ・ジェファーソン',
    aliases: ['Philip N. Jefferson', 'Philip Jefferson'],
    importance: 'MEDIUM',
  },
  {
    organization: 'FRB',
    nameJa: 'ミシェル・ボウマン',
    aliases: ['Michelle W. Bowman', 'Michelle Bowman'],
    importance: 'MEDIUM',
  },
  { organization: 'FRB', nameJa: 'マイケル・バー', aliases: ['Michael S. Barr', 'Michael Barr'], importance: 'MEDIUM' },
  { organization: 'FRB', nameJa: 'リサ・クック', aliases: ['Lisa D. Cook', 'Lisa Cook'], importance: 'MEDIUM' },
  {
    organization: 'FRB',
    nameJa: 'ジェローム・パウエル',
    aliases: ['Jerome H. Powell', 'Jerome Powell'],
    importance: 'MEDIUM',
  },
  {
    organization: 'FRB',
    nameJa: 'クリストファー・ウォラー',
    aliases: ['Christopher J. Waller', 'Christopher Waller'],
    importance: 'MEDIUM',
  },
  // ECB。役員会(Executive Board)の他の役員は HQ判断 2026-10-27(監査で ECB の RSS に出た名前と、
  // シュナーベル)。speakers の行は migration 20261027000005。ECB の発言は、時刻の正確な取得元(週間予定、
  // 設計中)ができるまでは TIME_NOT_EXACT で取り込まれない(この表に足すだけでは件数は増えない)。
  { organization: 'ECB', nameJa: 'クリスティーヌ・ラガルド', aliases: ['Christine Lagarde'], importance: 'HIGH' },
  {
    organization: 'ECB',
    nameJa: 'フィリップ・レーン',
    aliases: ['Philip R. Lane', 'Philip Lane'],
    importance: 'MEDIUM',
  },
  {
    organization: 'ECB',
    nameJa: 'イザベル・シュナーベル',
    aliases: ['Isabel Schnabel'],
    importance: 'MEDIUM',
  },
  {
    organization: 'ECB',
    nameJa: 'ピエロ・チポローネ',
    aliases: ['Piero Cipollone'],
    importance: 'MEDIUM',
  },
  {
    organization: 'ECB',
    nameJa: 'フランク・エルダーソン',
    aliases: ['Frank Elderson'],
    importance: 'MEDIUM',
  },
  // カナダ銀行(BoC)の総裁会議(Governing Council)。公式ページ https://www.bankofcanada.ca/about/governing-council/(2026-11-18 確認。
  // 掲載は 2026-10-12 時点)の6人。総裁 Macklem は 2027-06 に退任の発表(2026-11-16)があるが、現職。日本語の表記は暫定
  // (公式の日本語表記はない。HQ・大野さんの確認が要る)。speakers の行は migration 20261118000001(**未適用**・HQ の承認待ち)。
  { organization: 'BoC', nameJa: 'ティフ・マックレム', aliases: ['Tiff Macklem'], importance: 'HIGH' },
  { organization: 'BoC', nameJa: 'キャロリン・ロジャーズ', aliases: ['Carolyn Rogers'], importance: 'MEDIUM' },
  { organization: 'BoC', nameJa: 'トニ・グラベル', aliases: ['Toni Gravelle'], importance: 'MEDIUM' },
  {
    organization: 'BoC',
    nameJa: 'マルク＝アンドレ・ゴスラン',
    aliases: ['Marc-André Gosselin', 'Marc-Andre Gosselin'],
    importance: 'MEDIUM',
  },
  { organization: 'BoC', nameJa: 'ニコラ・ヴァンサン', aliases: ['Nicolas Vincent'], importance: 'MEDIUM' },
  { organization: 'BoC', nameJa: 'ミシェル・アレクソポロス', aliases: ['Michelle Alexopoulos'], importance: 'MEDIUM' },
  // 豪州準備銀行(RBA)。公式ページ(https://www.rba.gov.au/about-rba/boards/monetary-policy-board/ ・/about-rba/people/…、2026-11-18 確認)で
  // 確認できた3人: 総裁・副総裁(金融政策会合の議長・副議長)・総裁補佐(経済担当。チーフエコノミスト。RSS に実際に出ていた)。
  // 他の総裁補佐・金融政策会合の非常勤メンバーは、氏名を公式ページで確認していないので入れない。
  { organization: 'RBA', nameJa: 'ミシェル・ブロック', aliases: ['Michele Bullock'], importance: 'HIGH' },
  { organization: 'RBA', nameJa: 'アンドリュー・ハウザー', aliases: ['Andrew Hauser'], importance: 'MEDIUM' },
  { organization: 'RBA', nameJa: 'サラ・ハンター', aliases: ['Sarah Hunter'], importance: 'MEDIUM' },
];

/** Lower-case, accents removed, punctuation/whitespace collapsed. */
export function normalizeSpeakerName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Role words sources put before the name ("Vice Chair for Supervision …"). Longest first. */
const ROLE_PREFIXES = [
  'vice chair for supervision',
  'chair pro tempore',
  'vice chairman',
  'vice chair',
  'chairman',
  'chair',
  'governor',
  'president',
];

/** "Vice Chair for Supervision Michelle W. Bowman " → "Michelle W. Bowman". */
export function stripRole(name: string): string {
  const trimmed = name.replace(/\s+/g, ' ').trim();
  const lower = trimmed.toLowerCase();
  for (const prefix of ROLE_PREFIXES) {
    if (lower.startsWith(`${prefix} `)) return trimmed.slice(prefix.length + 1).trim();
  }
  return trimmed;
}

export function findSpeakerAlias(
  organization: string,
  sourceName: string,
  aliases: readonly SpeakerAlias[] = SPEAKER_ALIASES,
): SpeakerAlias | undefined {
  const wanted = normalizeSpeakerName(stripRole(sourceName));
  return aliases.find(
    (alias) =>
      alias.organization === organization && alias.aliases.some((form) => normalizeSpeakerName(form) === wanted),
  );
}

/** Japanese label for speech_events.title (topic itself is kept in the source language — no translation). */
export const SPEECH_KIND_LABEL_JA: Record<SpeechKind, string> = {
  SPEECH: '講演',
  DISCUSSION: '討論',
  TESTIMONY: '議会証言',
  INTERVIEW: 'インタビュー',
  PRESS_CONFERENCE: '記者会見',
  PODCAST: 'ポッドキャスト',
  OTHER: '発言',
};
