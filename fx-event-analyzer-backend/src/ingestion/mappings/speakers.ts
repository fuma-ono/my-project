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
  // ECB
  { organization: 'ECB', nameJa: 'クリスティーヌ・ラガルド', aliases: ['Christine Lagarde'], importance: 'HIGH' },
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
  OTHER: '発言',
};
