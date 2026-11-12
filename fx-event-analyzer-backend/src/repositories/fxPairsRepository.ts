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

/** An active fx_pairs row by id (POST /rate-alerts), or null. */
export async function getActiveFxPairById(supabase: SupabaseClient, fxPairId: string): Promise<FxPairRow | null> {
  const { data, error } = await supabase
    .from('fx_pairs')
    .select('id, symbol, base_currency, quote_currency')
    .eq('id', fxPairId)
    .eq('is_active', true)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    fx_pair_id: data.id,
    symbol: data.symbol,
    base_currency: data.base_currency,
    quote_currency: data.quote_currency,
  };
}

/**
 * The latest price per pair — the `close` of the most recent fx_prices row
 * (any timeframe), exactly what GET /home major_fx shows as `price`
 * (homeRepository listMajorFx). Pairs without any price are absent from
 * the map. One query per pair, like listMajorFx (index (fx_pair_id, timestamp)).
 */
export async function listLatestFxPrices(
  supabase: SupabaseClient,
  fxPairIds: readonly string[],
): Promise<Map<string, number>> {
  const unique = [...new Set(fxPairIds)];
  const entries = await Promise.all(
    unique.map(async (fxPairId) => {
      const { data, error } = await supabase
        .from('fx_prices')
        .select('close')
        .eq('fx_pair_id', fxPairId)
        .order('timestamp', { ascending: false })
        .limit(1);
      if (error) throw error;
      const latest = (data ?? [])[0] as { close: number | string } | undefined;
      return latest === undefined ? null : ([fxPairId, Number(latest.close)] as const);
    }),
  );
  return new Map(entries.filter((entry): entry is readonly [string, number] => entry !== null));
}
