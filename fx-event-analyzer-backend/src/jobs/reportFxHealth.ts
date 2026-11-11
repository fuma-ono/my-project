import 'dotenv/config';
import { appendFileSync } from 'node:fs';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadEnv } from '../config/env.js';
import { createSupabaseClient } from '../db/supabaseClient.js';
import {
  evaluateFxHealth,
  type FxHealthInput,
  type FxHealthReport,
  type HealthLevel,
} from '../ingestion/quality/fxHealth.js';
import {
  fxHealthAnnotations,
  fxHealthFailureAnnotation,
  fxHealthQueries,
  renderFxHealthMarkdown,
} from '../ingestion/quality/fxHealthOutput.js';

/**
 * 為替の定時取得の健全性(HQ指示 2026-11-11「FX価格定時取得の実績検証・運用監視準備」)。**読むだけ**(DB に書かない・外部 API を
 * 呼ばない)。判定は ingestion/quality/fxHealth.ts。
 *
 *   npm run report:fx-health                       # 直近 24 時間。結果を JSON で出す(Exit 0)
 *   npm run report:fx-health -- --hours 30 --fail-on alert   # ALERT なら Exit 1(warn にすると WARN でも Exit 1)
 *
 * GitHub Actions では、判定ごとに注釈(WARN = ::warning、ALERT = ::error)を出し、ステップのサマリーに判定・理由・集計・
 * 読んだ記録を書く(HQ承認 2026-11-11)。Workflow の日次レポートの後に `--fail-on alert` で動かす(ALERT のときだけ失敗)。
 */
export async function loadFxHealthInput(supabase: SupabaseClient, now: Date, hours: number): Promise<FxHealthInput> {
  const since = new Date(now.getTime() - hours * 3_600_000).toISOString();
  const today = now.toISOString().slice(0, 10);
  const [logs, credits, limits, unverified] = await Promise.all([
    supabase
      .from('ingestion_logs')
      .select('started_at, completed_at, status, details')
      .eq('job', 'ingest:fx-prices')
      .gte('started_at', since)
      .lte('started_at', now.toISOString())
      .order('started_at', { ascending: true })
      .limit(2000),
    supabase.from('api_credit_usage').select('mode, credits').eq('provider', 'twelvedata').eq('usage_date', today),
    supabase
      .from('api_credit_limits')
      .select('daily_total_cap, automatic_cap')
      .eq('provider', 'twelvedata')
      .maybeSingle(),
    supabase
      .from('fx_prices')
      .select('id', { count: 'exact', head: true })
      .eq('timeframe', '1m')
      .eq('verification_status', 'UNVERIFIED')
      .gte('timestamp', since),
  ]);
  for (const r of [logs, credits, limits, unverified]) if (r.error) throw r.error;
  const creditRows = (credits.data ?? []) as { mode: string; credits: number }[];
  const sum = (mode?: string) =>
    creditRows.filter((c) => mode === undefined || c.mode === mode).reduce((acc, c) => acc + c.credits, 0);
  const capRow: unknown = limits.data;
  const cap = capRow as { daily_total_cap?: number; automatic_cap?: number } | null;
  return {
    runs: (
      (logs.data ?? []) as { started_at: string; completed_at: string | null; status: string; details: unknown }[]
    ).map((r) => {
      const d = (r.details ?? {}) as Record<string, unknown>;
      return {
        started_at: new Date(r.started_at).toISOString(),
        completed_at: r.completed_at ? new Date(r.completed_at).toISOString() : null,
        status: r.status as 'SUCCESS' | 'FAILURE' | 'PARTIAL',
        github_run_id: typeof d.github_run_id === 'string' ? d.github_run_id : null,
        unrecovered_total: typeof d.unrecovered_total === 'number' ? d.unrecovered_total : null,
      };
    }),
    credits: { automatic: sum('AUTOMATIC'), manual: sum('MANUAL'), total: sum() },
    caps: { automatic: cap?.automatic_cap ?? 700, total: cap?.daily_total_cap ?? 800 },
    unverifiedCandles: unverified.count ?? 0,
  };
}

export function exitCodeFor(report: FxHealthReport, failOn: HealthLevel | null): number {
  if (!failOn) return 0;
  const rank = (l: HealthLevel) => (l === 'ALERT' ? 2 : l === 'WARN' ? 1 : 0);
  return rank(report.level) >= rank(failOn) ? 1 : 0;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function main(): Promise<void> {
  const hours = Number(arg('hours') ?? 24);
  if (!Number.isFinite(hours) || hours <= 0 || hours > 24 * 14) throw new Error('--hours must be between 1 and 336');
  const failOnArg = arg('fail-on');
  const failOn = failOnArg === 'warn' ? 'WARN' : failOnArg === 'alert' ? 'ALERT' : null;
  const now = new Date();
  const since = new Date(now.getTime() - hours * 3_600_000).toISOString();
  const queries = fxHealthQueries(since, now.toISOString(), now.toISOString().slice(0, 10));
  const input = await loadFxHealthInput(createSupabaseClient(loadEnv()), now, hours);
  const report = evaluateFxHealth(input, now);

  // ログ: 読んだ記録・集計の入力(件数)・判定と理由
  console.log(`report:fx-health ${report.level} (直近 ${hours} 時間、--fail-on ${failOnArg ?? 'なし'})`);
  for (const q of queries) console.log(`query: ${q}`);
  console.log(
    `input: runs=${input.runs.length} credits=${JSON.stringify(input.credits)} caps=${JSON.stringify(input.caps)} unverified=${input.unverifiedCandles}`,
  );
  console.log(JSON.stringify({ job: 'report:fx-health', hours, at: now.toISOString(), ...report }));
  if (process.env.GITHUB_ACTIONS === 'true') {
    for (const line of fxHealthAnnotations(report)) console.log(line);
    const summaryPath = process.env.GITHUB_STEP_SUMMARY;
    if (summaryPath) {
      appendFileSync(
        summaryPath,
        renderFxHealthMarkdown(report, input, { at: now.toISOString(), hours, failOn: failOn, queries }),
      );
    }
  }
  process.exitCode = exitCodeFor(report, failOn);
  if (process.exitCode === 1) console.log(`report:fx-health: ${report.level} のため Exit 1(Workflow を失敗にする)`);
}

if (process.argv[1]?.endsWith('reportFxHealth.ts')) {
  main().catch((error: unknown) => {
    // 監視の処理そのものの失敗(DB に読めない・設定が無い など)。原因をログと注釈に残して Exit 1
    console.error(error);
    if (process.env.GITHUB_ACTIONS === 'true') console.log(fxHealthFailureAnnotation(error));
    process.exitCode = 1;
  });
}
