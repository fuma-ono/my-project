import 'dotenv/config';
import { loadEnv } from '../config/env.js';
import { createSupabaseClient } from '../db/supabaseClient.js';
import { HttpClient } from '../ingestion/http.js';
import { GB_AU_CA_SCHEDULES } from '../ingestion/mappings/gbAuCaSchedule.js';
import { ingestOfficialValues } from '../ingestion/pipelines/officialValues.js';
import { runIngestionJob } from '../ingestion/runner.js';
import { createIngestionRepository } from '../repositories/ingestionRepository.js';

/**
 * 公式機関の発表値(英国 ONS・カナダ Statistics Canada・豪州 ABS)を RELEASE として保存する(HQ決定 2026-11-10「公式経済指標の
 * 実績値取得・保存処理」)。条件・保存のしかたは ingestion/pipelines/officialValues.ts。キー・契約・有料 API なし。
 *
 *   npm run ingest:official-values
 *
 * 定期実行には登録していない(HQ の承認の後)。前提: migration 20261110000002 と、ingest:gb-au-ca-schedules で公表予定が
 * 入っていること。Exit 0 / 1。
 */
async function main(): Promise<void> {
  const env = loadEnv();
  const store = createIngestionRepository(createSupabaseClient(env));
  const fetcher = new HttpClient('official_values', {
    minIntervalMs: 2_000,
    timeoutMs: 20_000,
    maxRetries: 2,
    backoffMs: 2_000,
  });
  const result = await runIngestionJob(
    store,
    { provider: 'official_values', dataType: 'ECONOMIC_EVENT', job: 'ingest:official-values' },
    async (counters) => {
      await ingestOfficialValues({ store, fetcher, tables: GB_AU_CA_SCHEDULES }, counters);
    },
  );
  console.log(
    JSON.stringify({
      job: 'ingest:official-values',
      status: result.status,
      published: result.counters.details.published,
      revisions: result.counters.details.revisions,
      pending: result.counters.details.pending,
      skipped: result.counters.skipReasons,
      errors: result.counters.errorMessages,
    }),
  );
  process.exitCode = result.status === 'SUCCESS' ? 0 : 1;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
