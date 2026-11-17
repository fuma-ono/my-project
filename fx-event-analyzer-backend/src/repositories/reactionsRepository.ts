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

/** Used for Event Detail's major_fx_reactions (api-design.md §14.1):
 * several pairs × several timeframes in one query. */
export async function listReactionsForPairsAndTimeframes(
  supabase: SupabaseClient,
  eventId: string,
  fxPairIds: string[],
  timeframes: readonly string[],
): Promise<ReactionRow[]> {
  if (fxPairIds.length === 0 || timeframes.length === 0) return [];
  const { data, error } = await supabase
    .from('event_price_reactions')
    .select(REACTION_COLUMNS)
    .eq('event_id', eventId)
    .in('fx_pair_id', fxPairIds)
    .in('timeframe', [...timeframes]);
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
  limit?: number,
): Promise<FxPriceRow[]> {
  let query = supabase
    .from('fx_prices')
    .select('timestamp, open, high, low, close, volume')
    .eq('fx_pair_id', fxPairId)
    .eq('timeframe', timeframe)
    // UNVERIFIED minutes (failed the ③ vs ⑤ cross-check, data-sources.md §6.4)
    // are treated as missing: not charted, and a speech reaction that needs
    // one becomes DATA_UNAVAILABLE. Nothing is interpolated.
    .neq('verification_status', 'UNVERIFIED')
    .gte('timestamp', fromIso)
    .lte('timestamp', toIso)
    .order('timestamp', { ascending: true });
  // 返す本数の安全弁(chart の before_minutes / after_minutes の拡張。domain/chartWindow.ts の CHART_MAX_CANDLES)。
  if (limit !== undefined) query = query.limit(limit);
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export interface PreReleasePrice {
  /** 発表直前の価格(event_price_reactions.pre_release_price。どの時間枠も同じ値)。無ければ null。 */
  price: number | null;
  status: 'AVAILABLE' | 'UNAVAILABLE';
}

/**
 * 発表直前の価格(event_price_reactions に保存済みの値。計算し直さない)。時間枠の行のうち、pre_release_price が
 * ある行(どの時間枠も同じ値)を使う。1行も無い・全部 null なら UNAVAILABLE(値を作らない)。
 */
export async function getPreReleasePrice(
  supabase: SupabaseClient,
  eventId: string,
  fxPairId: string,
): Promise<PreReleasePrice> {
  const { data, error } = await supabase
    .from('event_price_reactions')
    .select('timeframe, pre_release_price')
    .eq('event_id', eventId)
    .eq('fx_pair_id', fxPairId)
    .not('pre_release_price', 'is', null)
    .order('timeframe', { ascending: true })
    .limit(1);
  if (error) throw error;
  const row = data?.[0];
  if (!row || row.pre_release_price === null) return { price: null, status: 'UNAVAILABLE' };
  return { price: Number(row.pre_release_price), status: 'AVAILABLE' };
}
