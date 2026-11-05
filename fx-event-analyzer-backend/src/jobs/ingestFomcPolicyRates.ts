import 'dotenv/config';
import { loadEnv } from '../config/env.js';
import { createSupabaseClient } from '../db/supabaseClient.js';
import { fetchNyFedTargetRanges } from '../ingestion/adapters/nyFedRates.js';
import { ingestFomcPolicyRates } from '../ingestion/pipelines/fomcPolicyRates.js';
import { JobCounters, runIngestionJob } from '../ingestion/runner.js';
import { createIngestionRepository } from '../repositories/ingestionRepository.js';

/**
 * FOMC の政策決定(誘導目標レンジ)を NY連銀 Markets Data API から fomc_policy_decisions に入れる
 * (HQ承認 2026-11-05「FOMC政策金利の実データ取り込み」案A。pipelines/fomcPolicyRates.ts)。
 *
 *   npm run ingest:fomc-policy-rate
 *
 * 外部へのアクセスは NY連銀の API への1回だけ(キー不要)。economic_events・event_snapshots は変えない。
 * 定期実行・workflow には登録していない(手動で動かす)。
 * 前提: migration 20261105000001(fomc_policy_decisions)が適用済み(無ければ書き込みがエラーになる)。
 * Exit 0 / 1。
 */
const JOB = 'ingest:fomc-policy-rate';

async function main(): Promise<void> {
  const env = loadEnv();
  const store = createIngestionRepository(createSupabaseClient(env));
  const result = await runIngestionJob(
    store,
    { provider: 'nyfed_effr', dataType: 'ECONOMIC_EVENT', job: JOB },
    async (counters: JobCounters) => {
      await ingestFomcPolicyRates({ store, fetchRanges: (start, end) => fetchNyFedTargetRanges(start, end) }, counters);
    },
  );
  console.log(
    JSON.stringify({
      job: JOB,
      status: result.status,
      ...result.counters.details,
      skipped: result.counters.skipReasons,
      errors: result.counters.errorMessages,
      at: new Date().toISOString(),
    }),
  );
  if (result.status === 'FAILURE') process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({ job: JOB, error: String(error) }));
  process.exit(1);
});
