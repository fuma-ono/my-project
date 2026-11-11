import 'dotenv/config';
import { loadEnv } from '../config/env.js';
import { createSupabaseClient } from '../db/supabaseClient.js';
import { redactAppId } from '../ingestion/adapters/estatCpi.js';
import { HttpClient } from '../ingestion/http.js';
import { readOnlyIngestionStore } from '../ingestion/pipelines/blsCalendar.js';
import { ingestJpCpiValues } from '../ingestion/pipelines/jpCpiValues.js';
import { JobCounters, runIngestionJob } from '../ingestion/runner.js';
import { createIngestionRepository } from '../repositories/ingestionRepository.js';

/**
 * JP_CPI(全国・総合・前年同月比)の初回の公表値を e-Stat の API から取り、RELEASE として保存する(HQ指示 2026-11-11)。
 * 条件・保存のしかたは ingestion/pipelines/jpCpiValues.ts。
 *
 *   npm run ingest:official:jp-cpi-values              # 書く
 *   npm run ingest:official:jp-cpi-values -- --dry-run # 書かない(ingestion_logs にも書かない)。各回で何をするかだけ出す
 *
 * 必要な環境変数: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY、ESTAT_APP_ID(GitHub Actions の Secret。出力・ログには出さない)。
 * 前提: ingest:jp-cpi-schedule で公表予定が入っていること。定期実行には入れていない(HQ の承認の後)。Exit 0 / 1。
 */
async function main(): Promise<void> {
  const appId = process.env.ESTAT_APP_ID?.trim();
  if (!appId) {
    console.error('ESTAT_APP_ID is not set');
    process.exitCode = 1;
    return;
  }
  const env = loadEnv();
  const store = createIngestionRepository(createSupabaseClient(env));
  const fetcher = new HttpClient('estat', { minIntervalMs: 2_000, timeoutMs: 20_000, maxRetries: 2, backoffMs: 2_000 });
  const dryRun = process.argv.includes('--dry-run');

  if (dryRun) {
    const counters = new JobCounters();
    const result = await ingestJpCpiValues({ store: readOnlyIngestionStore(store), fetcher, appId, dryRun }, counters);
    console.log(
      redactAppId(
        JSON.stringify({
          job: 'ingest:official:jp-cpi-values',
          dry_run: true,
          candidates: counters.fetched,
          plan: result.plan,
          skipped: counters.skipReasons,
          notes: counters.details,
          errors: counters.errorMessages,
          at: new Date().toISOString(),
        }),
      ),
    );
    if (counters.errors > 0) process.exitCode = 1;
    return;
  }

  const result = await runIngestionJob(
    store,
    { provider: 'estat_cpi', dataType: 'ECONOMIC_EVENT', job: 'ingest:official:jp-cpi-values' },
    async (counters) => {
      await ingestJpCpiValues({ store, fetcher, appId }, counters);
    },
  );
  console.log(
    redactAppId(
      JSON.stringify({
        job: 'ingest:official:jp-cpi-values',
        status: result.status,
        published: result.counters.details.published,
        revisions: result.counters.details.revisions,
        pending: result.counters.details.pending,
        skipped: result.counters.skipReasons,
        errors: result.counters.errorMessages,
      }),
    ),
  );
  if (result.status !== 'SUCCESS') process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(redactAppId(error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
});
