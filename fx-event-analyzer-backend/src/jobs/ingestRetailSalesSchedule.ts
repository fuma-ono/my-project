import 'dotenv/config';
import { loadEnv } from '../config/env.js';
import { createSupabaseClient } from '../db/supabaseClient.js';
import {
  RETAIL_SALES_SCHEDULE_PROVIDER,
  ingestRetailSalesSchedule,
} from '../ingestion/pipelines/retailSalesSchedule.js';
import { runIngestionJob } from '../ingestion/runner.js';
import { createIngestionRepository } from '../repositories/ingestionRepository.js';

/**
 * 米国小売売上高(速報、US_RETAIL_SALES)の発表予定(HQ承認 2026-11-05「US_RETAIL_SALES
 * 公式発表日程の自動取り込み実装」): 人が確認した表(ingestion/mappings/retailSalesSchedule.ts)
 * から、指標US_RETAIL_SALESの発表予定をeconomic_eventsに入れる。外部へのアクセスは無い
 * (表を読むだけ)。値は入れない。
 *
 *   npm run ingest:retail-sales-schedule
 *
 * 定期実行には登録していない(表を更新したときに手動で動かす)。前提: 本jobを追加した
 * migrationでeconomic_indicatorsにUS_RETAIL_SALESの行が入っていること。
 * Exit 0 / 1。
 */
async function main(): Promise<void> {
  const env = loadEnv();
  const store = createIngestionRepository(createSupabaseClient(env));
  const result = await runIngestionJob(
    store,
    { provider: RETAIL_SALES_SCHEDULE_PROVIDER, dataType: 'ECONOMIC_EVENT', job: 'ingest:retail-sales-schedule' },
    async (counters) => {
      await ingestRetailSalesSchedule({ store }, counters);
    },
  );
  const d = result.counters.details;
  console.log(
    JSON.stringify({
      job: 'ingest:retail-sales-schedule',
      status: result.status,
      fetched: result.counters.fetched,
      success: result.counters.success,
      inserted: d.inserted,
      updated: d.updated,
      unchanged: d.unchanged,
      past: d.past,
      removed: d.removed,
      skipped: result.counters.skipReasons,
      errors: result.counters.errorMessages,
      at: new Date().toISOString(),
    }),
  );
  if (result.status === 'FAILURE') process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({ job: 'ingest:retail-sales-schedule', error: String(error) }));
  process.exit(1);
});
