/**
 * SCR-010 経済指標カレンダー (GET /calendar, api-design.md §14.6). Merges
 * economic indicator events and VIP speeches in a range into one list the
 * client lays out as a month grid (importance dots) and a per-day list.
 *
 * Labels match GET /notifications/upcoming: an indicator row's title is
 * the indicator name, a speech row's title is the speech's own title with
 * the speaker's display name alongside in `speaker_name`.
 */

export type CalendarItemKind = 'INDICATOR' | 'SPEECH';

export interface CalendarItem {
  kind: CalendarItemKind;
  /** event_id (INDICATOR) or speech_id (SPEECH). */
  id: string;
  title: string;
  /** SPEECH only. */
  speaker_name: string | null;
  country_code: string;
  currency_code: string;
  importance: string;
  /** release_datetime (INDICATOR) / statement_datetime (SPEECH). */
  datetime: string;
  /** INDICATOR: release_datetime_precision. SPEECH: always EXACT. */
  datetime_precision: string;
  status: string;
}

export interface CalendarIndicatorEvent {
  id: string;
  indicator_name: string;
  country_code: string;
  currency_code: string;
  importance: string;
  release_datetime: string;
  release_datetime_precision: string;
  status: string;
}

export interface CalendarSpeech {
  speech_id: string;
  title: string;
  speaker: { name: string; country_code: string; currency_code: string };
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
 * (a CANCELLED release is still shown, labelled by status). */
export function buildCalendarItems(
  events: readonly CalendarIndicatorEvent[],
  speeches: readonly CalendarSpeech[],
  filters: CalendarFilters = {},
): CalendarItem[] {
  const indicatorItems = events.map((event): CalendarItem => ({
    kind: 'INDICATOR',
    id: event.id,
    title: event.indicator_name,
    speaker_name: null,
    country_code: event.country_code,
    currency_code: event.currency_code,
    importance: event.importance,
    datetime: event.release_datetime,
    datetime_precision: event.release_datetime_precision,
    status: event.status,
  }));
  const speechItems = speeches
    .filter((speech) => speech.status !== 'CANCELLED')
    .map((speech): CalendarItem => ({
      kind: 'SPEECH',
      id: speech.speech_id,
      title: speech.title,
      speaker_name: speech.speaker.name,
      country_code: speech.speaker.country_code,
      currency_code: speech.speaker.currency_code,
      importance: speech.importance,
      datetime: speech.statement_datetime,
      datetime_precision: 'EXACT',
      status: speech.status,
    }));
  return [...indicatorItems, ...speechItems].filter((item) => matches(item, filters)).sort(compareCalendarItems);
}
