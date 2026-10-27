/**
 * ECB "Weekly schedule of public speaking engagements and other activities" — ④ ECB の要人発言の予定
 * (HQ判断 2026-10-27「ECB発言の取り込み方式: 案A」)。
 * https://www.ecb.europa.eu/press/calendars/weekly/html/index.en.html
 *
 * 形(2026-10-27 に取得して確認): `<dl>` の中に `<dt>Friday, 23 October 2026</dt>` と
 * `<dd><strong>Board member:</strong> Piero Cipollone<br> <strong>Event:</strong> … <br>
 *  <strong>Time:</strong> 16:00 CET<br> <strong>Venue:</strong> …</dd>` が並ぶ。約1週間分だけで、先・過去の週は無い。
 * 統計の公表・理事会の項目には Board member が無い(ここでは取らない。金融政策は告知の方針の後、別の経路)。
 *
 * 時刻: 「HH:MM CET」(海外は「17:10 CET/09:10 local time」)。フランクフルトの現地時刻(Europe/Berlin)として UTC に直す。
 * 冬時間(CET = UTC+1)は、現地時刻の併記(サンフランシスコ・エレバン)で検算して合うことを確かめた。
 * **夏時間の期間に書かれる「CET」が CEST(UTC+2)の意味かは、公式の情報で確かめられていない**(過去の週の
 * ページが無い)。そのため、Europe/Berlin が夏時間の日の項目は取り込まない(lastSkipped に SUMMER_TIME_UNVERIFIED)。
 * 確かめたら ECB_SUMMER_TIME_VERIFIED を true にする。時刻の正確さが確かめられない項目を、相場反応の計算に入れないため。
 *
 * 取り込まない項目(lastSkipped に理由を残す): Board member の無い項目は数えない。非公開・発言の無い予定
 * (dinner・lunch・meeting with・bilateral 等)、時刻の無い項目、読めない日付。
 * ページの形が変わって項目が1つも読めないときは、0件として静かに終わらず、エラーにする(ジョブの記録で分かる)。
 *
 * 利用条件: ECB のサイトの情報(data-sources.md §2)。出典の表示と、有料サービスでの告知が必要。告知の方針が
 * 決まるまで公開に使わない(ジョブでは環境変数 INGEST_ECB_WEEKLY=1 のときだけ動く)。
 */
import { PROVIDER_HTTP_SETTINGS } from '../config.js';
import { HttpClient, type HttpClientDeps } from '../http.js';
import { normalizeSpeakerName } from '../mappings/speakers.js';
import type { SpeechScheduleProvider } from '../providers.js';
import { zonedWallTimeToUtc } from '../time.js';
import type { NormalizedSpeech, SpeechKind } from '../types.js';

export const ECB_WEEKLY_URL = 'https://www.ecb.europa.eu/press/calendars/weekly/html/index.en.html';
export const ECB_WEEKLY_PROVIDER = 'ecb_weekly_schedule';
const ECB_TIME_ZONE = 'Europe/Berlin';
/** 夏時間の期間の「CET」の意味を公式の情報で確かめたら true にする(上の説明)。 */
export const ECB_SUMMER_TIME_VERIFIED = false;

const MONTHS: Record<string, number> = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
};

/** Not a public appearance with something said — kept out (and logged). */
const NOT_PUBLIC = /\b(dinner|lunch|breakfast|meeting with|meetings with|bilateral|closed[- ]door|private)\b/i;

function decode(text: string): string {
  return text
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&([a-z])(acute|grave|uml|circ|tilde|caron|cedil|ring);/gi, '$1')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The value after `<strong>Label:</strong>` up to the next `<br>` / `<strong>` / end, decoded. */
function field(dd: string, label: string): string | null {
  const match = new RegExp(`<strong>\\s*${label}:\\s*</strong>([\\s\\S]*?)(?:<br\\s*/?>|<strong>|<small>|$)`, 'i').exec(
    dd,
  );
  if (!match) return null;
  const value = decode(match[1]!);
  return value === '' ? null : value;
}

/** "Friday, 23 October 2026" → [2026, 10, 23]. */
export function parseEcbDate(text: string): [number, number, number] | null {
  const match = /(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/.exec(decode(text));
  if (!match) return null;
  const month = MONTHS[match[2]!.toLowerCase()];
  if (!month) return null;
  return [Number(match[3]), month, Number(match[1])];
}

/** "16:00 CET", "06:00 CET / 9:00 local time", "17:10 CET/09:10 local time" → the CET wall time. */
export function parseEcbTime(text: string): { hour: number; minute: number } | null {
  const match = /^(\d{1,2})[:.](\d{2})\s*CET\b/i.exec(text.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

function kindOf(event: string): SpeechKind {
  const lower = event.toLowerCase();
  if (lower.includes('press conference')) return 'PRESS_CONFERENCE';
  if (lower.includes('hearing') || lower.includes('testimony')) return 'TESTIMONY';
  if (lower.includes('interview')) return 'INTERVIEW';
  if (/fireside|panel|discussion|dialogue|conversation|participation/.test(lower)) return 'DISCUSSION';
  if (/speech|keynote|remarks|address|lecture|statement/.test(lower)) return 'SPEECH';
  return 'OTHER';
}

/** UTC offset (minutes) of Europe/Berlin at that wall time: 60 = CET, 120 = CEST. */
function berlinOffsetMinutes(
  utc: Date,
  wall: { y: number; m: number; d: number; hour: number; minute: number },
): number {
  return Math.round((Date.UTC(wall.y, wall.m - 1, wall.d, wall.hour, wall.minute) - utc.getTime()) / 60_000);
}

export interface EcbWeeklyParseResult {
  speeches: NormalizedSpeech[];
  skipped: { title: string; reason: string }[];
  /** All dt/dd entries on the page (with or without a Board member). 0 = the structure is not what we know. */
  entries: number;
}

export function parseEcbWeeklySchedule(
  html: string,
  options: { summerTimeVerified?: boolean } = {},
): EcbWeeklyParseResult {
  const summerTimeVerified = options.summerTimeVerified ?? ECB_SUMMER_TIME_VERIFIED;
  const speeches: NormalizedSpeech[] = [];
  const skipped: EcbWeeklyParseResult['skipped'] = [];
  const pairs = [...html.matchAll(/<dt>([\s\S]*?)<\/dt>\s*<dd>([\s\S]*?)<\/dd>/gi)];
  if (pairs.length === 0) {
    throw new Error('ECB weekly schedule: no <dt>/<dd> entries found — the page structure may have changed');
  }
  const seen = new Set<string>();
  for (const [, dt, dd] of pairs) {
    const speaker = field(dd!, 'Board member');
    if (!speaker) continue; // 統計の公表・理事会など(役員の発言ではない)
    const event = field(dd!, 'Event') ?? '';
    const title = `${speaker}: ${event}`.slice(0, 200);
    if (NOT_PUBLIC.test(event)) {
      skipped.push({ title, reason: 'NOT_PUBLIC' });
      continue;
    }
    const date = parseEcbDate(dt!);
    if (!date) {
      skipped.push({ title, reason: 'DATE_UNPARSEABLE' });
      continue;
    }
    const time = parseEcbTime(field(dd!, 'Time') ?? '');
    if (!time) {
      skipped.push({ title, reason: 'TIME_MISSING' });
      continue;
    }
    const [y, m, d] = date;
    const startsAt = zonedWallTimeToUtc(y, m, d, time.hour, time.minute, ECB_TIME_ZONE);
    if (!startsAt) {
      skipped.push({ title, reason: 'TIME_NONEXISTENT' });
      continue;
    }
    if (
      berlinOffsetMinutes(startsAt, { y, m, d, hour: time.hour, minute: time.minute }) !== 60 &&
      !summerTimeVerified
    ) {
      skipped.push({ title, reason: 'SUMMER_TIME_UNVERIFIED' });
      continue;
    }
    const ymd = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const hhmm = `${String(time.hour).padStart(2, '0')}${String(time.minute).padStart(2, '0')}`;
    const id = `${ymd}_${hhmm}_${normalizeSpeakerName(speaker).replace(/ /g, '-')}`;
    if (seen.has(id)) {
      skipped.push({ title, reason: 'DUPLICATE_ON_PAGE' });
      continue;
    }
    seen.add(id);
    speeches.push({
      provider: ECB_WEEKLY_PROVIDER,
      providerEventId: id,
      speakerName: speaker,
      organization: 'ECB',
      kind: kindOf(event),
      topic: event === '' ? null : event.slice(0, 300),
      startsAt: startsAt.toISOString(),
      timePrecision: 'EXACT',
      url: ECB_WEEKLY_URL,
    });
  }
  return { speeches, skipped, entries: pairs.length };
}

export class EcbWeeklyScheduleAdapter implements SpeechScheduleProvider {
  readonly name = ECB_WEEKLY_PROVIDER;
  private readonly http: HttpClient;
  lastSkipped: EcbWeeklyParseResult['skipped'] = [];

  constructor(deps: HttpClientDeps = {}) {
    this.http = new HttpClient('ecb', PROVIDER_HTTP_SETTINGS.ecb, deps);
  }

  async fetchSpeeches(): Promise<NormalizedSpeech[]> {
    const result = parseEcbWeeklySchedule(await this.http.getText(ECB_WEEKLY_URL));
    this.lastSkipped = result.skipped;
    return result.speeches;
  }
}
