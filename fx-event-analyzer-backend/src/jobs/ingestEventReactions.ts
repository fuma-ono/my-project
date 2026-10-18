import 'dotenv/config';
import { loadEnv } from '../config/env.js';
import { createSupabaseClient } from '../db/supabaseClient.js';
import { FX_FETCH_SETTINGS } from '../ingestion/config.js';
import { ingestEventPriceReactions } from '../ingestion/pipelines/eventReactions.js';
import { runIngestionJob } from '../ingestion/runner.js';
import { createIngestionRepository } from '../repositories/ingestionRepository.js';

/**
 * 経済指標の価格反応(event_price_reactions)を計算して書き込むジョブ
 * (HQ決定 2026-10-18「経済指標の価格反応実装と異常系テストを進める」)。
 * 外部APIは呼ばない(既存のfx_prices/economic_eventsを読むだけ)。追加費用0円。
 * 本番DBには接続しない(接続先はSUPABASE_URLの設定による。社内確認用DBのみを想定)。
 *
 *   npm run ingest:event-reactions
 *
 * 詳細設計: src/ingestion/pipelines/eventReactions.ts。
 * Exit code 0 on success, 1 on failure — cron-friendly。
 */
async function main(): Promise<void> {
  const env = loadEnv();
  const store = createIngestionRepository(createSupabaseClient(env));

  const result = await runIngestionJob(
    store,
    { provider: 'internal', dataType: 'EVENT_REACTION', job: 'ingest:event-reactions' },
    async (counters) => {
      await ingestEventPriceReactions(
        store,
        { horizonDays: FX_FETCH_SETTINGS.repairHorizonDays },
        new Date(),
        counters,
      );
    },
  );
  console.log(
    JSON.stringify({
      job: 'ingest:event-reactions',
      status: result.status,
      fetched: result.counters.fetched,
      success: result.counters.success,
      skipped: result.counters.skipReasons,
      events: result.counters.details.events,
      errors: result.counters.errorMessages,
      at: new Date().toISOString(),
    }),
  );
  if (result.status === 'FAILURE') process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({ job: 'ingest:event-reactions', error: String(error) }));
  process.exit(1);
});
