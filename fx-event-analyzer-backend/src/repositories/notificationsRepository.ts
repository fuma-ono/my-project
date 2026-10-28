import { resultTypeForIndicator } from '../domain/resultType.js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { fxPairsForCurrency, type NotificationCandidate } from '../domain/notifications.js';
import { listActiveFxPairs, type FxPairRow } from './fxPairsRepository.js';
import { listRelatedFxPairsForIndicators } from './homeRepository.js';
import {
  listScheduledSpeechesInRange,
  listSpeechesByIds,
  listSpeechesInRange,
  type SpeechSummary,
} from './speechesRepository.js';

/**
 * Fetches GET /notifications/upcoming candidates (api-design.md §24.6) for
 * [fromIso, toIso]. Only coarse, index-friendly filters run in SQL
 * (SCHEDULED, time range); every user-setting rule is applied afterwards
 * by buildUpcomingNotifications (src/domain/notifications.ts) so it stays
 * unit-testable without a DB.
 *
 * `includePast` (the in-app inbox, GET /notifications) also fetches events
 * that are no longer SCHEDULED (RELEASED / DELIVERED / CANCELLED) — an
 * event notified 5 minutes before its release is usually RELEASED by the
 * time the inbox is opened. The domain then drops CANCELLED.
 */
export async function listNotificationCandidates(
  supabase: SupabaseClient,
  fromIso: string,
  toIso: string,
  kinds: { indicators: boolean; speeches: boolean },
  options: { includePast?: boolean } = {},
): Promise<NotificationCandidate[]> {
  const includePast = options.includePast ?? false;
  const [indicatorCandidates, speechCandidates] = await Promise.all([
    kinds.indicators ? listIndicatorCandidates(supabase, fromIso, toIso, includePast) : Promise.resolve([]),
    kinds.speeches ? listSpeechCandidates(supabase, fromIso, toIso, includePast) : Promise.resolve([]),
  ]);
  return [...indicatorCandidates, ...speechCandidates];
}

const INDICATOR_CANDIDATE_COLUMNS =
  'id, indicator_id, release_datetime, release_datetime_precision, importance, status, is_provisional, economic_indicators!inner(code, name, display_name, country_code, currency_code)';

async function listIndicatorCandidates(
  supabase: SupabaseClient,
  fromIso: string,
  toIso: string,
  includePast: boolean,
): Promise<NotificationCandidate[]> {
  let query = supabase.from('economic_events').select(INDICATOR_CANDIDATE_COLUMNS);
  if (!includePast) query = query.eq('status', 'SCHEDULED');
  const { data, error } = await query
    .gte('release_datetime', fromIso)
    .lte('release_datetime', toIso)
    .order('release_datetime', { ascending: true });
  if (error) throw error;
  return toIndicatorCandidates(supabase, data ?? []);
}

interface IndicatorCandidateDbRow {
  id: string;
  indicator_id: string;
  release_datetime: string;
  release_datetime_precision: string;
  importance: string;
  status: string;
  is_provisional?: boolean | null;
  economic_indicators: unknown;
}

async function toIndicatorCandidates(
  supabase: SupabaseClient,
  rows: readonly IndicatorCandidateDbRow[],
): Promise<NotificationCandidate[]> {
  const relatedByIndicator = await listRelatedFxPairsForIndicators(
    supabase,
    rows.map((row) => row.indicator_id),
  );

  return rows.map((row) => {
    const indicator = row.economic_indicators as {
      code?: string;
      name: string;
      display_name?: string | null;
      country_code: string;
      currency_code: string;
    };
    return {
      kind: 'INDICATOR' as const,
      id: row.id,
      title: indicator.name,
      display_name: indicator.display_name ?? null,
      importance: row.importance,
      status: row.status,
      scheduled_at: row.release_datetime,
      release_datetime_precision: row.release_datetime_precision,
      is_provisional: row.is_provisional === true,
      result_type: resultTypeForIndicator(indicator.code),
      country_code: indicator.country_code,
      currency_code: indicator.currency_code,
      related_fx_pairs: (relatedByIndicator.get(row.indicator_id) ?? []).map((pair) => pair.symbol),
    };
  });
}

async function listSpeechCandidates(
  supabase: SupabaseClient,
  fromIso: string,
  toIso: string,
  includePast: boolean,
): Promise<NotificationCandidate[]> {
  const [speeches, fxPairs] = await Promise.all([
    includePast
      ? listSpeechesInRange(supabase, fromIso, toIso)
      : listScheduledSpeechesInRange(supabase, fromIso, toIso),
    listActiveFxPairs(supabase),
  ]);
  return toSpeechCandidates(speeches, fxPairs);
}

function toSpeechCandidates(
  speeches: readonly SpeechSummary[],
  fxPairs: readonly FxPairRow[],
): NotificationCandidate[] {
  // 公開の時刻しか無い発言(ポッドキャスト等)は「発言の N 分前」の通知にしない(経済指標の DATE_ONLY と同じ考え方。
  // HQ判断 2026-10-28)。カレンダー更新(中止・日時の変更)は別の候補で、ここでは扱わない
  return speeches
    .filter((speech) => speech.statement_time_precision === 'EXACT')
    .map((speech) => ({
      kind: 'SPEECH' as const,
      id: speech.speech_id,
      title: speech.title,
      speaker_name: speech.speaker.name,
      speaker_title: speech.speaker.title,
      importance: speech.importance,
      status: speech.status,
      scheduled_at: speech.statement_datetime,
      country_code: speech.speaker.country_code,
      currency_code: speech.speaker.currency_code,
      related_fx_pairs: fxPairsForCurrency(speech.speaker.currency_code, fxPairs),
      attribution: speech.attribution,
    }));
}

/**
 * Candidates by id regardless of status or time — the events CALENDAR_UPDATE
 * changes point at (src/domain/calendarUpdates.ts). The caller keys them by
 * candidateKey(kind, id).
 */
export async function listNotificationCandidatesByIds(
  supabase: SupabaseClient,
  ids: { indicators: readonly string[]; speeches: readonly string[] },
): Promise<NotificationCandidate[]> {
  const [indicatorCandidates, speechCandidates] = await Promise.all([
    (async () => {
      if (ids.indicators.length === 0) return [];
      const { data, error } = await supabase
        .from('economic_events')
        .select(INDICATOR_CANDIDATE_COLUMNS)
        .in('id', [...new Set(ids.indicators)]);
      if (error) throw error;
      return toIndicatorCandidates(supabase, data ?? []);
    })(),
    (async () => {
      if (ids.speeches.length === 0) return [];
      const [speeches, fxPairs] = await Promise.all([
        listSpeechesByIds(supabase, [...new Set(ids.speeches)]),
        listActiveFxPairs(supabase),
      ]);
      return toSpeechCandidates(speeches, fxPairs);
    })(),
  ]);
  return [...indicatorCandidates, ...speechCandidates];
}
