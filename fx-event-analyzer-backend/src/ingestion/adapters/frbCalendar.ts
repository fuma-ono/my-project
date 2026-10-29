/**
 * Federal Reserve Board calendar — ④ speech schedule source.
 * https://www.federalreserve.gov/json/calendar.json (the data behind
 * https://www.federalreserve.gov/newsevents/calendar.htm).
 *
 * Shape (recorded 2026-10-15): { events: [{ title: "Speech - Governor
 * Christopher J. Waller", description: "Economic Outlook", location,
 * time: "10:00 a.m.", month: "2026-10", days: "1", type: "Speeches", … }] }
 * Times are US Eastern (cross-checked against the speeches RSS pubDate in
 * GMT: "10:55 p.m." on 10/14 ⇔ "Thu, 15 Oct 2026 02:55:00 GMT").
 * The feed has no event id, so one is derived from date + speaker + kind +
 * time; a time change therefore looks like a new event (the old one is
 * logged as disappeared — see pipelines/speeches.ts).
 *
 * Terms: federalreserve.gov content is public domain unless marked;
 * cite the Board as the source; framing not allowed (data-sources.md §2).
 *
 * 読めない項目(HQ判断 2026-10-29 R-1・R-2): `skipped` には題名(200文字まで)・理由・現地の日付(YYYY-MM-DD)
 * だけを入れる(本文・会場・連絡先は入れない)。取り込みの期間(既定は直近14日、pipelines/speeches.ts の pastDays と同じ)
 * より古い項目で題名が読めないものは、題名の解析の前に期間の外(OUTSIDE_WINDOW)として数える
 * (例: 2018-10-18 の "Vice Chairman Randal K. Quarles" — 種別の区切りの無い題名。今の取りこぼしではない)。
 * 古くても題名が読める項目は今までどおり返し、パイプラインが期間の外として数える(取得件数・鮮度の判定は変えない)。
 */
import { z } from 'zod';
import { PROVIDER_HTTP_SETTINGS } from '../config.js';
import { HttpClient, type HttpClientDeps } from '../http.js';
import { normalizeSpeakerName, stripRole } from '../mappings/speakers.js';
import type { SpeechScheduleProvider } from '../providers.js';
import { zonedWallTimeToUtc } from '../time.js';
import type { NormalizedSpeech, SpeechKind } from '../types.js';

export const FRB_CALENDAR_URL = 'https://www.federalreserve.gov/json/calendar.json';
const FRB_TIME_ZONE = 'America/New_York';
export const FRB_PROVIDER = 'frb_calendar';
/** 記録に残す題名の長さの上限(R-1)。 */
export const FRB_SKIP_TITLE_MAX = 200;
/** 取り込みの期間(日)。pipelines/speeches.ts の pastDays の既定値と同じ。 */
const FRB_INGEST_PAST_DAYS = 14;

const calendarSchema = z.object({
  events: z.array(
    z
      .object({
        title: z.string().optional(),
        description: z.string().optional(),
        time: z.string().optional(),
        month: z.string().optional(),
        days: z.string().optional(),
        type: z.string().optional(),
      })
      .passthrough(),
  ),
});

const SPEECH_TYPES = new Set(['Speeches', 'Testimony']);

/**
 * FOMC の記者会見(HQ判断 2026-10-27「FOMC記者会見の取り込み」)。calendar.json では type "FOMC"・
 * title "FOMC Press Conference"(会合の2日目 2:30 p.m.)で載る。題名に話者の名前が無いので、会見をする
 * FRB 議長をこの設定で決める(**議長が替わったら直す**。2026-10-27 時点: ケビン・ウォーシュ —
 * calendar.json の 10/15 の "Discussion - Chairman Kevin Warsh")。type "FOMC" の他の項目
 * ("FOMC Meeting" = 政策の発表、"FOMC Minutes" = 議事要旨)は、経済指標の側(fomcSchedule.ts、
 * US_FOMC・US_FOMC_MINUTES)で扱うので、ここでは今までどおり取り込まない。
 */
export const FOMC_PRESS_CONFERENCE_SPEAKER = 'Kevin Warsh';
const FOMC_PRESS_CONFERENCE_TITLE = /^FOMC Press Conference$/i;

function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&uuml;/g, 'ü')
    .replace(/&nbsp;/g, ' ');
}

function kindOf(label: string): SpeechKind {
  const lower = label.toLowerCase();
  if (lower.includes('testimony')) return 'TESTIMONY';
  if (lower.includes('discussion') || lower.includes('panel') || lower.includes('remarks and discussion'))
    return 'DISCUSSION';
  if (lower.includes('speech') || lower.includes('remarks')) return 'SPEECH';
  return 'OTHER';
}

/** "10:55 p.m." → { hour: 22, minute: 55 }; anything else → null. */
export function parseFrbTime(value: string): { hour: number; minute: number } | null {
  const match = /^(\d{1,2}):(\d{2})\s*([ap])\.?\s*m\.?$/i.exec(value.trim());
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 1 || hour > 12 || minute > 59) return null;
  const pm = match[3]!.toLowerCase() === 'p';
  if (hour === 12) hour = pm ? 12 : 0;
  else if (pm) hour += 12;
  return { hour, minute };
}

export interface FrbParseResult {
  speeches: NormalizedSpeech[];
  /**
   * Speech-type entries that could not be used (no exact time, multi-day, unparseable title).
   * title は200文字まで。date = 現地(ニューヨーク)の日付 YYYY-MM-DD(読めたときだけ)。
   */
  skipped: { title: string; reason: string; date?: string }[];
}

/** "2026-10", "18" → "2026-10-18"(読めなければ null)。 */
function localDate(month: string | undefined, days: string | undefined): string | null {
  const m = /^(\d{4})-(\d{2})$/.exec(month ?? '');
  const d = (days ?? '').trim();
  if (!m || !/^\d{1,2}$/.test(d)) return null;
  return `${m[1]}-${m[2]}-${d.padStart(2, '0')}`;
}

/** その現地の日付が、取り込みの期間(now − pastDays)より確実に前に終わっているか(ニューヨークの時差の分の余裕を見る)。 */
function endsBeforeWindow(date: string, now: Date, pastDays: number): boolean {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const endOfLocalDayUtc = Date.UTC(y, m - 1, d + 1) + 5 * 3_600_000; // EST(UTC−5)の 24:00 = 翌日 05:00Z
  return endOfLocalDayUtc <= now.getTime() - pastDays * 86_400_000;
}

export function parseFrbCalendar(body: unknown, options: { now?: Date; pastDays?: number } = {}): FrbParseResult {
  const now = options.now ?? new Date();
  const pastDays = options.pastDays ?? FRB_INGEST_PAST_DAYS;
  const parsed = calendarSchema.parse(body);
  const speeches: NormalizedSpeech[] = [];
  const skipped: FrbParseResult['skipped'] = [];
  for (const event of parsed.events) {
    const title = decodeEntities(event.title ?? '').trim();
    const pressConference = event.type === 'FOMC' && FOMC_PRESS_CONFERENCE_TITLE.test(title);
    if (!pressConference && (!event.type || !SPEECH_TYPES.has(event.type))) continue;
    const date = localDate(event.month, event.days);
    const skip = (reason: string) =>
      skipped.push({ title: title.slice(0, FRB_SKIP_TITLE_MAX), reason, ...(date ? { date } : {}) });
    const split = pressConference ? null : /^(.*?)\s*[-–—]{1,2}\s*(.+)$/.exec(title);
    if (!pressConference && !split) {
      // R-2: 取り込みの期間より古い項目は、題名が読めなくても「期間の外」(取りこぼしではない)
      skip(date && endsBeforeWindow(date, now, pastDays) ? 'OUTSIDE_WINDOW' : 'TITLE_UNPARSEABLE');
      continue;
    }
    const kindLabel = pressConference ? 'press conference' : split![1]!.trim();
    const speakerName = pressConference ? FOMC_PRESS_CONFERENCE_SPEAKER : stripRole(split![2]!);
    const month = /^(\d{4})-(\d{2})$/.exec(event.month ?? '');
    const day = /^\d{1,2}$/.test((event.days ?? '').trim()) ? Number(event.days) : null;
    const time = parseFrbTime(event.time ?? '');
    if (!month || day === null) {
      skip('DATE_NOT_SINGLE_DAY');
      continue;
    }
    if (!time) {
      skip('TIME_MISSING');
      continue;
    }
    const startsAt = zonedWallTimeToUtc(Number(month[1]), Number(month[2]), day, time.hour, time.minute, FRB_TIME_ZONE);
    if (!startsAt) {
      skip('TIME_NONEXISTENT');
      continue;
    }
    const kind: SpeechKind = pressConference ? 'PRESS_CONFERENCE' : kindOf(kindLabel);
    const ymd = `${month[1]}-${month[2]}-${String(day).padStart(2, '0')}`;
    const hhmm = `${String(time.hour).padStart(2, '0')}${String(time.minute).padStart(2, '0')}`;
    const slug = normalizeSpeakerName(speakerName).replace(/ /g, '-');
    const topic = pressConference ? 'FOMC' : decodeEntities(event.description ?? '').trim();
    speeches.push({
      provider: FRB_PROVIDER,
      providerEventId: `${ymd}_${hhmm}_${slug}_${kind.toLowerCase()}`,
      speakerName,
      organization: 'FRB',
      kind,
      topic: topic === '' ? null : topic,
      startsAt: startsAt.toISOString(),
      timePrecision: 'EXACT',
      url: 'https://www.federalreserve.gov/newsevents/calendar.htm',
    });
  }
  return { speeches, skipped };
}

/** 記録に残す件数の上限(R-1)。 */
export const FRB_SKIP_LOG_LIMIT = 20;

/**
 * ingestion_logs.details.feed_skipped に残す FRB の読めない項目(R-1)。期間の外(OUTSIDE_WINDOW)は残さない
 * (取りこぼしではないため)。最大 FRB_SKIP_LOG_LIMIT 件。中身は題名(200文字まで)・理由・日付だけ。
 */
export function frbSkipLogEntries(skipped: FrbParseResult['skipped']): FrbParseResult['skipped'] {
  return skipped.filter((item) => item.reason !== 'OUTSIDE_WINDOW').slice(0, FRB_SKIP_LOG_LIMIT);
}

export class FrbCalendarAdapter implements SpeechScheduleProvider {
  readonly name = FRB_PROVIDER;
  private readonly http: HttpClient;
  lastSkipped: FrbParseResult['skipped'] = [];

  constructor(deps: HttpClientDeps = {}) {
    this.http = new HttpClient('frb', PROVIDER_HTTP_SETTINGS.frb, deps);
  }

  async fetchSpeeches(): Promise<NormalizedSpeech[]> {
    const result = parseFrbCalendar(await this.http.getJson(FRB_CALENDAR_URL));
    this.lastSkipped = result.skipped;
    return result.speeches;
  }
}
