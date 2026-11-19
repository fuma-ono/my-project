import 'dotenv/config';
import { appendFileSync } from 'node:fs';
import { loadEnv } from '../config/env.js';
import { createSupabaseClient } from '../db/supabaseClient.js';
import { createQualityReader } from '../ingestion/quality/reader.js';
import {
  buildQualityReport,
  escapeWorkflowCommandData,
  MAX_REPORT_DAYS,
  shouldFailOnUnavailable,
} from '../ingestion/quality/run.js';

/**
 * データ品質レポート (HQ判断 2026-10-16、data-sources.md §12): 取得率・欠損率・
 * 照合一致率・時刻ずれ・ジョブの実行間隔・発表前後の足の揃い具合・API クレジットを、
 * 実データ (fx_prices / ingestion_logs / event_snapshots / ingestion_staged_values /
 * economic_events / speech_events / api_credit_usage) から READ-ONLY で集計する
 * (select のみ。insert/update/upsert/delete/rpc は使わない。外部 API も呼ばない)。
 * 実際の集計・Markdown組み立ては ingestion/quality/run.ts(HTTP版 routes/qualityReport.ts
 * と共用)。
 *
 *   npm run report:data-quality                          # 直近7日、有効な全通貨ペア
 *   npm run report:data-quality -- --days 14 --pairs USDJPY,EURUSD
 *
 * Markdown を stdout に出し、GITHUB_STEP_SUMMARY があればそのファイルにも追記する
 * (GitHub Actions の実行画面に出る)。品質が悪くても exit 0(レポートなので)。
 * 落ちたときだけ exit 1。キーや URL は出さない。
 *
 * 一部の章を取得できなかったとき(report_status: PARTIAL): レポートの冒頭の警告と、GitHub の警告の注釈(::warning::)を出す。
 * 既定は exit 0(出力は成功)。`--fail-on-unavailable` を付けると、このときだけ exit 1(日次の workflow には付けていない)。
 */
function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main(): Promise<void> {
  const days = Number(arg('days') ?? '7');
  if (!Number.isInteger(days) || days < 1 || days > MAX_REPORT_DAYS) {
    throw new Error(`--days must be an integer between 1 and ${MAX_REPORT_DAYS} (got ${String(arg('days'))})`);
  }
  const pairsArg = arg('pairs');
  const symbols = pairsArg
    ? pairsArg
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean)
    : null;

  const reader = createQualityReader(createSupabaseClient(loadEnv()));
  const report = await buildQualityReport(reader, { days, symbols, now: new Date() });
  process.stdout.write(report.markdown);
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) appendFileSync(summaryPath, `${report.markdown}\n`, 'utf8');
  if (report.status === 'PARTIAL') {
    // 出力の成功と、データの取得の成功は別。取得できなかった章があることを、ログの注釈にも出す。
    const message = `Quality report is incomplete (chapters unavailable: ${report.chaptersUnavailable.join(',')}): ${report.unavailableReasons.join(' / ')}`;
    if (process.env.GITHUB_ACTIONS === 'true')
      console.log(`::warning title=Quality report incomplete::${escapeWorkflowCommandData(message)}`);
    else console.error(message);
    if (shouldFailOnUnavailable(report.status, process.argv.includes('--fail-on-unavailable'))) process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({ job: 'report:data-quality', error: String(error) }));
  process.exit(1);
});
