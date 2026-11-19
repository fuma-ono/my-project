import 'dotenv/config';
import { loadEnv } from '../config/env.js';
import { createSupabaseClient } from '../db/supabaseClient.js';
import { HttpClient } from '../ingestion/http.js';
import { GB_AU_CA_SCHEDULES } from '../ingestion/mappings/gbAuCaSchedule.js';
import { readOnlyIngestionStore } from '../ingestion/pipelines/blsCalendar.js';
import { runOfficialValues } from '../ingestion/officialValuesRun.js';
import { ingestOfficialValues } from '../ingestion/pipelines/officialValues.js';
import { JobCounters, runIngestionJob } from '../ingestion/runner.js';
import { createIngestionRepository } from '../repositories/ingestionRepository.js';

/**
 * 公式機関の発表値(英国 ONS・カナダ Statistics Canada・豪州 ABS)を RELEASE として保存する(HQ決定 2026-11-10「公式経済指標の
 * 実績値取得・保存処理」)。条件・保存のしかたは ingestion/pipelines/officialValues.ts。キー・契約・有料 API なし。
 *
 *   npm run ingest:official-values
 *   npm run ingest:official-values -- --scheduled # 定時実行用: 取得が全件失敗なら終了コード 1(手動は付けない)
 *   npm run ingest:official-values -- --dry-run   # 公式の API は読むが、DB には書かない(ingestion_logs にも)。plan と値だけ出す(HQ指示 2026-11-13)
 *
 * 継続障害の検知(定時実行だけ。--scheduled): 同じ指標で、ABS の発表日の取得が 3 回連続して失敗なら、実行を失敗にする。
 * **対象は ABS の発表日の取得だけ**(ABS の系列の取得・ONS・Statistics Canada は対象外。ログに release_fetch が無いことは、
 * 正常取得の証拠ではない)。対象の拡大は HQ の別判断。詳細は ingestion/officialValuesRun.ts・ingestion/releaseFetchStreak.ts。
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
  // 定時実行の step だけが --scheduled を付ける。取得が全件失敗のときに実行を失敗(終了コード 1)にするのは、定時実行だけ(手動・dry-run は従来どおり)
  const scheduled = process.argv.includes('--scheduled') && !process.argv.includes('--dry-run');
  if (process.argv.includes('--dry-run')) {
    const counters = new JobCounters();
    const planned = await ingestOfficialValues(
      { store: readOnlyIngestionStore(store), fetcher, tables: GB_AU_CA_SCHEDULES, dryRun: true },
      counters,
    );
    console.log(
      JSON.stringify({
        job: 'ingest:official-values',
        dry_run: true,
        would_publish: planned.published,
        would_revise: planned.revisions,
        pending: planned.pending,
        skipped: counters.skipReasons,
        plan: planned.plan,
        notes: counters.details,
        errors: counters.errorMessages,
        at: new Date().toISOString(),
      }),
    );
    process.exitCode = counters.errors > 0 ? 1 : 0;
    return;
  }
  const result = await runIngestionJob(
    store,
    { provider: 'official_values', dataType: 'ECONOMIC_EVENT', job: 'ingest:official-values' },
    async (counters) => {
      const { fetchWarning, historyWarning } = await runOfficialValues(counters, {
        store,
        fetcher,
        tables: GB_AU_CA_SCHEDULES,
        scheduled,
      });
      if (process.env.GITHUB_ACTIONS === 'true') {
        if (fetchWarning) console.log(`::warning title=official-values partial fetch failure::${fetchWarning}`);
        if (historyWarning) console.log(`::warning title=official-values history unavailable::${historyWarning}`);
      }
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
