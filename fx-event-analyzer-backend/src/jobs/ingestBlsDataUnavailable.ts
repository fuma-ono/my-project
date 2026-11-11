import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { loadEnv } from '../config/env.js';
import { createSupabaseClient } from '../db/supabaseClient.js';
import { BlsAdapter } from '../ingestion/adapters/bls.js';
import { API_CREDIT_CAPS, loadIngestionEnv } from '../ingestion/config.js';
import { CreditGate } from '../ingestion/http.js';
import { BLS_DATA_UNAVAILABLE } from '../ingestion/mappings/blsDataUnavailable.js';
import { applyBlsDataUnavailable } from '../ingestion/pipelines/blsDataUnavailable.js';
import { JobCounters, runIngestionJob } from '../ingestion/runner.js';
import { createBlsDataUnavailableStore } from '../repositories/blsDataUnavailableRepository.js';
import { createIngestionRepository } from '../repositories/ingestionRepository.js';

/**
 * BLS が前年比の元の月を公表していない回(mappings/blsDataUnavailable.ts の表の回だけ)を DATA_UNAVAILABLE の発表済みにする
 * (HQ指示 2026-11-11「CPI 2026-11-10 DATA_UNAVAILABLE 対応(案A)」)。設計は pipelines/blsDataUnavailable.ts。
 *
 *   npm run ingest:official:bls-data-unavailable -- --dry-run   # 書かずに、書くはずの内容だけ出す
 *   npm run ingest:official:bls-data-unavailable                # 書く(HQ の承認の後)
 *
 * BLS への HTTP は1回(表の系列をまとめて。台帳で予約、provider 'bls'、手動の枠)。値は書かない(状態と理由だけ)。
 * 定期実行には入れない。Exit 0 / 1。
 */
async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const env = loadEnv();
  const keys = loadIngestionEnv();
  const supabase = createSupabaseClient(env);
  const ingestion = createIngestionRepository(supabase);
  const gate = new CreditGate(ingestion, {
    provider: 'bls',
    job: 'ingest:official:bls-data-unavailable',
    runId: `${process.env.GITHUB_RUN_ID ?? 'local'}:${randomUUID()}`,
    mode: 'MANUAL',
    dailyCap: API_CREDIT_CAPS.bls.manual,
    runCap: API_CREDIT_CAPS.bls.runCap,
  });
  const adapter = new BlsAdapter(keys.BLS_API_KEY, { beforeAttempt: gate.beforeAttempt });
  const periods = BLS_DATA_UNAVAILABLE.flatMap((e) => [e.missingPeriod, e.referencePeriod]).sort();
  const observations = await adapter.fetchManyObservations({
    seriesIds: [...new Set(BLS_DATA_UNAVAILABLE.map((e) => e.seriesId))],
    observationStart: `${periods[0]}-01`,
    observationEnd: `${periods.at(-1)}-01`,
  });
  const store = createBlsDataUnavailableStore(supabase);

  if (dryRun) {
    const counters = new JobCounters();
    const result = await applyBlsDataUnavailable(
      { store, entries: BLS_DATA_UNAVAILABLE, observations, dryRun: true },
      counters,
    );
    console.log(
      JSON.stringify({
        job: 'ingest:official:bls-data-unavailable',
        dry_run: true,
        ...result,
        at: new Date().toISOString(),
      }),
    );
    return;
  }
  const run = await runIngestionJob(
    ingestion,
    { provider: 'bls_schedule', dataType: 'ECONOMIC_EVENT', job: 'ingest:official:bls-data-unavailable' },
    async (counters) => {
      await applyBlsDataUnavailable({ store, entries: BLS_DATA_UNAVAILABLE, observations }, counters);
    },
  );
  console.log(
    JSON.stringify({
      job: 'ingest:official:bls-data-unavailable',
      status: run.status,
      details: run.counters.details,
      skipped: run.counters.skipReasons,
      errors: run.counters.errorMessages,
      at: new Date().toISOString(),
    }),
  );
  if (run.status !== 'SUCCESS') process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
