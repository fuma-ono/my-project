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

interface SnapshotValues {
  forecast: number | null;
  actual: number | null;
  previous: number | null;
  surprise: number | null;
  surprise_direction: string | null;
}

/** The embedded RELEASE snapshot — PostgREST returns the one-to-many
 * `event_snapshots` embed as an array (unique is (event_id, snapshot_type),
 * not event_id alone), so accept both shapes. */
function releaseSnapshotOf(embedded: unknown): SnapshotValues {
  const snapshot = (Array.isArray(embedded) ? embedded[0] : embedded) as Partial<SnapshotValues> | undefined;
  return {
    forecast: snapshot?.forecast ?? null,
    actual: snapshot?.actual ?? null,
    previous: snapshot?.previous ?? null,
    surprise: snapshot?.surprise ?? null,
    surprise_direction: snapshot?.surprise_direction ?? null,
  };
}

/**
 * Both comparison queries below select the same rows in the same order
 * (HQ判断 2026-10-22): RELEASED events of the indicator that have a RELEASE
 * snapshot (inner join), release_datetime desc then id asc. So the id set the
 * stats use and the paginated `events` never disagree, and FREE never sees
 * more than history_events_max.
 */

/** RELEASED events for an indicator, most recent first, each paired with
 * its RELEASE snapshot. */
export async function listReleasedEventsForIndicator(
  supabase: SupabaseClient,
  indicatorId: string,
  range: { from: number; to: number },
): Promise<{ rows: HistoricalEventRow[]; total: number }> {
  const { data, error, count } = await supabase
    .from('economic_events')
    .select(
      'id, release_datetime, event_snapshots!inner(forecast, actual, previous, surprise, surprise_direction, snapshot_type)',
      { count: 'exact' },
    )
    .eq('indicator_id', indicatorId)
    .eq('status', 'RELEASED')
    .eq('event_snapshots.snapshot_type', 'RELEASE')
    .order('release_datetime', { ascending: false })
    .order('id', { ascending: true })
    .range(range.from, range.to);
  if (error) throw error;

  const rows: HistoricalEventRow[] = (data ?? []).map((row) => ({
    event_id: row.id,
    release_datetime: row.release_datetime,
    ...releaseSnapshotOf(row.event_snapshots),
  }));

  return { rows, total: count ?? 0 };
}

export interface ReleasedEventIdRow {
  id: string;
}

/** The `limit` most recent RELEASED event ids (with a RELEASE snapshot,
 * same eligibility and order as listReleasedEventsForIndicator) — the set
 * Historical Comparison stats are computed over (capped per plan,
 * api-design.md §21 / §28.1). */
export async function listRecentReleasedEventIds(
  supabase: SupabaseClient,
  indicatorId: string,
  limit: number,
): Promise<string[]> {
  const { data, error } = await supabase
    .from('economic_events')
    .select('id, event_snapshots!inner(snapshot_type)')
    .eq('indicator_id', indicatorId)
    .eq('status', 'RELEASED')
    .eq('event_snapshots.snapshot_type', 'RELEASE')
    .order('release_datetime', { ascending: false })
    .order('id', { ascending: true })
    .limit(limit);
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
