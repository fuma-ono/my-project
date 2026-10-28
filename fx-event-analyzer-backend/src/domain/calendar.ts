/**
 * SCR-010 経済指標カレンダー (GET /calendar, api-design.md §14.6). Merges
 * economic indicator events and VIP speeches in a range into one list the
 * client lays out as a month grid (importance dots) and a per-day list.
 *
 * Labels match GET /notifications/upcoming: an indicator row's title is
 * the indicator name, a speech row's title is the speech's own title with
 * the speaker's display name alongside in `speaker_name`.
 */
import { attributionForOrganization, type Attribution } from './attribution.js';
import { effectiveIsProvisional } from './provisional.js';

export type CalendarItemKind = 'INDICATOR' | 'SPEECH';

export interface CalendarItem {
  kind: CalendarItemKind;
  /** event_id (INDICATOR) or speech_id (SPEECH). */
  id: string;
  /** INDICATOR: the event's indicator_id (opens SCR-006 指標詳細). SPEECH: always null. */
  indicator_id: string | null;
  title: string;
  /** INDICATOR: the indicator's 一覧画面の表示名 (null when not registered). SPEECH: always null. */
  display_name: string | null;
  /** SPEECH only. */
  speaker_name: string | null;
  /** SPEECH only: the speaker's official photo URL (absolute) or null (initials). INDICATOR: always null. */
  speaker_photo_url: string | null;
  country_code: string;
  currency_code: string;
  importance: string;
  /** release_datetime (INDICATOR) / statement_datetime (SPEECH). */
  datetime: string;
  /** INDICATOR: release_datetime_precision. SPEECH: always EXACT. */
  datetime_precision: string;
  status: string;
  /**
   * INDICATOR: economic_events.is_provisional — the scheduled datetime is not yet
   * officially confirmed (the app shows 「予定（暫定）」). true only while the
   * datetime is still in the future (domain/provisional.ts). SPEECH: always false.
   */
  is_provisional: boolean;
  /** 出典と告知(api-design v1.38)。SPEECH: 要人の機関(ECB・FRB)から。INDICATOR: 今は常に null。 */
  attribution: Attribution | null;
}

export interface CalendarIndicatorEvent {
  id: string;
  indicator_id: string;
  indicator_name: string;
  indicator_display_name?: string | null | undefined;
  country_code: string;
  currency_code: string;
  importance: string;
  release_datetime: string;
  release_datetime_precision: string;
  status: string;
  /** Absent = false (rows read before migration 20261022000002 / test fixtures). */
  is_provisional?: boolean | undefined;
}

export interface CalendarSpeech {
  speech_id: string;
  title: string;
  /** photo_url: already resolved to an absolute URL (domain/speakerPhotos.ts) or null. */
  speaker: {
    name: string;
    country_code: string;
    currency_code: string;
    photo_url?: string | null | undefined;
    organization?: string | undefined;
  };
  importance: string;
  statement_datetime: string;
  status: string;
}

export interface CalendarFilters {
  importance?: string | undefined;
  currency?: string | undefined;
}

const KIND_ORDER: Readonly<Record<CalendarItemKind, number>> = { INDICATOR: 0, SPEECH: 1 };

/** datetime ascending, then INDICATOR before SPEECH, then id. */
export function compareCalendarItems(a: CalendarItem, b: CalendarItem): number {
  const byTime = Date.parse(a.datetime) - Date.parse(b.datetime);
  if (byTime !== 0) return byTime;
  const byKind = KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
  if (byKind !== 0) return byKind;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function matches(item: CalendarItem, filters: CalendarFilters): boolean {
  if (filters.importance && item.importance !== filters.importance) return false;
  if (filters.currency && item.currency_code !== filters.currency) return false;
  return true;
}

/** CANCELLED speeches are dropped; indicator events keep their status
 * (a CANCELLED release is still shown, labelled by status). `now` decides
 * is_provisional (a past provisional row is returned as false). */
export function buildCalendarItems(
  events: readonly CalendarIndicatorEvent[],
  speeches: readonly CalendarSpeech[],
  filters: CalendarFilters = {},
  now: Date = new Date(),
): CalendarItem[] {
  const indicatorItems = events.map((event): CalendarItem => ({
    kind: 'INDICATOR',
    id: event.id,
    indicator_id: event.indicator_id,
    title: event.indicator_name,
    display_name: event.indicator_display_name ?? null,
    speaker_name: null,
    speaker_photo_url: null,
    country_code: event.country_code,
    currency_code: event.currency_code,
    importance: event.importance,
    datetime: event.release_datetime,
    datetime_precision: event.release_datetime_precision,
    status: event.status,
    is_provisional: effectiveIsProvisional(event.is_provisional, event.release_datetime, now),
    attribution: null,
  }));
  const speechItems = speeches
    .filter((speech) => speech.status !== 'CANCELLED')
    .map((speech): CalendarItem => ({
      kind: 'SPEECH',
      id: speech.speech_id,
      indicator_id: null,
      title: speech.title,
      display_name: null,
      speaker_name: speech.speaker.name,
      speaker_photo_url: speech.speaker.photo_url ?? null,
      country_code: speech.speaker.country_code,
      currency_code: speech.speaker.currency_code,
      importance: speech.importance,
      datetime: speech.statement_datetime,
      datetime_precision: 'EXACT',
      status: speech.status,
      is_provisional: false,
      attribution: attributionForOrganization(speech.speaker.organization),
    }));
  return [...indicatorItems, ...speechItems].filter((item) => matches(item, filters)).sort(compareCalendarItems);
}
