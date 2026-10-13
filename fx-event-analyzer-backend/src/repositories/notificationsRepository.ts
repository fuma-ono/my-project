import type { SupabaseClient } from '@supabase/supabase-js';
import { fxPairsForCurrency, type NotificationCandidate } from '../domain/notifications.js';
import { listActiveFxPairs } from './fxPairsRepository.js';
import { listRelatedFxPairsForIndicators } from './homeRepository.js';
import { listScheduledSpeechesInRange, listSpeechesInRange } from './speechesRepository.js';

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

async function listIndicatorCandidates(
  supabase: SupabaseClient,
  fromIso: string,
  toIso: string,
  includePast: boolean,
): Promise<NotificationCandidate[]> {
  let query = supabase
    .from('economic_events')
    .select(
      'id, indicator_id, release_datetime, release_datetime_precision, importance, status, economic_indicators!inner(name, display_name, country_code, currency_code)',
    );
  if (!includePast) query = query.eq('status', 'SCHEDULED');
  const { data, error } = await query
    .gte('release_datetime', fromIso)
    .lte('release_datetime', toIso)
    .order('release_datetime', { ascending: true });
  if (error) throw error;

  const rows = data ?? [];
  const relatedByIndicator = await listRelatedFxPairsForIndicators(
    supabase,
    rows.map((row) => row.indicator_id as string),
  );

  return rows.map((row) => {
    const indicator = row.economic_indicators as unknown as {
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

  return speeches.map((speech) => ({
    kind: 'SPEECH' as const,
    id: speech.speech_id,
    title: speech.title,
    speaker_name: speech.speaker.name,
    importance: speech.importance,
    status: speech.status,
    scheduled_at: speech.statement_datetime,
    country_code: speech.speaker.country_code,
    currency_code: speech.speaker.currency_code,
    related_fx_pairs: fxPairsForCurrency(speech.speaker.currency_code, fxPairs),
  }));
}
