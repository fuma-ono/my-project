import type { SupabaseClient } from '@supabase/supabase-js';

export interface HistoricalEventRow {
  event_id: string;
  release_datetime: string;
  forecast: number | null;
  actual: number | null;
  previous: number | null;
  surprise: number | null;
  surprise_direction: string | null;
}

/** RELEASED events for an indicator, most recent first, each paired with
 * its RELEASE snapshot (MVP only ever writes that one snapshot_type). */
export async function listReleasedEventsForIndicator(
  supabase: SupabaseClient,
  indicatorId: string,
  range: { from: number; to: number },
): Promise<{ rows: HistoricalEventRow[]; total: number }> {
  const { data, error, count } = await supabase
    .from('economic_events')
    .select('id, release_datetime, event_snapshots!inner(forecast, actual, previous, surprise, surprise_direction)', {
      count: 'exact',
    })
    .eq('indicator_id', indicatorId)
    .eq('status', 'RELEASED')
    .order('release_datetime', { ascending: false })
    .range(range.from, range.to);
  if (error) throw error;

  const rows: HistoricalEventRow[] = (data ?? []).map((row) => {
    const snapshot = row.event_snapshots as unknown as {
      forecast: number | null;
      actual: number | null;
      previous: number | null;
      surprise: number | null;
      surprise_direction: string | null;
    };
    return { event_id: row.id, release_datetime: row.release_datetime, ...snapshot };
  });

  return { rows, total: count ?? 0 };
}

export interface ReleasedEventIdRow {
  id: string;
}

export async function listAllReleasedEventIds(supabase: SupabaseClient, indicatorId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('economic_events')
    .select('id')
    .eq('indicator_id', indicatorId)
    .eq('status', 'RELEASED');
  if (error) throw error;
  return (data ?? []).map((row: ReleasedEventIdRow) => row.id);
}

export interface ComparisonReactionRow {
  event_id: string;
  timeframe: string;
  movement: number | null;
  pips: number | null;
}

/** Only `data_status = AVAILABLE` rows — incomplete data is never mixed
 * into statistics (db-design.md §10). */
export async function listAvailableReactionsForComparison(
  supabase: SupabaseClient,
  eventIds: string[],
  fxPairId: string,
  timeframes: string[],
): Promise<ComparisonReactionRow[]> {
  if (eventIds.length === 0) return [];
  const { data, error } = await supabase
    .from('event_price_reactions')
    .select('event_id, timeframe, movement, pips')
    .in('event_id', eventIds)
    .eq('fx_pair_id', fxPairId)
    .in('timeframe', timeframes)
    .eq('data_status', 'AVAILABLE');
  if (error) throw error;
  return data ?? [];
}
