import 'dotenv/config';
import { loadEnv } from '../config/env.js';
import { createSupabaseClient } from '../db/supabaseClient.js';
import { BlsAdapter } from '../ingestion/adapters/bls.js';
import { loadIngestionEnv } from '../ingestion/config.js';
import {
  BLS_SCHEDULE_PROVIDER,
  createBlsNativeResolver,
  OVERDUE_AFTER_DAYS,
  readOnlyIngestionStore,
  runBlsCalendarIngestion,
  scheduleObservationRange,
  syncBlsScheduledEvents,
} from '../ingestion/pipelines/blsCalendar.js';
import { BLS_SCHEDULE } from '../ingestion/mappings/blsSchedule.js';
import { JobCounters, runIngestionJob } from '../ingestion/runner.js';
import type { IngestionStore } from '../ingestion/store.js';
import { createIngestionRepository } from '../repositories/ingestionRepository.js';

const JOB = 'ingest:official:bls-calendar';

/**
 * 有料カレンダーに依存しない独立経路(HQ判断 2026-10-17): BLSの公式発表
 * スケジュール(mappings/blsSchedule.ts)と、BLS自身の実績値だけで
 * economic_events / event_snapshots を作る。対象は US_CPI・US_NFP のみ
 * (この2指標だけ economic_indicators に行があり、BLSの公式系列でまだ
 * 揃う)。詳しい設計は ingestion/pipelines/blsCalendar.ts を参照。
 *
 *   npm run ingest:official:bls-calendar
 *   npm run ingest:official:bls-calendar -- --dry-run   # 書き込みなしの事前確認
 *
 * 未来の発表(表にある、まだ時刻が来ていないもの)は BLS API を呼ばず表だけで
 * SCHEDULED 行として登録・日付更新・CANCELLED 化する(syncBlsScheduledEvents)。
 * 予定行の処理が失敗しても発表後の経路は実行し、失敗は errors /
 * scheduled_sync_errors に残して終了コード1にする(runBlsCalendarIngestion)。
 * 手動実行専用(定期実行への組み込みは未承認)。
 *
 * --dry-run: 予定行の処理だけを、書き込みを拒否するストア越しに実行し、
 * 書き込むはずだった内容(dry_run_writes)と件数を出力する。BLS API・発表後の
 * 経路・ingestion_logs への記録はすべて行わない(DBへの書き込みは0)。
 *
 * BLS_API_KEY は不要(無ければ v1、25クエリ/日)。キー・契約なしで動く。
 * 既存の①(有料カレンダー、economicCalendar.ts)・②(ingest:official)は
 * 一切変更していない。Exit 0 / 1。
 */
async function main(): Promise<void> {
  const env = loadEnv();
  const store = createIngestionRepository(createSupabaseClient(env));
  if (process.argv.includes('--dry-run')) {
    await dryRun(store);
    return;
  }
  const keys = loadIngestionEnv();
  const bls = new BlsAdapter(keys.BLS_API_KEY);
  const resolverErrors: string[] = [];
  const official = createBlsNativeResolver(bls, scheduleObservationRange(BLS_SCHEDULE), (error) =>
    resolverErrors.push(error instanceof Error ? error.message : String(error)),
  );

  let scheduledSyncErrors = 0;
  const result = await runIngestionJob(
    store,
    { provider: BLS_SCHEDULE_PROVIDER, dataType: 'ECONOMIC_EVENT', job: JOB },
    async (counters) => {
      // 未来の予定行を先に(表だけ、BLS API なし)。失敗しても発表後の経路は続ける。
      ({ scheduledSyncErrors } = await runBlsCalendarIngestion({ store, official }, counters));
    },
  );
  console.log(
    JSON.stringify({
      job: JOB,
      status: result.status,
      fetched: result.counters.fetched,
      success: result.counters.success,
      review: result.counters.review,
      skipped: result.counters.skipReasons,
      scheduled_sync_errors: scheduledSyncErrors,
      scheduled_inserted: result.counters.details.scheduled_inserted,
      scheduled_updated: result.counters.details.scheduled_updated,
      scheduled_unchanged: result.counters.details.scheduled_unchanged,
      cancelled: result.counters.details.cancelled,
      cancelled_unchanged: result.counters.details.cancelled_unchanged,
      schedule_rescheduled: result.counters.details.schedule_rescheduled ?? [],
      schedule_entry_conflict: result.counters.details.schedule_entry_conflict ?? [],
      schedule_rows_not_in_table: result.counters.details.schedule_rows_not_in_table ?? [],
      not_yet_available: result.counters.details.not_yet_available,
      // Scheduled date OVERDUE_AFTER_DAYS+ ago and still no BLS value: check BLS's page and fix blsSchedule.ts.
      overdue: result.counters.details.overdue,
      overdue_after_days: OVERDUE_AFTER_DAYS,
      unmapped: result.counters.details.unmapped,
      errors: result.counters.errorMessages,
      resolver_errors: resolverErrors.slice(0, 10),
      at: new Date().toISOString(),
    }),
  );
  if (result.status === 'FAILURE' || scheduledSyncErrors > 0) process.exitCode = 1;
}

/** --dry-run: 読み取りだけで「この実行で何が書き込まれるか」を出す(dev-environment.md §11)。 */
async function dryRun(store: IngestionStore): Promise<void> {
  const counters = new JobCounters();
  let aborted: string | null = null;
  try {
    await syncBlsScheduledEvents({ store: readOnlyIngestionStore(store), dryRun: true }, counters);
  } catch (error) {
    aborted = error instanceof Error ? error.message : String(error);
  }
  const d = counters.details;
  console.log(
    JSON.stringify({
      job: JOB,
      dry_run: true,
      would_insert_scheduled: d.scheduled_inserted,
      would_update_scheduled: d.scheduled_updated,
      scheduled_unchanged: d.scheduled_unchanged,
      would_cancel: d.cancelled,
      cancelled_unchanged: d.cancelled_unchanged,
      dry_run_writes: d.dry_run_writes ?? [],
      schedule_entry_conflict: d.schedule_entry_conflict ?? [],
      schedule_rows_not_in_table: d.schedule_rows_not_in_table ?? [],
      indicator_not_in_db: d.indicator_not_in_db ?? [],
      errors: aborted ? [...counters.errorMessages, `aborted: ${aborted}`] : counters.errorMessages,
      at: new Date().toISOString(),
    }),
  );
  if (aborted || counters.errors > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({ job: JOB, error: String(error) }));
  process.exit(1);
});
