import 'dotenv/config';
import { loadEnv } from '../config/env.js';
import { createSupabaseClient } from '../db/supabaseClient.js';
import { listActiveFxPairs } from '../repositories/fxPairsRepository.js';
import { upsertFxPrices } from '../repositories/fxPricesRepository.js';
import { createTwelveDataProvider, TwelveDataError } from '../integrations/twelveDataProvider.js';
import type { Timeframe } from '../domain/dataQuality.js';

/**
 * fx_prices ingestion job(design.md §4.3のIngestion Worker)。
 *
 * HQ指示(2026-10-15)「あちらで本番データを取る仕組みが完成したら実機で
 * 試したい、まず無料枠で内部確認用に繋ぐ」: Twelve Data(design.md §7.3の
 * 代替候補)の無料プランから1分・5分・15分足を取得し、`fx_prices`に
 * 保存する。**社内の開発ビルド確認専用。無料・個人向けAPIを本番配信に
 * そのまま使うことは要件定義書6.4節で禁止されているため、一般ユーザー
 * 向けの本番環境では実行しないこと。**
 *
 * TWELVE_DATA_API_KEY が未設定のときは何もせず終了する(契約済みProviderに
 * 差し替わるまでの間、cronに登録しても安全)。
 *
 *   npm run jobs:ingest-fx-prices          # from source (tsx)
 *   node dist/jobs/ingestFxPrices.js       # after `npm run build`
 *
 * Exit code 0 on success (0件取得も含む), 1 on failure — cron-friendly。
 */

const TIMEFRAMES: readonly Timeframe[] = ['1m', '5m', '15m'];
/** 1回の呼び出しで遡って取得する本数。無料枠のレート制限(分間8回程度)を
 * 踏まえ、ペア数×時間足数ぶんの呼び出しを数分おきに実行する想定。 */
const OUTPUTSIZE = 30;

async function main(): Promise<void> {
  const env = loadEnv();
  const supabase = createSupabaseClient(env);
  const provider = createTwelveDataProvider({ apiKey: env.TWELVE_DATA_API_KEY });

  if (!env.TWELVE_DATA_API_KEY) {
    console.log(
      JSON.stringify({
        job: 'ingest-fx-prices',
        skipped: 'TWELVE_DATA_API_KEY not configured',
        at: new Date().toISOString(),
      }),
    );
    return;
  }

  const pairs = await listActiveFxPairs(supabase);
  let totalUpserted = 0;
  const failures: { symbol: string; timeframe: Timeframe; error: string }[] = [];

  for (const pair of pairs) {
    for (const timeframe of TIMEFRAMES) {
      try {
        const candles = await provider.fetchCandles({ symbol: pair.symbol, timeframe, outputsize: OUTPUTSIZE });
        if (candles.length === 0) continue;
        const upserted = await upsertFxPrices(
          supabase,
          candles.map((candle) => ({ fx_pair_id: pair.fx_pair_id, timeframe, candle, source: provider.name })),
        );
        totalUpserted += upserted;
      } catch (error) {
        const message = error instanceof TwelveDataError ? error.message : String(error);
        failures.push({ symbol: pair.symbol, timeframe, error: message });
      }
    }
  }

  console.log(
    JSON.stringify({
      job: 'ingest-fx-prices',
      provider: provider.name,
      pairs: pairs.length,
      upserted: totalUpserted,
      failures,
      at: new Date().toISOString(),
    }),
  );
  if (failures.length > 0 && totalUpserted === 0) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({ job: 'ingest-fx-prices', error: String(error) }));
  process.exit(1);
});
