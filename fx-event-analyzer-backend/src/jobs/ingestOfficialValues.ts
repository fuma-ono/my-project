import 'dotenv/config';
import { loadEnv } from '../config/env.js';
import { createSupabaseClient } from '../db/supabaseClient.js';
import { HttpClient } from '../ingestion/http.js';
import { GB_AU_CA_SCHEDULES } from '../ingestion/mappings/gbAuCaSchedule.js';
import { readOnlyIngestionStore } from '../ingestion/pipelines/blsCalendar.js';
import {
  caCoreAnnotations,
  ingestCaCoreCpiValues,
  validateCaCoreSources,
  type CaCoreCpiResult,
} from '../ingestion/pipelines/caCoreCpiValues.js';
import { ingestOfficialValues } from '../ingestion/pipelines/officialValues.js';
import { JobCounters, runIngestionJob } from '../ingestion/runner.js';
import { createIngestionRepository } from '../repositories/ingestionRepository.js';

function coreOutput(core: CaCoreCpiResult) {
  return {
    ca_core_cpi: { published: core.published, pending: core.pending, plan: core.plan },
    revision_detection: core.revision_detection,
    revision_observations: core.revision_observations,
    same_day_diff: core.same_day_diff,
    deadline_warnings: core.deadline_warnings,
  };
}

/**
 * 公式機関の発表値(英国 ONS・カナダ Statistics Canada・豪州 ABS)を RELEASE として保存する(HQ決定 2026-11-10「公式経済指標の
 * 実績値取得・保存処理」)。条件・保存のしかたは ingestion/pipelines/officialValues.ts。キー・契約・有料 API なし。
 *
 *   npm run ingest:official-values
 *   npm run ingest:official-values -- --dry-run   # 公式の API は読むが、DB には書かない(ingestion_logs にも)。plan と値だけ出す(HQ指示 2026-11-13)
 *
 * カナダのコアCPI(CA_CPI_TRIM・CA_CPI_MEDIAN)の初回値も、同じ target で取り込む(設計書 ca-cpi-detailed-design.md §16.15.1
 * 第1段階。pipelines/caCoreCpiValues.ts。改定の検知・書き込みはしない)。出力には ca_core_cpi・revision_detection・
 * revision_observations・same_day_diff・deadline_warnings を足す(既存の項目は変えない)。
 *
 * 定期実行には登録していない(HQ の承認の後)。前提: migration 20261110000002 と、ingest:gb-au-ca-schedules で公表予定が
 * 入っていること。Exit 0 / 1。
 */
async function main(): Promise<void> {
  validateCaCoreSources(); // 受付期間の設定漏れ・改定モードの誤りは、取得・書き込みの前に止める
  const env = loadEnv();
  const store = createIngestionRepository(createSupabaseClient(env));
  const fetcher = new HttpClient('official_values', {
    minIntervalMs: 2_000,
    timeoutMs: 20_000,
    maxRetries: 2,
    backoffMs: 2_000,
  });
  if (process.argv.includes('--dry-run')) {
    const counters = new JobCounters();
    const planned = await ingestOfficialValues(
      { store: readOnlyIngestionStore(store), fetcher, tables: GB_AU_CA_SCHEDULES, dryRun: true },
      counters,
    );
    const core = await ingestCaCoreCpiValues(
      { store: readOnlyIngestionStore(store), fetcher, tables: GB_AU_CA_SCHEDULES, dryRun: true },
      counters,
    );
    for (const line of caCoreAnnotations(core)) console.log(line);
    console.log(
      JSON.stringify({
        job: 'ingest:official-values',
        dry_run: true,
        would_publish: planned.published,
        would_revise: planned.revisions,
        pending: planned.pending,
        skipped: counters.skipReasons,
        plan: planned.plan,
        ...coreOutput(core),
        notes: counters.details,
        errors: counters.errorMessages,
        at: new Date().toISOString(),
      }),
    );
    process.exitCode = counters.errors > 0 ? 1 : 0;
    return;
  }
  const held: { core: CaCoreCpiResult | null } = { core: null };
  const result = await runIngestionJob(
    store,
    { provider: 'official_values', dataType: 'ECONOMIC_EVENT', job: 'ingest:official-values' },
    async (counters) => {
      await ingestOfficialValues({ store, fetcher, tables: GB_AU_CA_SCHEDULES }, counters);
      held.core = await ingestCaCoreCpiValues({ store, fetcher, tables: GB_AU_CA_SCHEDULES }, counters);
    },
  );
  if (held.core) for (const line of caCoreAnnotations(held.core)) console.log(line);
  console.log(
    JSON.stringify({
      job: 'ingest:official-values',
      status: result.status,
      published: result.counters.details.published,
      revisions: result.counters.details.revisions,
      pending: result.counters.details.pending,
      skipped: result.counters.skipReasons,
      ...(held.core ? coreOutput(held.core) : {}),
      errors: result.counters.errorMessages,
    }),
  );
  process.exitCode = result.status === 'SUCCESS' ? 0 : 1;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
