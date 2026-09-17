import type { SupabaseClient } from '@supabase/supabase-js';
import { rangeFor, type PaginationParams } from '../utils/pagination.js';

export interface IndicatorRow {
  id: string;
  code: string;
  name: string;
  country_code: string;
  currency_code: string;
  importance: string;
  description: string | null;
  frequency: string;
  unit: string | null;
  source: string | null;
  source_url: string | null;
  favorable_direction: string;
}

const INDICATOR_COLUMNS =
  'id, code, name, country_code, currency_code, importance, description, frequency, unit, source, source_url, favorable_direction';

export interface ListIndicatorsFilters {
  q?: string | undefined;
  countryCode?: string | undefined;
  currencyCode?: string | undefined;
  importance?: string | undefined;
  sort: 'name' | 'importance' | 'created_at';
}

export async function listIndicators(
  supabase: SupabaseClient,
  filters: ListIndicatorsFilters,
  pagination: PaginationParams,
): Promise<{ rows: IndicatorRow[]; total: number }> {
  let query = supabase.from('economic_indicators').select(INDICATOR_COLUMNS, { count: 'exact' }).eq('is_active', true);

  if (filters.q) {
    const escaped = filters.q.replace(/[%_]/g, (char) => `\\${char}`);
    query = query.or(`name.ilike.%${escaped}%,code.ilike.%${escaped}%`);
  }
  if (filters.countryCode) query = query.eq('country_code', filters.countryCode);
  if (filters.currencyCode) query = query.eq('currency_code', filters.currencyCode);
  if (filters.importance) query = query.eq('importance', filters.importance);

  const { from, to } = rangeFor(pagination.page, pagination.limit);
  const { data, error, count } = await query.order(filters.sort, { ascending: true }).range(from, to);
  if (error) throw error;

  return { rows: data ?? [], total: count ?? 0 };
}

export async function getIndicatorById(supabase: SupabaseClient, indicatorId: string): Promise<IndicatorRow | null> {
  const { data, error } = await supabase
    .from('economic_indicators')
    .select(INDICATOR_COLUMNS)
    .eq('id', indicatorId)
    .eq('is_active', true)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export interface RelatedFxPairRow {
  fx_pair_id: string;
  symbol: string;
  priority: number;
}

export async function listRelatedFxPairs(supabase: SupabaseClient, indicatorId: string): Promise<RelatedFxPairRow[]> {
  const { data, error } = await supabase
    .from('indicator_fx_pairs')
    .select('priority, fx_pairs!inner(id, symbol)')
    .eq('indicator_id', indicatorId)
    .eq('is_active', true)
    .order('priority', { ascending: true });
  if (error) throw error;

  return (data ?? []).map((row) => {
    const fxPair = row.fx_pairs as unknown as { id: string; symbol: string };
    return { fx_pair_id: fxPair.id, symbol: fxPair.symbol, priority: row.priority };
  });
}

export interface LatestEventRow {
  id: string;
  release_datetime: string;
  status: string;
}

export async function getLatestEvent(supabase: SupabaseClient, indicatorId: string): Promise<LatestEventRow | null> {
  const { data, error } = await supabase
    .from('economic_events')
    .select('id, release_datetime, status')
    .eq('indicator_id', indicatorId)
    .order('release_datetime', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}
