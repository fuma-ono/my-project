/**
 * Builds the data-quality Markdown report from a QualityReader (reader.ts).
 * Shared by the CLI job (src/jobs/reportDataQuality.ts) and the HTTP route
 * (src/routes/qualityReport.ts, HQ判断 2026-10-17「実機で確認できる品質レポート」)
 * so both read the same data the same way. READ-ONLY, no external API calls.
 */
import { MINUTE_MS } from '../marketHours.js';
import { buildDataQualityReport, judgeSpeechFreshness, SPEECH_PROVIDERS, type SpeechFreshness } from './metrics.js';
import type { QualityReader } from './reader.js';
import {
  PROVISIONAL_LIST_DAYS,
  renderDataQualityMarkdown,
  renderProvisionalEventsMarkdown,
  renderSpeechFreshnessMarkdown,
} from './report.js';

/** The newest minutes are not judged: ingest:fx-prices runs every 20 min, so they may simply not be fetched yet. */
export const REPORT_END_LAG_MINUTES = 30;
export const MAX_REPORT_DAYS = 31;

export interface QualityReportOptions {
  days: number;
  /** null/undefined = every active pair. */
  symbols?: readonly string[] | null;
  now: Date;
}

export function validateReportDays(days: number): void {
  if (!Number.isInteger(days) || days < 1 || days > MAX_REPORT_DAYS) {
    throw new Error(`days must be an integer between 1 and ${MAX_REPORT_DAYS} (got ${days})`);
  }
}

/**
 * 第9章(要人発言の鮮度)の材料を取得元ごとに読み、判定する。対象期間(days)とは
 * 無関係に、各取得元の最新の実行と最後の SUCCESS を読む(reader.listSpeechRuns)。
 */
export async function buildSpeechFreshness(reader: QualityReader, now: Date): Promise<SpeechFreshness[]> {
  const nowIso = now.toISOString();
  const result: SpeechFreshness[] = [];
  for (const provider of SPEECH_PROVIDERS) {
    const runs = await reader.listSpeechRuns(provider);
    const db = await reader.speechDbStatus(provider, nowIso);
    result.push(judgeSpeechFreshness(provider, runs, db, now));
  }
  return result;
}

export async function buildQualityReportMarkdown(
  reader: QualityReader,
  options: QualityReportOptions,
): Promise<string> {
  const { days, now } = options;
  const symbols = options.symbols ?? null;
  validateReportDays(days);

  const nowMinute = Math.floor(now.getTime() / MINUTE_MS) * MINUTE_MS;
  const from = nowMinute - days * 24 * 60 * MINUTE_MS;
  const to = nowMinute - REPORT_END_LAG_MINUTES * MINUTE_MS;
  const fromIso = new Date(from).toISOString();
  const toIso = new Date(to).toISOString();
  const nowIso = now.toISOString();

  const pairs = await reader.listPairs(symbols);
  const pairRows = [];
  for (const pair of pairs) {
    pairRows.push({
      symbol: pair.symbol,
      rows: await reader.listFxRows(pair.id, fromIso, nowIso),
      firstCandleAt: await reader.firstCandleAt(pair.id),
    });
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
    economicEventCount: await reader.countEconomicEvents(fromIso, toIso),
    creditUsage: await reader.listCreditUsage(fromIso.slice(0, 10), nowIso.slice(0, 10)),
  });
  let markdown = renderDataQualityMarkdown(report);
  if (symbols && pairs.length < symbols.length) {
    const found = new Set(pairs.map((p) => p.symbol));
    markdown += `\n> fx_pairs に無い(または無効な)通貨ペア: ${symbols.filter((s) => !found.has(s)).join(', ')}\n`;
  }
  // 第9章は既存の出力(第1〜8章と上の注記)の後ろに足すだけ。既存部分は1文字も変えない。
  markdown += `\n${renderSpeechFreshnessMarkdown(await buildSpeechFreshness(reader, now))}`;
  // 第10章(HQ判断 2026-10-27 案B): 暫定のまま発表が近い予定。これも末尾に足すだけ。
  const provisionalUntil = new Date(now.getTime() + PROVISIONAL_LIST_DAYS * 86_400_000).toISOString();
  markdown += `\n${renderProvisionalEventsMarkdown(await reader.listProvisionalEvents(nowIso, provisionalUntil), now)}`;
  return markdown;
}
