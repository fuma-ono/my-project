import 'dotenv/config';
import { loadEnv } from '../config/env.js';
import { createSupabaseClient } from '../db/supabaseClient.js';
import { BOJ_ECB_SCHEDULES } from '../ingestion/mappings/centralBankSchedule.js';
import { readOnlyIngestionStore } from '../ingestion/pipelines/blsCalendar.js';
import { ingestOfficialScheduleTables } from '../ingestion/pipelines/officialScheduleTable.js';
import { JobCounters, runIngestionJob } from '../ingestion/runner.js';
import { createIngestionRepository } from '../repositories/ingestionRepository.js';

/**
 * 日銀の金融政策決定会合(BOJ_RATE)と ECB の金融政策会合(EU_ECB_RATE)の日程(HQ指示 2026-11-25): 人が確認した表
 * (ingestion/mappings/centralBankSchedule.ts)から economic_events に入れる。外部へのアクセスは無い(表を読むだけ)。
 * 値(政策金利の決定値)は入れない。発表時刻は公式ページに無いため DATE_ONLY。
 *
 *   npm run ingest:boj-ecb-schedule
 *   npm run ingest:boj-ecb-schedule -- --dry-run   # 書かない(ingestion_logs にも)。各エントリで何をするかだけ出す
 *
 * 定期実行には登録していない(表を更新したときに手動で動かす)。前提: BOJ_RATE の行(seed.sql)と、migration 20261125000002 の
 * EU_ECB_RATE の行と 20261125000003 の economic_event_meetings があること(無ければ、その表は何も書かずにエラー)。Exit 0 / 1。
 */
async function main(): Promise<void> {
  const env = loadEnv();
  const store = createIngestionRepository(createSupabaseClient(env));
  if (process.argv.includes('--dry-run')) {
    // 書き込む関数を断るストアで、同じ処理を読むだけ行う(plan と件数だけ出す)
    const counters = new JobCounters();
    const planned = await ingestOfficialScheduleTables(
      { store: readOnlyIngestionStore(store), tables: BOJ_ECB_SCHEDULES, dryRun: true },
      counters,
    );
    console.log(
      JSON.stringify({
        job: 'ingest:boj-ecb-schedule',
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
    { provider: 'boj_ecb_meeting_schedules', dataType: 'ECONOMIC_EVENT', job: 'ingest:boj-ecb-schedule' },
    async (counters) => {
      await ingestOfficialScheduleTables({ store, tables: BOJ_ECB_SCHEDULES }, counters);
    },
  );
  const d = result.counters.details;
  console.log(
    JSON.stringify({
      job: 'ingest:boj-ecb-schedule',
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
