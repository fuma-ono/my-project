import type { SupabaseClient } from '@supabase/supabase-js';
import { rangeFor, type PaginationParams } from '../utils/pagination.js';

export interface SpeakerSummary {
  speaker_id: string;
  name: string;
  title: string;
  organization: string;
  country_code: string;
  currency_code: string;
  /** 公式写真のURL(FRB理事のみ。無ければ null、アプリは頭文字で表示)。 */
  photo_url: string | null;
}

/** GET /speeches item (api-design.md §14.4). */
export interface SpeechSummary {
  speech_id: string;
  speaker: SpeakerSummary;
  title: string;
  summary: string | null;
  statement_datetime: string;
  importance: string;
  status: string;
}

const SPEECH_COLUMNS =
  'id, title, summary, statement_datetime, importance, status, speakers!inner(id, name, title, organization, country_code, currency_code, photo_url)';

interface SpeechDbRow {
  id: string;
  title: string;
  summary: string | null;
  statement_datetime: string;
  importance: string;
  status: string;
  speakers: unknown;
}

function toSpeechSummary(row: SpeechDbRow): SpeechSummary {
  const speaker = row.speakers as {
    id: string;
    name: string;
    title: string;
    organization: string;
    country_code: string;
    currency_code: string;
    photo_url?: string | null;
  };
  return {
    speech_id: row.id,
    speaker: {
      speaker_id: speaker.id,
      name: speaker.name,
      title: speaker.title,
      organization: speaker.organization,
      country_code: speaker.country_code,
      currency_code: speaker.currency_code,
      photo_url: speaker.photo_url ?? null,
    },
    title: row.title,
    summary: row.summary,
    statement_datetime: row.statement_datetime,
    importance: row.importance,
    status: row.status,
  };
}

export interface ListSpeechesFilters {
  from?: string | undefined;
  to?: string | undefined;
  importance?: string | undefined;
  currency?: string | undefined;
}

/** `from` is inclusive, `to` is exclusive (api-design.md §6). Newest first. */
export async function listSpeeches(
  supabase: SupabaseClient,
  filters: ListSpeechesFilters,
  pagination: PaginationParams,
): Promise<{ rows: SpeechSummary[]; total: number }> {
  let query = supabase.from('speech_events').select(SPEECH_COLUMNS, { count: 'exact' });

  if (filters.from) query = query.gte('statement_datetime', filters.from);
  if (filters.to) query = query.lt('statement_datetime', filters.to);
  if (filters.importance) query = query.eq('importance', filters.importance);
  if (filters.currency) query = query.eq('speakers.currency_code', filters.currency);

  const { from, to } = rangeFor(pagination.page, pagination.limit);
  const { data, error, count } = await query
    .order('statement_datetime', { ascending: false })
    .order('id', { ascending: true })
    .range(from, to);
  if (error) throw error;

  return { rows: (data ?? []).map((row) => toSpeechSummary(row as SpeechDbRow)), total: count ?? 0 };
}

export async function getSpeechById(supabase: SupabaseClient, speechId: string): Promise<SpeechSummary | null> {
  const { data, error } = await supabase.from('speech_events').select(SPEECH_COLUMNS).eq('id', speechId).maybeSingle();
  if (error) throw error;
  return data ? toSpeechSummary(data) : null;
}

/** SCHEDULED speeches in [from, to] — candidates for GET /notifications/upcoming. */
export async function listScheduledSpeechesInRange(
  supabase: SupabaseClient,
  fromIso: string,
  toIso: string,
): Promise<SpeechSummary[]> {
  const { data, error } = await supabase
    .from('speech_events')
    .select(SPEECH_COLUMNS)
    .eq('status', 'SCHEDULED')
    .gte('statement_datetime', fromIso)
    .lte('statement_datetime', toIso)
    .order('statement_datetime', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row) => toSpeechSummary(row as SpeechDbRow));
}

/** Every speech in [from, to) regardless of status — GET /calendar
 * (CANCELLED ones are dropped by buildCalendarItems). Oldest first. */
export async function listSpeechesInRange(
  supabase: SupabaseClient,
  fromIso: string,
  toIso: string,
): Promise<SpeechSummary[]> {
  const { data, error } = await supabase
    .from('speech_events')
    .select(SPEECH_COLUMNS)
    .gte('statement_datetime', fromIso)
    .lt('statement_datetime', toIso)
    .order('statement_datetime', { ascending: true })
    .order('id', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row) => toSpeechSummary(row as SpeechDbRow));
}

/** GET /home `speeches`: DELIVERED speeches in [from, to], newest first, at most `limit`. */
export async function listRecentDeliveredSpeeches(
  supabase: SupabaseClient,
  fromIso: string,
  toIso: string,
  limit: number,
): Promise<SpeechSummary[]> {
  const { data, error } = await supabase
    .from('speech_events')
    .select(SPEECH_COLUMNS)
    .eq('status', 'DELIVERED')
    .gte('statement_datetime', fromIso)
    .lte('statement_datetime', toIso)
    .order('statement_datetime', { ascending: false })
    .order('id', { ascending: true })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map((row) => toSpeechSummary(row as SpeechDbRow));
}

/** Speeches by id regardless of status (CALENDAR_UPDATE candidates). */
export async function listSpeechesByIds(supabase: SupabaseClient, ids: readonly string[]): Promise<SpeechSummary[]> {
  if (ids.length === 0) return [];
  const { data, error } = await supabase
    .from('speech_events')
    .select(SPEECH_COLUMNS)
    .in('id', [...ids]);
  if (error) throw error;
  return (data ?? []).map((row) => toSpeechSummary(row as SpeechDbRow));
}

/** A speaker by id (GET /speakers/{id}/comparison), or null. photo_url is the raw DB value. */
export async function getSpeakerById(supabase: SupabaseClient, speakerId: string): Promise<SpeakerSummary | null> {
  const { data, error } = await supabase
    .from('speakers')
    .select('id, name, title, organization, country_code, currency_code, photo_url')
    .eq('id', speakerId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    speaker_id: data.id,
    name: data.name,
    title: data.title,
    organization: data.organization,
    country_code: data.country_code,
    currency_code: data.currency_code,
    photo_url: data.photo_url ?? null,
  };
}

/** GET /speakers/{id}/comparison: the speaker's DELIVERED speeches, newest first, at most `limit`. */
export async function listDeliveredSpeechesForSpeaker(
  supabase: SupabaseClient,
  speakerId: string,
  limit: number,
): Promise<SpeechSummary[]> {
  if (limit <= 0) return [];
  const { data, error } = await supabase
    .from('speech_events')
    .select(SPEECH_COLUMNS)
    .eq('speaker_id', speakerId)
    .eq('status', 'DELIVERED')
    .order('statement_datetime', { ascending: false })
    .order('id', { ascending: true })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map((row) => toSpeechSummary(row as SpeechDbRow));
}
