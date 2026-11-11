import 'dotenv/config';
import { loadEnv } from '../config/env.js';
import { createSupabaseClient } from '../db/supabaseClient.js';
import {
  ingestSpeechSummaries,
  SPEECH_SUMMARY_SETTINGS,
  type SpeechSummaryStore,
} from '../ingestion/pipelines/speechSummaries.js';
import { JobCounters, runIngestionJob } from '../ingestion/runner.js';
import { createIngestionRepository } from '../repositories/ingestionRepository.js';
import { createSpeechSummaryStore } from '../repositories/speechSummaryRepository.js';

/**
 * 要人発言の要約を作る(本文の取得とは別の工程。HQ指示 2026-11-11)。設計は pipelines/speechSummaries.ts。外部 API なし。
 *
 *   npm run ingest:speech-summaries                      # 直近30日の、本文が取れて要約がまだ無い発言
 *   npm run ingest:speech-summaries -- --all             # 過去のすべての発言に適用する
 *   npm run ingest:speech-summaries -- --all --dry-run   # 書かない。対象と、READY / FAILED になるはずの内訳だけ出す
 *
 * --dry-run: DB に書かない(ingestion_logs にも書かない。書き込みの関数は呼ばれたら失敗する)。要約の本文は出さない
 * (文字数だけ)。出力に認証情報は出さない。
 * 前提: migration 20261110000001(本文)・20261111000001(要約の列)。定期実行には入れていない(HQ の承認の後)。Exit 0 / 1。
 */
function readOnlySummaryStore(store: SpeechSummaryStore): SpeechSummaryStore {
  return {
    listSpeechesNeedingSummary: (sinceIso, limit) => store.listSpeechesNeedingSummary(sinceIso, limit),
    updateSpeechSummary: () => Promise.reject(new Error('dry-run: updateSpeechSummary is not allowed')),
  };
}

async function main(): Promise<void> {
  const supabase = createSupabaseClient(loadEnv());
  const all = process.argv.includes('--all');
  const dryRun = process.argv.includes('--dry-run');
  const settings = { ...SPEECH_SUMMARY_SETTINGS, ...(all ? { pastDays: null } : {}), dryRun };
  const store = createSpeechSummaryStore(supabase);

  if (dryRun) {
    const counters = new JobCounters();
    const { ready, failed, plan } = await ingestSpeechSummaries(
      readOnlySummaryStore(store),
      settings,
      new Date(),
      counters,
    );
    console.log(
      JSON.stringify({
        job: 'ingest:speech-summaries',
        dry_run: true,
        all,
        max_per_run: settings.maxSpeeches,
        candidates: counters.fetched,
        would_be_ready: ready,
        would_fail: failed,
        order: 'statement_datetime ascending',
        plan,
        at: new Date().toISOString(),
      }),
    );
    return;
  }

  const result = await runIngestionJob(
    createIngestionRepository(supabase),
    { provider: 'speech_summary', dataType: 'OTHER', job: 'ingest:speech-summaries' },
    async (counters) => {
      await ingestSpeechSummaries(store, settings, new Date(), counters);
    },
  );
  console.log(
    JSON.stringify({
      job: 'ingest:speech-summaries',
      all,
      status: result.status,
      details: result.counters.details,
      skipped: result.counters.skipReasons,
      errors: result.counters.errorMessages,
    }),
  );
  if (result.status !== 'SUCCESS') process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
