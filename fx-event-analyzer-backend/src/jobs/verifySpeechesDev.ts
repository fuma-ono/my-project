import 'dotenv/config';
import { loadEnv } from '../config/env.js';
import { createSupabaseClient } from '../db/supabaseClient.js';
import { assertDevTarget } from '../ingestion/devTarget.js';
import { readOnly, type ReadOnlyDb } from '../ingestion/verify/readOnlyDb.js';
import {
  annotation,
  buildSpeechDevReport,
  summarizeRuns,
  type VerifyRunRow,
  type VerifySpeechRow,
} from '../ingestion/verify/speechDevReport.js';

/**
 * DEV の要人発言の読み取り専用の確認(HQ指示 2026-11-12)。ワークフロー fx-event-analyzer-dev-verify.yml から動かす。
 *
 *   npm run verify:speeches-dev
 *
 * - 始める前に、接続先が DEV であることを確かめる(ingestion/devTarget.ts)。
 * - DB は読むだけ: 下の readOnly の入口は select しか持たない(insert・update・upsert・delete・rpc を呼べない)。
 * - 出力は件数・状態別の内訳・指紋・id・公式 URL・日時・回数・API の状態コードだけ(本文・要約の中身、鍵は出さない)。
 *   GitHub Actions の注記(::notice)として出すので、公開リポジトリの check-run の注記で読める。
 */
const SPEECH_COLUMNS =
  'id, provider, status, body_status, body_error, source_url, body_attempts, body_last_attempt_at, body_fetched_at, summary_method, summary_error, summary_generated_at, statement_datetime, speech_body, summary, title';

async function readSpeeches(db: ReadOnlyDb): Promise<VerifySpeechRow[]> {
  const { data, error } = await db
    .from('speech_events')
    .select(SPEECH_COLUMNS)
    .order('id', { ascending: true })
    .range(0, 4999);
  if (error) throw new Error(`speech_events: ${error.message}`);
  return (data ?? []) as unknown as VerifySpeechRow[];
}

async function readRuns(db: ReadOnlyDb): Promise<VerifyRunRow[]> {
  const { data, error } = await db
    .from('ingestion_logs')
    .select('job, started_at, status, fetched_count, success_count, error_count, details')
    .in('job', ['ingest:speech-bodies', 'ingest:speech-summaries'])
    .order('started_at', { ascending: false })
    .limit(6);
  if (error) throw new Error(`ingestion_logs: ${error.message}`);
  return (data ?? []) as unknown as VerifyRunRow[];
}

async function status(url: string): Promise<number | string> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(90_000) });
    return res.status;
  } catch (error) {
    return error instanceof Error ? error.name : 'ERROR';
  }
}

async function main(): Promise<void> {
  const { ref } = assertDevTarget(process.env);
  const db = readOnly(createSupabaseClient(loadEnv()));
  const now = new Date();
  const report = buildSpeechDevReport(await readSpeeches(db), now);
  const runs = summarizeRuns(await readRuns(db));
  const api = process.env.DEV_API_BASE_URL?.replace(/\/+$/, '');
  const apiStatus = api
    ? { health: await status(`${api}/health`), speeches_without_login: await status(`${api}/api/v1/speeches`) }
    : { skipped: 'DEV_API_BASE_URL is not set' };
  const lines = [
    annotation('verify 1 summary', {
      dev: ref,
      at: report.at,
      total: report.total,
      byState: report.byState,
      attempts: report.attempts,
      attempted: report.attempted,
      fingerprints: report.fingerprints,
    }),
    annotation('verify 2 ecb', report.ecb),
    annotation('verify 3 frb future', report.frbFuture),
    annotation('verify 4 frb rows a', report.frbRows.slice(0, 8)),
    annotation('verify 5 frb rows b', report.frbRows.slice(8)),
    annotation('verify 6 runs', runs),
    annotation('verify 7 api', apiStatus),
  ];
  for (const line of lines) console.log(line);
}

main().catch((error: unknown) => {
  // 鍵・URL は assertDevTarget のエラーにも入らない。DB のエラーは文だけ。
  console.log(annotation('verify error', { error: error instanceof Error ? error.message.slice(0, 300) : 'unknown' }));
  process.exitCode = 1;
});
