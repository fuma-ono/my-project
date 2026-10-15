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
  /** Speech-type entries that could not be used (no exact time, multi-day, unparseable title). */
  skipped: { title: string; reason: string }[];
}

export function parseFrbCalendar(body: unknown): FrbParseResult {
  const parsed = calendarSchema.parse(body);
  const speeches: NormalizedSpeech[] = [];
  const skipped: FrbParseResult['skipped'] = [];
  for (const event of parsed.events) {
    if (!event.type || !SPEECH_TYPES.has(event.type)) continue;
    const title = decodeEntities(event.title ?? '').trim();
    const split = /^(.*?)\s*[-–—]{1,2}\s*(.+)$/.exec(title);
    if (!split) {
      skipped.push({ title, reason: 'TITLE_UNPARSEABLE' });
      continue;
    }
    const kindLabel = split[1]!.trim();
    const speakerName = stripRole(split[2]!);
    const month = /^(\d{4})-(\d{2})$/.exec(event.month ?? '');
    const day = /^\d{1,2}$/.test((event.days ?? '').trim()) ? Number(event.days) : null;
    const time = parseFrbTime(event.time ?? '');
    if (!month || day === null) {
      skipped.push({ title, reason: 'DATE_NOT_SINGLE_DAY' });
      continue;
    }
    if (!time) {
      skipped.push({ title, reason: 'TIME_MISSING' });
      continue;
    }
    const startsAt = zonedWallTimeToUtc(Number(month[1]), Number(month[2]), day, time.hour, time.minute, FRB_TIME_ZONE);
    if (!startsAt) {
      skipped.push({ title, reason: 'TIME_NONEXISTENT' });
      continue;
    }
    const kind = kindOf(kindLabel);
    const date = `${month[1]}-${month[2]}-${String(day).padStart(2, '0')}`;
    const hhmm = `${String(time.hour).padStart(2, '0')}${String(time.minute).padStart(2, '0')}`;
    const slug = normalizeSpeakerName(speakerName).replace(/ /g, '-');
    const topic = decodeEntities(event.description ?? '').trim();
    speeches.push({
      provider: FRB_PROVIDER,
      providerEventId: `${date}_${hhmm}_${slug}_${kind.toLowerCase()}`,
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
