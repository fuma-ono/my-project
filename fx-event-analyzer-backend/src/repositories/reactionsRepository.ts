import type { SupabaseClient } from '@supabase/supabase-js';

export interface ReactionRow {
  fx_pair_id: string;
  timeframe: string;
  pre_release_price: number | null;
  post_release_price: number | null;
  movement: number | null;
  pips: number | null;
  change_percent: number | null;
  max_upward: number | null;
  max_downward: number | null;
  max_upward_pips: number | null;
  max_downward_pips: number | null;
  data_status: string;
}

const REACTION_COLUMNS =
  'fx_pair_id, timeframe, pre_release_price, post_release_price, movement, pips, change_percent, max_upward, max_downward, max_upward_pips, max_downward_pips, data_status';

export async function getReaction(
  supabase: SupabaseClient,
  eventId: string,
  fxPairId: string,
  timeframe: string,
): Promise<ReactionRow | null> {
  const { data, error } = await supabase
    .from('event_price_reactions')
    .select(REACTION_COLUMNS)
    .eq('event_id', eventId)
    .eq('fx_pair_id', fxPairId)
    .eq('timeframe', timeframe)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function listReactionsForPair(
  supabase: SupabaseClient,
  eventId: string,
  fxPairId: string,
): Promise<ReactionRow[]> {
  const { data, error } = await supabase
    .from('event_price_reactions')
    .select(REACTION_COLUMNS)
    .eq('event_id', eventId)
    .eq('fx_pair_id', fxPairId);
  if (error) throw error;
  return data ?? [];
}

/** Used for Event Detail's related_fx_pairs summary (api-design.md
 * §14.2): one fixed timeframe ('5m') across every related pair. */
export async function listReactionsForTimeframe(
  supabase: SupabaseClient,
  eventId: string,
  fxPairIds: string[],
  timeframe: string,
): Promise<ReactionRow[]> {
  if (fxPairIds.length === 0) return [];
  const { data, error } = await supabase
    .from('event_price_reactions')
    .select(REACTION_COLUMNS)
    .eq('event_id', eventId)
    .eq('timeframe', timeframe)
    .in('fx_pair_id', fxPairIds);
  if (error) throw error;
  return data ?? [];
}

export interface FxPairRow {
  id: string;
  symbol: string;
  pip_size: number;
}

export async function getFxPairById(supabase: SupabaseClient, fxPairId: string): Promise<FxPairRow | null> {
  const { data, error } = await supabase
    .from('fx_pairs')
    .select('id, symbol, pip_size')
    .eq('id', fxPairId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export interface FxPriceRow {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
}

export async function listChartPrices(
  supabase: SupabaseClient,
  fxPairId: string,
  timeframe: string,
  fromIso: string,
  toIso: string,
): Promise<FxPriceRow[]> {
  const { data, error } = await supabase
    .from('fx_prices')
    .select('timestamp, open, high, low, close, volume')
    .eq('fx_pair_id', fxPairId)
    .eq('timeframe', timeframe)
    .gte('timestamp', fromIso)
    .lte('timestamp', toIso)
    .order('timestamp', { ascending: true });
  if (error) throw error;
  return data ?? [];
}
