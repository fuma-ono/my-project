import type { SupabaseClient } from '@supabase/supabase-js';
import { minuteIndexOf, type MinuteRange } from '../domain/reactionClassification/baseline.js';
import type { OverlapCandidate } from '../domain/reactionClassification/overlap.js';
import { MS_PER_MINUTE } from '../domain/reactionClassification/time.js';

/**
 * Reads for GET /events/{id}/reaction-analysis (service_role client like the other repositories; tests use fakes only).
 * Thin on purpose: the classification itself is in domain/reactionClassification.
 */

/** PostgREST returns at most 1000 rows per request by default; page below that. */
const PAGE_SIZE = 1000;

interface BarRow {
  timestamp: string;
  close: number | string;
}

/**
 * 1-minute closes of the given minute-index ranges ([from, to) by bar OPEN time) as a map minute index -> close.
 * UNVERIFIED bars are skipped like everywhere else (treated as missing). Nothing is interpolated or filled in.
 */
export async function listMinuteCloses(
  supabase: SupabaseClient,
  fxPairId: string,
  ranges: readonly MinuteRange[],
): Promise<Map<number, number>> {
  const closes = new Map<number, number>();
  const pages = await Promise.all(
    ranges.map(async (range) => {
      const rows: BarRow[] = [];
      for (let offset = 0; ; offset += PAGE_SIZE) {
        const { data, error } = await supabase
          .from('fx_prices')
          .select('timestamp, close')
          .eq('fx_pair_id', fxPairId)
          .eq('timeframe', '1m')
          .neq('verification_status', 'UNVERIFIED')
          .gte('timestamp', new Date(range.from * MS_PER_MINUTE).toISOString())
          .lt('timestamp', new Date(range.to * MS_PER_MINUTE).toISOString())
          .order('timestamp', { ascending: true })
          .range(offset, offset + PAGE_SIZE - 1);
        if (error) throw error;
        const page = (data ?? []) as BarRow[];
        rows.push(...page);
        if (page.length < PAGE_SIZE) break;
      }
      return rows;
    }),
  );
  for (const row of pages.flat()) {
    const ms = Date.parse(row.timestamp);
    const close = Number(row.close);
    if (Number.isFinite(ms) && Number.isFinite(close) && ms % MS_PER_MINUTE === 0) closes.set(minuteIndexOf(ms), close);
  }
  return closes;
}

export interface PastEventRow {
  event_id: string;
  release_datetime: string;
}

/**
 * Earlier RELEASED events of the same indicator with an EXACT release time, newest first (release_datetime desc, id asc,
 * the same order as listReleasedEventsBefore). Unlike listReleasedEventsBefore it does not require a RELEASE snapshot:
 * the classification uses prices only.
 */
export async function listPastEventsForHistory(
  supabase: SupabaseClient,
  indicatorId: string,
  beforeIso: string,
  limit: number,
): Promise<PastEventRow[]> {
  const { data, error } = await supabase
    .from('economic_events')
    .select('id, release_datetime')
    .eq('indicator_id', indicatorId)
    .eq('status', 'RELEASED')
    .eq('release_datetime_precision', 'EXACT')
    .lt('release_datetime', beforeIso)
    .order('release_datetime', { ascending: false })
    .order('id', { ascending: true })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map((row: { id: string; release_datetime: string }) => ({
    event_id: row.id,
    release_datetime: row.release_datetime,
  }));
}

const NOT_LOW = ['MEDIUM', 'HIGH'];

interface EventCandidateRow {
  id: string;
  release_datetime: string;
  release_datetime_precision: string;
  importance: string;
  economic_indicators: { code: string; name: string; display_name: string | null; currency_code: string };
}

interface SpeechCandidateRow {
  id: string;
  title: string;
  statement_datetime: string;
  importance: string;
  time_precision: string | null;
  speakers: { currency_code: string };
}

/**
 * Other scheduled items in [fromIso, toIso] (importance MEDIUM or HIGH, not cancelled): economic events and speeches.
 * Currency / importance / group filtering is done by the domain (overlap.ts). Only a time range is read.
 */
export async function listOverlapCandidates(
  supabase: SupabaseClient,
  fromIso: string,
  toIso: string,
): Promise<OverlapCandidate[]> {
  const [events, speeches] = await Promise.all([
    supabase
      .from('economic_events')
      .select(
        'id, release_datetime, release_datetime_precision, importance, economic_indicators!inner(code, name, display_name, currency_code)',
      )
      .in('importance', NOT_LOW)
      .neq('status', 'CANCELLED')
      .gte('release_datetime', fromIso)
      .lte('release_datetime', toIso),
    supabase
      .from('speech_events')
      .select('id, title, statement_datetime, importance, time_precision, speakers!inner(currency_code)')
      .in('importance', NOT_LOW)
      .neq('status', 'CANCELLED')
      .gte('statement_datetime', fromIso)
      .lte('statement_datetime', toIso),
  ]);
  if (events.error) throw events.error;
  if (speeches.error) throw speeches.error;
  const out: OverlapCandidate[] = [];
  for (const row of (events.data ?? []) as unknown as EventCandidateRow[]) {
    out.push({
      kind: 'EVENT',
      id: row.id,
      eventId: row.id,
      name: row.economic_indicators.display_name ?? row.economic_indicators.name,
      datetimeMs: Date.parse(row.release_datetime),
      currency: row.economic_indicators.currency_code,
      importance: row.importance as OverlapCandidate['importance'],
      timeUncertain: row.release_datetime_precision !== 'EXACT',
    });
  }
  for (const row of (speeches.data ?? []) as unknown as SpeechCandidateRow[]) {
    out.push({
      kind: 'SPEECH',
      id: row.id,
      name: row.title,
      datetimeMs: Date.parse(row.statement_datetime),
      currency: row.speakers.currency_code,
      importance: row.importance as OverlapCandidate['importance'],
      timeUncertain: (row.time_precision ?? 'EXACT') !== 'EXACT',
    });
  }
  return out;
}
