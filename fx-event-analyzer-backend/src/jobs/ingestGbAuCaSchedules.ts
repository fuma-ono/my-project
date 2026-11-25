import 'dotenv/config';
import { loadEnv } from '../config/env.js';
import { createSupabaseClient } from '../db/supabaseClient.js';
import { GB_AU_CA_SCHEDULES } from '../ingestion/mappings/gbAuCaSchedule.js';
import { readOnlyIngestionStore } from '../ingestion/pipelines/blsCalendar.js';
import { ingestOfficialScheduleTables } from '../ingestion/pipelines/officialScheduleTable.js';
import { JobCounters, runIngestionJob } from '../ingestion/runner.js';
import { createIngestionRepository } from '../repositories/ingestionRepository.js';

/**
 * 英国(ONS)・豪州(ABS)・カナダ(Statistics Canada)の主要経済指標の公表予定(HQ指示 2026-11-10「6地域の経済指標拡張・
 * 実装準備」): 人が確認した表(ingestion/mappings/gbAuCaSchedule.ts)から economic_events に入れる。外部へのアクセスは
 * 無い(表を読むだけ)。値は入れない(実績値は別の処理)。
 *
 *   npm run ingest:gb-au-ca-schedules
 *   npm run ingest:gb-au-ca-schedules -- --dry-run   # 書かない(ingestion_logs にも)。各エントリで何をするかだけ出す(HQ指示 2026-11-13)
 *
 * 定期実行には登録していない(表を更新したときに手動で動かす)。前提: migration 20261110000002 で7つの指標の行が
 * 入っていること(無ければ、その表は何も書かずにエラー)。Exit 0 / 1。
 */
async function main(): Promise<void> {
  const env = loadEnv();
  const store = createIngestionRepository(createSupabaseClient(env));
  if (process.argv.includes('--dry-run')) {
    // 書き込む関数を断るストアで、同じ処理を読むだけ行う(plan と件数だけ出す)
    const counters = new JobCounters();
    const planned = await ingestOfficialScheduleTables(
      { store: readOnlyIngestionStore(store), tables: GB_AU_CA_SCHEDULES, dryRun: true },
      counters,
    );
    console.log(
      JSON.stringify({
        job: 'ingest:gb-au-ca-schedules',
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
    { provider: 'official_schedule_tables', dataType: 'ECONOMIC_EVENT', job: 'ingest:gb-au-ca-schedules' },
    async (counters) => {
      await ingestOfficialScheduleTables({ store, tables: GB_AU_CA_SCHEDULES }, counters);
    },
  );
  const d = result.counters.details;
  console.log(
    JSON.stringify({
      job: 'ingest:gb-au-ca-schedules',
      status: result.status,
      fetched: result.counters.fetched,
      success: result.counters.success,
      inserted: d.inserted,
      updated: d.updated,
      unchanged: d.unchanged,
      past: d.past,
      removed: d.removed,
      errors: result.counters.errorMessages,
    }),
  );
  process.exitCode = result.status === 'SUCCESS' ? 0 : 1;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
