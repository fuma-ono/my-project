import type { SupabaseClient } from '@supabase/supabase-js';

/** PostgREST RPC bodies are JSON, but keep each call's id list bounded anyway. */
const INDICATOR_ID_CHUNK = 100;

/**
 * Per indicator, the ids of the `limit` most recent RELEASED events
 * (release_datetime desc, id asc) — DB function `visible_released_event_ids`
 * (migration 20261022000001, service_role only). HQ判断 2026-10-22.
 */
export async function listVisibleReleasedEventIds(
  supabase: SupabaseClient,
  indicatorIds: readonly string[],
  limit: number,
): Promise<Set<string>> {
  const uniqueIds = [...new Set(indicatorIds)];
  const visible = new Set<string>();
  for (let index = 0; index < uniqueIds.length; index += INDICATOR_ID_CHUNK) {
    const { data, error } = await supabase.rpc('visible_released_event_ids', {
      p_indicator_ids: uniqueIds.slice(index, index + INDICATOR_ID_CHUNK),
      p_limit: limit,
    });
    if (error) throw error;
    for (const row of (data ?? []) as { event_id: string }[]) visible.add(row.event_id);
  }
  return visible;
}
