import 'dotenv/config';
import { loadEnv } from '../config/env.js';
import { createSupabaseClient } from '../db/supabaseClient.js';
import { PROVIDER_HTTP_SETTINGS } from '../ingestion/config.js';
import { HttpClient } from '../ingestion/http.js';
import { ingestSpeechBodies, SPEECH_BODY_SETTINGS } from '../ingestion/pipelines/speechBodies.js';
import { runIngestionJob } from '../ingestion/runner.js';
import { createIngestionRepository } from '../repositories/ingestionRepository.js';
import { createSpeechBodyStore } from '../repositories/speechBodyRepository.js';

/**
 * 要人発言の公式ページの URL と本文(HQ指示 2026-11-10「要人発言本文の取得・保存機能」、migration 20261110000001)。
 * FRB・ECB の公式サイトの公開ページだけを読む(キー・契約・有料 API なし)。詳細は ingestion/pipelines/speechBodies.ts。
 *
 *   npm run ingest:speech-bodies            # 直近30日の発言
 *   npm run ingest:speech-bodies -- --all   # 過去のすべての発言(1回に読むページは maxFetches 件まで。残りは次の実行で)
 *
 * Needs SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY only. Exit 0 / 1。定時実行には入れていない(HQ の承認の後)。
 */
async function main(): Promise<void> {
  const env = loadEnv();
  const supabase = createSupabaseClient(env);
  const logStore = createIngestionRepository(supabase);
  const bodyStore = createSpeechBodyStore(supabase);
  const settings = process.argv.includes('--all') ? { ...SPEECH_BODY_SETTINGS, pastDays: null } : SPEECH_BODY_SETTINGS;
  const fetchers = {
    frb: new HttpClient('frb', PROVIDER_HTTP_SETTINGS.frb),
    ecb: new HttpClient('ecb', PROVIDER_HTTP_SETTINGS.ecb),
  };
  const result = await runIngestionJob(
    logStore,
    { provider: 'internal', dataType: 'OTHER', job: 'ingest:speech-bodies' },
    async (counters) => {
      await ingestSpeechBodies(bodyStore, fetchers, settings, new Date(), counters);
    },
  );
  console.log(
    JSON.stringify({
      job: 'ingest:speech-bodies',
      status: result.status,
      candidates: result.counters.fetched,
      fetched_bodies: result.counters.success,
      skipped: result.counters.skipReasons,
      failed: result.counters.details.failed ?? [],
      errors: result.counters.errorMessages,
    }),
  );
  process.exitCode = result.status === 'SUCCESS' ? 0 : 1;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
