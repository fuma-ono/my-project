import type { SupabaseClient } from '@supabase/supabase-js';
import type { Timeframe } from '../domain/dataQuality.js';
import type { FxCandle } from '../integrations/twelveDataProvider.js';

export interface FxPriceUpsertRow {
  fx_pair_id: string;
  timeframe: Timeframe;
  candle: FxCandle;
  /** Ingestion Workerの出所(db-design.md §3.11のsource列)。 */
  source: string;
}

/**
 * fx_prices への書き込み専用(design.md §4.3: Ingestion Workerだけが外部
 * データをDBに書く。Read API・アプリからはここを経由しない)。
 * `unique (fx_pair_id, timeframe, timestamp)` に対する上書き保存(upsert)。
 */
export async function upsertFxPrices(supabase: SupabaseClient, rows: readonly FxPriceUpsertRow[]): Promise<number> {
  if (rows.length === 0) return 0;

  const { error, count } = await supabase
    .from('fx_prices')
    .upsert(
      rows.map((row) => ({
        fx_pair_id: row.fx_pair_id,
        timeframe: row.timeframe,
        timestamp: row.candle.timestamp.toISOString(),
        open: row.candle.open,
        high: row.candle.high,
        low: row.candle.low,
        close: row.candle.close,
        volume: row.candle.volume,
        source: row.source,
      })),
      { onConflict: 'fx_pair_id,timeframe,timestamp', count: 'exact' },
    )
    .select('id');
  if (error) throw error;

  return count ?? rows.length;
}
