import 'dotenv/config';
import { loadEnv } from '../config/env.js';
import { createSupabaseClient } from '../db/supabaseClient.js';
import { JP_CPI_SCHEDULE_PROVIDER, ingestJpCpiSchedule } from '../ingestion/pipelines/jpCpiSchedule.js';
import { readOnlyIngestionStore } from '../ingestion/pipelines/blsCalendar.js';
import { JobCounters, runIngestionJob } from '../ingestion/runner.js';
import { createIngestionRepository } from '../repositories/ingestionRepository.js';

/**
 * 日本の消費者物価指数(全国、JP_CPI)の公表予定(HQ指示 2026-11-10「経済指標の網羅性改善」): 人が確認した表
 * (ingestion/mappings/jpCpiSchedule.ts)から、指標 JP_CPI の公表予定を economic_events に入れる。外部へのアクセスは無い
 * (表を読むだけ)。値は入れない。
 *
 *   npm run ingest:jp-cpi-schedule
 *   npm run ingest:jp-cpi-schedule -- --dry-run   # 書かない(ingestion_logs にも)。各エントリで何をするかだけ出す(HQ指示 2026-11-13)
 *
 * 定期実行には登録していない(表を更新したときに手動で動かす)。前提: economic_indicators に JP_CPI の行があること
 * (seed.sql。DEV にはある — 11/10 の SQL で確認)。Exit 0 / 1。
 */
async function main(): Promise<void> {
  const env = loadEnv();
  const store = createIngestionRepository(createSupabaseClient(env));
  if (process.argv.includes('--dry-run')) {
    const counters = new JobCounters();
    const planned = await ingestJpCpiSchedule({ store: readOnlyIngestionStore(store), dryRun: true }, counters);
    console.log(
      JSON.stringify({
        job: 'ingest:jp-cpi-schedule',
        dry_run: true,
        would_insert: planned.inserted,
        would_update: planned.updated,
        unchanged: planned.unchanged,
        past: planned.past,
        removed: planned.removed,
        plan: planned.plan,
        errors: counters.errorMessages,
        at: new Date().toISOString(),
      }),
    );
    process.exitCode = counters.errors > 0 ? 1 : 0;
    return;
  }
  const result = await runIngestionJob(
    store,
    { provider: JP_CPI_SCHEDULE_PROVIDER, dataType: 'ECONOMIC_EVENT', job: 'ingest:jp-cpi-schedule' },
    async (counters) => {
      await ingestJpCpiSchedule({ store }, counters);
    },
  );
  const d = result.counters.details;
  console.log(
    JSON.stringify({
      job: 'ingest:jp-cpi-schedule',
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
  console.error(JSON.stringify({ job: 'ingest:jp-cpi-schedule', error: String(error) }));
  process.exit(1);
});
