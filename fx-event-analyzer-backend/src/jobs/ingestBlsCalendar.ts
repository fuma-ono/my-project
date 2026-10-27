import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { loadEnv } from '../config/env.js';
import { createSupabaseClient } from '../db/supabaseClient.js';
import { BlsAdapter } from '../ingestion/adapters/bls.js';
import { API_CREDIT_CAPS, loadIngestionEnv } from '../ingestion/config.js';
import { CreditGate } from '../ingestion/http.js';
import { ingestCalendarReleases } from '../ingestion/pipelines/economicCalendar.js';
import {
  buildBlsScheduleReleases,
  BLS_SCHEDULE_PROVIDER,
  createBlsNativeResolver,
  createBlsSecondaryResolver,
  findDueBlsEntries,
  planBlsScheduleWrites,
  readOnlyIngestionStore,
  reconcileBlsScheduleRows,
  scheduleObservationRange,
} from '../ingestion/pipelines/blsCalendar.js';
import { BLS_SCHEDULE } from '../ingestion/mappings/blsSchedule.js';
import { JobCounters, runIngestionJob } from '../ingestion/runner.js';
import { createIngestionRepository } from '../repositories/ingestionRepository.js';
import type { IngestionStore } from '../ingestion/store.js';
import type { OfficialValueResolver } from '../ingestion/verification/official.js';

/**
 * 有料カレンダーに依存しない独立経路(HQ判断 2026-10-17): BLSの公式発表
 * スケジュール(mappings/blsSchedule.ts)と、BLS自身の実績値だけで
 * economic_events / event_snapshots を作る。対象は US_CPI・US_NFP と、2026-10-26 に足した
 * US_CORE_CPI・US_UNEMPLOYMENT_RATE・US_AVG_HOURLY_EARNINGS(data-sources.md 16章。BLS への
 * 問い合わせは1回の実行で8回)。詳しい設計は ingestion/pipelines/blsCalendar.ts を参照。
 *
 *   npm run ingest:official:bls-calendar
 *   npm run ingest:official:bls-calendar -- --dry-run   # 書き込まずに、何をするはずかだけ出す
 *
 * HQ指示(2026-10-26)の安全対策:
 * - 取りやめ(blsSchedule.ts の `cancelled`)と、予定表から消えた未発表の行は、発表済みの値の
 *   取り込み(ingestCalendarReleases)の**後で**、別の try/catch で扱う(reconcileBlsScheduleRows)。
 *   ここが失敗しても、過去の発表の取り込みは止まらない。失敗は `schedule_reconcile:` 付きで
 *   errors に入れ、終了コードを1にする。RELEASED の行はどちらでも変えない。
 * - 取り込みの内訳(details.plan: 予定の新規・日時の変更・変更なし、発表の新規・更新・変更なし、
 *   取りやめの行)を、書き込む前に読むだけで数えて ingestion_logs に残す(planBlsScheduleWrites)。
 * - --dry-run: 書き込む関数をすべて断るストア(readOnlyIngestionStore)で同じ処理を読むだけ行い、
 *   内訳と書くはずだった内容を出す。ingestion_logs にも書かない。BLS の API は読む(v1 は25クエリ/日)。
 *
 * HQ指示(2026-10-27「BLS定時実行」):
 * - --if-due: 発表時刻を過ぎたのにまだ RELEASED でないエントリ(findDueBlsEntries)が無ければ、BLS を
 *   1回も呼ばずに終わる(ingestion_logs にも書かない)。定期実行はこれを付ける
 * - --scheduled: クレジット台帳(api_credit_ledger)に AUTOMATIC として予約する(付けなければ MANUAL)
 * - BLS への HTTP は1回ごと(再試行を含む)に台帳で予約してから送る(CreditGate、provider 'bls')。
 *   上限は DB の api_credit_limits('bls': 合計24・自動16/日、UTC の日付)と、1回の実行の runCap(10)。
 *   予約できなければ送らず、その系列の値は入らない(行は SCHEDULED のまま、次の実行で取り直す)。終了コード1
 *   台帳の行が無い DB(migration 20261027000002 の前)では BLS を呼べない
 *
 * BLS_API_KEY は不要(無ければ v1、25クエリ/日)。キー・契約なしで動く。
 * 既存の①(有料カレンダー、economicCalendar.ts)・②(ingest:official)は
 * 一切変更していない。Exit 0 / 1。
 */
async function main(): Promise<void> {
  const env = loadEnv();
  const keys = loadIngestionEnv();
  const store = createIngestionRepository(createSupabaseClient(env));
  const scheduled = process.argv.includes('--scheduled');
  const mode = scheduled ? 'AUTOMATIC' : 'MANUAL';
  if (process.argv.includes('--if-due')) {
    const due = await findDueBlsEntries(store, new Date());
    if (due.length === 0) {
      console.log(
        JSON.stringify({
          job: 'ingest:official:bls-calendar',
          skipped: 'nothing_due',
          mode,
          at: new Date().toISOString(),
        }),
      );
      return;
    }
    console.log(
      JSON.stringify({
        job: 'ingest:official:bls-calendar',
        due: due.map((e) => `${e.indicatorCode}:${e.referencePeriod}`),
      }),
    );
  }
  const gate = new CreditGate(store, {
    provider: 'bls',
    job: 'ingest:official:bls-calendar',
    runId: `${process.env.GITHUB_RUN_ID ?? 'local'}:${randomUUID()}`,
    mode,
    dailyCap: scheduled ? API_CREDIT_CAPS.bls.automatic : API_CREDIT_CAPS.bls.manual,
    runCap: API_CREDIT_CAPS.bls.runCap,
  });
  const bls = new BlsAdapter(keys.BLS_API_KEY, { beforeAttempt: gate.beforeAttempt });
  const resolverErrors: string[] = [];
  const official = createBlsNativeResolver(bls, scheduleObservationRange(BLS_SCHEDULE), (error) =>
    resolverErrors.push(error instanceof Error ? error.message : String(error)),
  );
  // HQ指示(2026-10-25)「過去イベント比較の表も前月と前年必要」: 米国CPIの
  // 前月比(MoM%)を、同じBLS系列(CUUR0000SA0)の別変換として計算する。
  const officialSecondary = createBlsSecondaryResolver(bls, scheduleObservationRange(BLS_SCHEDULE), (error) =>
    resolverErrors.push(error instanceof Error ? error.message : String(error)),
  );

  if (process.argv.includes('--dry-run')) {
    await dryRun(store, official, officialSecondary, resolverErrors, gate);
    return;
  }

  let reconcileErrors = 0;
  const result = await runIngestionJob(
    store,
    { provider: BLS_SCHEDULE_PROVIDER, dataType: 'ECONOMIC_EVENT', job: 'ingest:official:bls-calendar' },
    async (counters) => {
      const built = await buildBlsScheduleReleases({ official, officialSecondary });
      counters.details.not_yet_available = built.notYetAvailable.length;
      counters.details.overdue = built.overdue.map((e) => `${e.indicatorCode}:${e.referencePeriod}`);
      counters.details.unmapped = built.unmapped.length;
      counters.details.cancelled_entries = built.cancelled.length;
      counters.details.plan = await planBlsScheduleWrites(store, built.releases, counters);
      await ingestCalendarReleases(BLS_SCHEDULE_PROVIDER, built.releases, { store, official }, counters);
      // 発表済みの値の取り込みの後。ここで何が起きても、上の取り込みは済んでいる。
      const errorsBefore = counters.errors;
      try {
        await reconcileBlsScheduleRows({ store }, counters);
      } catch (error) {
        counters.error(`schedule_reconcile: ${error instanceof Error ? error.message : String(error)}`);
      }
      reconcileErrors = counters.errors - errorsBefore;
      counters.details.reconcile_errors = reconcileErrors;
      counters.details.bls_requests = gate.reserved;
      counters.details.credit_mode = mode;
      if (gate.refusal) counters.details.credit_refusal = gate.refusal;
    },
  );
  console.log(
    JSON.stringify({
      job: 'ingest:official:bls-calendar',
      status: result.status,
      fetched: result.counters.fetched,
      success: result.counters.success,
      review: result.counters.review,
      skipped: result.counters.skipReasons,
      not_yet_available: result.counters.details.not_yet_available,
      overdue: result.counters.details.overdue,
      unmapped: result.counters.details.unmapped,
      plan: result.counters.details.plan,
      cancelled_entries: result.counters.details.cancelled_entries,
      cancelled_applied: result.counters.details.cancelled_applied,
      cancelled_conflicts: result.counters.details.cancelled_conflicts,
      rows_not_in_table: result.counters.details.rows_not_in_table,
      reconcile_errors: reconcileErrors,
      errors: result.counters.errorMessages,
      resolver_errors: resolverErrors.slice(0, 10),
      bls_requests: gate.reserved,
      credit_mode: mode,
      credit_refusal: gate.refusal,
      at: new Date().toISOString(),
    }),
  );
  if (result.status === 'FAILURE' || reconcileErrors > 0 || gate.refusal) process.exitCode = 1;
}

/**
 * --dry-run(HQ指示 2026-10-26): DB には何も書かない(ingestion_logs も)。書き込む関数を断るストアで、
 * 内訳(plan)と、取りやめ・表から消えた行の点検で書くはずだった内容(dry_run_writes)を出す。
 */
async function dryRun(
  store: IngestionStore,
  official: OfficialValueResolver,
  officialSecondary: OfficialValueResolver,
  resolverErrors: string[],
  gate: CreditGate,
): Promise<void> {
  const readOnly = readOnlyIngestionStore(store);
  const counters = new JobCounters();
  const built = await buildBlsScheduleReleases({ official, officialSecondary });
  const plan = await planBlsScheduleWrites(readOnly, built.releases, counters);
  const reconcile = await reconcileBlsScheduleRows({ store: readOnly, dryRun: true }, counters);
  console.log(
    JSON.stringify({
      job: 'ingest:official:bls-calendar',
      dry_run: true,
      releases_built: built.releases.length,
      not_yet_available: built.notYetAvailable.length,
      overdue: built.overdue.map((e) => `${e.indicatorCode}:${e.referencePeriod}`),
      unmapped: built.unmapped.length,
      cancelled_entries: built.cancelled.length,
      plan,
      reconcile,
      dry_run_writes: counters.details.dry_run_writes ?? [],
      notes: Object.fromEntries(Object.entries(counters.details).filter(([key]) => key !== 'dry_run_writes')),
      errors: counters.errorMessages,
      resolver_errors: resolverErrors.slice(0, 10),
      bls_requests: gate.reserved,
      credit_refusal: gate.refusal,
      at: new Date().toISOString(),
    }),
  );
  if (counters.errors > 0 || gate.refusal) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({ job: 'ingest:official:bls-calendar', error: String(error) }));
  process.exit(1);
});
