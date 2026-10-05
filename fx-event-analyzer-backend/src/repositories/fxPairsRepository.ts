import type { SupabaseClient } from '@supabase/supabase-js';

export interface FxPairRow {
  fx_pair_id: string;
  symbol: string;
  base_currency: string;
  quote_currency: string;
}

/** Active FX pairs ordered by symbol — GET /fx-pairs (SCR-016 対象通貨ペア). */
export async function listActiveFxPairs(supabase: SupabaseClient): Promise<FxPairRow[]> {
  const { data, error } = await supabase
    .from('fx_pairs')
    .select('id, symbol, base_currency, quote_currency')
    .eq('is_active', true)
    .order('symbol', { ascending: true });
  if (error) throw error;

  return (data ?? []).map((row) => ({
    fx_pair_id: row.id,
    symbol: row.symbol,
    base_currency: row.base_currency,
    quote_currency: row.quote_currency,
  }));
}

/** Returns the subset of `symbols` that is not an active fx_pairs.symbol. */
export async function findUnknownFxPairSymbols(
  supabase: SupabaseClient,
  symbols: readonly string[],
): Promise<string[]> {
  if (symbols.length === 0) return [];
  const { data, error } = await supabase
    .from('fx_pairs')
    .select('symbol')
    .in('symbol', [...symbols])
    .eq('is_active', true);
  if (error) throw error;

  const known = new Set((data ?? []).map((row: { symbol: string }) => row.symbol));
  return symbols.filter((symbol) => !known.has(symbol));
}
