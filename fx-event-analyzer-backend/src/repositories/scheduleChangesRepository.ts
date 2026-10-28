import type { SupabaseClient } from '@supabase/supabase-js';
import { chunk } from '../utils/chunks.js';
import type { ScheduleChangeRow } from '../domain/calendarUpdates.js';

/**
 * event_schedule_changes (supabase/migrations/20261015000002_event_schedule_changes.sql).
 * Written only by DB triggers on economic_events / speech_events; the
 * Backend reads them for CALENDAR_UPDATE (src/domain/calendarUpdates.ts).
 */

/** Changes with changed_at in [fromIso, toIso], oldest first, of the given kinds. */
export async function listScheduleChanges(
  supabase: SupabaseClient,
  fromIso: string,
  toIso: string,
  kinds: { indicators: boolean; speeches: boolean },
): Promise<ScheduleChangeRow[]> {
  const wanted = [...(kinds.indicators ? ['INDICATOR'] : []), ...(kinds.speeches ? ['SPEECH'] : [])];
  if (wanted.length === 0) return [];
  const { data, error } = await supabase
    .from('event_schedule_changes')
    .select('id, kind, target_id, change_type, old_datetime, new_datetime, changed_at')
    .in('kind', wanted)
    .gte('changed_at', fromIso)
    .lte('changed_at', toIso)
    .order('changed_at', { ascending: true })
    .order('id', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/** The cleanup job: drops changes older than `beforeIso` (past the CALENDAR_UPDATE retention). */
/**
 * SPEECH の変更の id → 要人発言の id(通知一覧の CALENDAR_UPDATE の出典、api-design v1.39)。READ-ONLY。
 * 主キーで引く。id は 100 件ごとに分けて読む(utils/chunks.ts。行ごとの問い合わせにはしない)。
 */
export async function mapSpeechChangeTargets(
  supabase: SupabaseClient,
  changeIds: readonly string[],
): Promise<Map<string, string>> {
  const targets = new Map<string, string>();
  for (const ids of chunk([...new Set(changeIds)])) {
    const { data, error } = await supabase
      .from('event_schedule_changes')
      .select('id, target_id')
      .eq('kind', 'SPEECH')
      .in('id', ids);
    if (error) throw error;
    for (const row of (data ?? []) as { id: string; target_id: string }[]) targets.set(row.id, row.target_id);
  }
  return targets;
}

export async function deleteScheduleChangesBefore(supabase: SupabaseClient, beforeIso: string): Promise<number> {
  const { data, error } = await supabase
    .from('event_schedule_changes')
    .delete()
    .lt('changed_at', beforeIso)
    .select('id');
  if (error) throw error;
  return (data ?? []).length;
}
