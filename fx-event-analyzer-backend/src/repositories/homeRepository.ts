import type { SupabaseClient } from '@supabase/supabase-js';

export interface HomeEventRow {
  id: string;
  indicator_id: string;
  release_datetime: string;
  release_datetime_precision: string;
  importance: string;
  status: string;
  data_status: string;
  indicator_name: string;
  country_code: string;
  currency_code: string;
}

export async function listEventsInRange(
  supabase: SupabaseClient,
  startUtc: string,
  endUtc: string,
): Promise<HomeEventRow[]> {
  const { data, error } = await supabase
    .from('economic_events')
    .select(
      'id, indicator_id, release_datetime, release_datetime_precision, importance, status, data_status, economic_indicators!inner(name, country_code, currency_code)',
    )
    .gte('release_datetime', startUtc)
    .lt('release_datetime', endUtc)
    .order('release_datetime', { ascending: true });
  if (error) throw error;

  return (data ?? []).map((row) => {
    const indicator = row.economic_indicators as unknown as {
      name: string;
      country_code: string;
      currency_code: string;
    };
    return {
      id: row.id,
      indicator_id: row.indicator_id,
      release_datetime: row.release_datetime,
      release_datetime_precision: row.release_datetime_precision,
      importance: row.importance,
      status: row.status,
      data_status: row.data_status,
      indicator_name: indicator.name,
      country_code: indicator.country_code,
      currency_code: indicator.currency_code,
    };
  });
}

export interface EventSnapshotSummary {
  event_id: string;
  forecast: number | null;
  actual: number | null;
  previous: number | null;
  surprise: number | null;
  surprise_direction: string | null;
}

export async function listSnapshotsForEvents(
  supabase: SupabaseClient,
  eventIds: string[],
): Promise<EventSnapshotSummary[]> {
  if (eventIds.length === 0) return [];
  const { data, error } = await supabase
    .from('event_snapshots')
    .select('event_id, forecast, actual, previous, surprise, surprise_direction')
    .in('event_id', eventIds)
    .eq('snapshot_type', 'RELEASE');
  if (error) throw error;
  return data ?? [];
}

export interface MajorFxRow {
  fx_pair_id: string;
  symbol: string;
  price: number | null;
  change: number | null;
  change_percent: number | null;
  timestamp: string | null;
}

/**
 * No continuous live price feed exists yet (Ingestion Worker is Phase 6) —
 * this reports the most recent stored candle per pair and, when a prior
 * one exists, the change against it. A pair with no price data at all
 * returns nulls rather than a fabricated value.
 */
export async function listMajorFx(supabase: SupabaseClient): Promise<MajorFxRow[]> {
  const { data: pairs, error } = await supabase.from('fx_pairs').select('id, symbol').eq('is_active', true);
  if (error) throw error;

  return Promise.all(
    (pairs ?? []).map(async (pair) => {
      const { data: prices, error: priceError } = await supabase
        .from('fx_prices')
        .select('close, timestamp')
        .eq('fx_pair_id', pair.id)
        .order('timestamp', { ascending: false })
        .limit(2);
      if (priceError) throw priceError;

      const [latest, previous] = prices ?? [];
      if (!latest) {
        return {
          fx_pair_id: pair.id,
          symbol: pair.symbol,
          price: null,
          change: null,
          change_percent: null,
          timestamp: null,
        };
      }

      const change = previous ? latest.close - previous.close : null;
      const changePercent = previous && previous.close !== 0 ? ((change as number) / previous.close) * 100 : null;

      return {
        fx_pair_id: pair.id,
        symbol: pair.symbol,
        price: latest.close,
        change,
        change_percent: changePercent,
        timestamp: latest.timestamp,
      };
    }),
  );
}
