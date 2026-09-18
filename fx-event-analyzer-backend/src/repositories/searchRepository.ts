import type { SupabaseClient } from '@supabase/supabase-js';

function escapeIlike(value: string): string {
  return value.replace(/[%_]/g, (char) => `\\${char}`);
}

export interface IndicatorSearchRow {
  id: string;
  code: string;
  name: string;
  country_code: string;
  currency_code: string;
}

export async function searchIndicators(
  supabase: SupabaseClient,
  q: string,
  limit: number,
): Promise<IndicatorSearchRow[]> {
  const escaped = escapeIlike(q);
  const { data, error } = await supabase
    .from('economic_indicators')
    .select('id, code, name, country_code, currency_code')
    .eq('is_active', true)
    .or(`name.ilike.%${escaped}%,code.ilike.%${escaped}%`)
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

export interface EventSearchRow {
  id: string;
  indicator_id: string;
  indicator_name: string;
  release_datetime: string;
  status: string;
}

/** Event search is always Indicator-based (api-design.md §23.1, A-6):
 * find matching indicators, then return their events. */
export async function searchEventsByIndicator(
  supabase: SupabaseClient,
  q: string,
  limit: number,
): Promise<EventSearchRow[]> {
  const indicators = await searchIndicators(supabase, q, limit);
  if (indicators.length === 0) return [];

  const { data, error } = await supabase
    .from('economic_events')
    .select('id, indicator_id, release_datetime, status')
    .in(
      'indicator_id',
      indicators.map((indicator) => indicator.id),
    )
    .order('release_datetime', { ascending: false })
    .limit(limit);
  if (error) throw error;

  const nameById = new Map(indicators.map((indicator) => [indicator.id, indicator.name]));
  return (data ?? []).map((row) => ({
    id: row.id,
    indicator_id: row.indicator_id,
    indicator_name: nameById.get(row.indicator_id) ?? '',
    release_datetime: row.release_datetime,
    status: row.status,
  }));
}

export interface FxPairSearchRow {
  id: string;
  symbol: string;
  base_currency: string;
  quote_currency: string;
}

export async function searchFxPairs(supabase: SupabaseClient, q: string, limit: number): Promise<FxPairSearchRow[]> {
  const escaped = escapeIlike(q);
  const { data, error } = await supabase
    .from('fx_pairs')
    .select('id, symbol, base_currency, quote_currency')
    .eq('is_active', true)
    .ilike('symbol', `%${escaped}%`)
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}
