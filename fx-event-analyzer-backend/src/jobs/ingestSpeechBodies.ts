import 'dotenv/config';
import { loadEnv } from '../config/env.js';
import { createSupabaseClient } from '../db/supabaseClient.js';
import { PROVIDER_HTTP_SETTINGS } from '../ingestion/config.js';
import { assertDevTarget } from '../ingestion/devTarget.js';
import { HttpClient } from '../ingestion/http.js';
import {
  FRB_SPEECHES_JSON_URL,
  FRB_SPEECHES_RSS_URL,
  ingestSpeechBodies,
  SPEECH_BODY_SETTINGS,
  type SpeechBodyFetcher,
  type SpeechBodyStore,
} from '../ingestion/pipelines/speechBodies.js';
import { JobCounters, runIngestionJob } from '../ingestion/runner.js';
import { parseSpeechJobOptions } from '../ingestion/speechJobOptions.js';
import { createIngestionRepository } from '../repositories/ingestionRepository.js';
import { createSpeechBodyStore } from '../repositories/speechBodyRepository.js';

/**
 * 要人発言の公式ページの URL と本文(HQ指示 2026-11-10「要人発言本文の取得・保存機能」、migration 20261110000001)。
 * FRB・ECB の公式サイトの公開ページだけを読む(キー・契約・有料 API なし)。詳細は ingestion/pipelines/speechBodies.ts。
 *
 *   npm run ingest:speech-bodies                        # 直近30日の発言
 *   npm run ingest:speech-bodies -- --all               # 過去のすべての発言(1回に読むページは maxFetches 件まで。残りは次の実行で)
 *   npm run ingest:speech-bodies -- --all --dry-run     # 書かない・本文のページを読まない。対象と、各発言で何をするかだけ出す
 *   npm run ingest:speech-bodies -- --scheduled         # 定期実行: 発言日時が直近14日(PENDING・FAILED とも1行3回まで)
 *
 * 始める前に、接続先が DEV であることを確かめる(ingestion/devTarget.ts。DEV でなければ何も読まず・書かずに止まる)。
 *
 * --dry-run(HQ指示 2026-11-11「実行前に対象件数を確認」): DB に書かない(ingestion_logs にも書かない)。書き込みの関数は
 * 呼ばれたら失敗するストアを使い、読むのは FRB の講演の RSS と一覧の JSON だけ(それ以外の URL は失敗させる)。
 * 出力に認証情報は出さない(発言の id・日時・公式ページの URL・件数だけ)。
 *
 * Needs SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY only. Exit 0 / 1。定時実行には入れていない(HQ の承認の後)。
 */
function readOnlyBodyStore(store: SpeechBodyStore): SpeechBodyStore {
  return {
    listSpeechesNeedingBody: (providers, sinceIso, maxAttempts) =>
      store.listSpeechesNeedingBody(providers, sinceIso, maxAttempts),
    listFrbRowsForMatching: () => store.listFrbRowsForMatching(),
    claimBodyAttempt: () => Promise.reject(new Error('dry-run: claimBodyAttempt is not allowed')),
    updateSpeechBody: () => Promise.reject(new Error('dry-run: updateSpeechBody is not allowed')),
  };
}

function listOnlyFetcher(fetcher: SpeechBodyFetcher): SpeechBodyFetcher {
  const allowed = new Set([FRB_SPEECHES_RSS_URL, FRB_SPEECHES_JSON_URL]);
  return {
    getText: (url) =>
      allowed.has(url) ? fetcher.getText(url) : Promise.reject(new Error(`dry-run: ${url} is not read`)),
  };
}

async function main(): Promise<void> {
  assertDevTarget(process.env);
  const options = parseSpeechJobOptions(process.argv);
  const env = loadEnv();
  const supabase = createSupabaseClient(env);
  const bodyStore = createSpeechBodyStore(supabase);
  const all = options.mode === 'all';
  const dryRun = options.dryRun;
  const settings = { ...SPEECH_BODY_SETTINGS, pastDays: options.pastDays, dryRun };
  const fetchers = {
    frb: new HttpClient('frb', PROVIDER_HTTP_SETTINGS.frb),
    ecb: new HttpClient('ecb', PROVIDER_HTTP_SETTINGS.ecb),
  };

  if (dryRun) {
    const counters = new JobCounters();
    const { plan } = await ingestSpeechBodies(
      readOnlyBodyStore(bodyStore),
      { frb: listOnlyFetcher(fetchers.frb), ecb: listOnlyFetcher(fetchers.ecb) },
      settings,
      new Date(),
      counters,
    );
    const byAction: Record<string, number> = {};
    for (const item of plan) byAction[item.action] = (byAction[item.action] ?? 0) + 1;
    console.log(
      JSON.stringify({
        job: 'ingest:speech-bodies',
        dry_run: true,
        mode: options.mode,
        all,
        max_fetches_per_run: settings.maxFetches,
        candidates: counters.fetched,
        by_action: byAction,
        order: 'statement_datetime ascending',
        plan,
        errors: counters.errorMessages,
        at: new Date().toISOString(),
      }),
    );
    process.exitCode = counters.errors > 0 ? 1 : 0;
    return;
  }

  const result = await runIngestionJob(
    createIngestionRepository(supabase),
    { provider: 'internal', dataType: 'OTHER', job: 'ingest:speech-bodies' },
    async (counters) => {
      await ingestSpeechBodies(bodyStore, fetchers, settings, new Date(), counters);
    },
  );
  console.log(
    JSON.stringify({
      job: 'ingest:speech-bodies',
      mode: options.mode,
      all,
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
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
