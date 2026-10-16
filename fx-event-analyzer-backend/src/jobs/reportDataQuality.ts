import 'dotenv/config';
import { appendFileSync } from 'node:fs';
import { loadEnv } from '../config/env.js';
import { createSupabaseClient } from '../db/supabaseClient.js';
import { buildDataQualityReport, MINUTE_MS } from '../ingestion/quality/metrics.js';
import { createQualityReader } from '../ingestion/quality/reader.js';
import { renderDataQualityMarkdown } from '../ingestion/quality/report.js';

/**
 * データ品質レポート (HQ判断 2026-10-16、data-sources.md §12): 取得率・欠損率・
 * 照合一致率・時刻ずれ・ジョブの実行間隔・発表前後の足の揃い具合を、実データ
 * (fx_prices / ingestion_logs / event_snapshots / ingestion_staged_values /
 * economic_events / speech_events) から READ-ONLY で集計する。
 *
 *   npm run report:data-quality                          # 直近7日、有効な全通貨ペア
 *   npm run report:data-quality -- --days 14 --pairs USDJPY,EURUSD
 *
 * Markdown を stdout に出し、GITHUB_STEP_SUMMARY があればそのファイルにも追記する
 * (GitHub Actions の実行画面に出る)。品質が悪くても exit 0(レポートなので)。
 * 落ちたときだけ exit 1。キーや URL は出さない。
 */

/** The newest minutes are not judged: ingest:fx-prices runs every 20 min, so they may simply not be fetched yet. */
const REPORT_END_LAG_MINUTES = 30;
const MAX_DAYS = 31;

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main(): Promise<void> {
  const days = Number(arg('days') ?? '7');
  if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) {
    throw new Error(`--days must be an integer between 1 and ${MAX_DAYS} (got ${String(arg('days'))})`);
  }
  const pairsArg = arg('pairs');
  const symbols = pairsArg
    ? pairsArg
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean)
    : null;

  const now = new Date();
  const nowMinute = Math.floor(now.getTime() / MINUTE_MS) * MINUTE_MS;
  const from = nowMinute - days * 24 * 60 * MINUTE_MS;
  const to = nowMinute - REPORT_END_LAG_MINUTES * MINUTE_MS;
  const fromIso = new Date(from).toISOString();
  const toIso = new Date(to).toISOString();
  const nowIso = now.toISOString();

  const reader = createQualityReader(createSupabaseClient(loadEnv()));
  const pairs = await reader.listPairs(symbols);
  const pairRows = [];
  for (const pair of pairs) {
    pairRows.push({ symbol: pair.symbol, rows: await reader.listFxRows(pair.id, fromIso, nowIso) });
  }
  const report = buildDataQualityReport({
    now,
    period: { from, to },
    days,
    pairs: pairRows,
    releases: await reader.listReleases(fromIso, toIso),
    logs: await reader.listLogs(fromIso, nowIso),
    snapshots: await reader.listSnapshots(fromIso, nowIso),
    staged: await reader.listStaged(fromIso, nowIso),
  });
  let markdown = renderDataQualityMarkdown(report);
  if (symbols && pairs.length < symbols.length) {
    const found = new Set(pairs.map((p) => p.symbol));
    markdown += `\n> fx_pairs に無い(または無効な)通貨ペア: ${symbols.filter((s) => !found.has(s)).join(', ')}\n`;
  }
  process.stdout.write(markdown);
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) appendFileSync(summaryPath, `${markdown}\n`, 'utf8');
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({ job: 'report:data-quality', error: String(error) }));
  process.exit(1);
});
