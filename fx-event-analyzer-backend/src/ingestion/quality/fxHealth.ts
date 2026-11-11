/**
 * 為替の定時取得の健全性の判定(HQ指示 2026-11-11「FX価格定時取得の実績検証・運用監視準備」)。DB にも外部 API にも触れない。
 *
 * 既存の data-quality レポート(quality/report.ts)は Markdown の一覧で、しきい値で警告しない・失敗にしない。ここは同じ記録
 * (ingestion_logs・api_credit_usage・fx_prices)から、次の異常を OK / WARN / ALERT で判定する:
 *   STALE            市場が開いているのに、最後の ingest:fx-prices から 30 分(ALERT 60 分)を超えた
 *   RUN_GAP          市場が開いている間に、実行と実行の間が 30 分を超えた(120 分を超えたら ALERT)
 *                    — 定時起動の取りこぼし(2026-11-10 13:45〜16:59Z の 194 分など)
 *   LOOP_INCOMPLETE  1つの GitHub Actions の実行(github_run_id)の取り込みが 17 回に届かずに終わった(途中で止まった)。
 *                    いちばん新しい実行(まだ続いているかもしれない)は判定しない
 *   FAILURES         期間内の FAILURE(3回続いたら ALERT)。最後の実行が SUCCESS なら「回復済み」として WARN のまま
 *   CREDITS          今日(UTC)のクレジットが全体の上限の 80%(ALERT 95%)、自動の上限の 90% を超えた
 *   UNRECOVERED      最新の実行で、取り戻せなかった1分足がある(details.unrecovered_total)
 *   UNVERIFIED       期間内の UNVERIFIED の1分足がある
 */
import { isFxMarketOpen } from '../marketHours.js';

export type HealthLevel = 'OK' | 'WARN' | 'ALERT';

export interface FxRunLog {
  started_at: string;
  completed_at: string | null;
  status: 'SUCCESS' | 'FAILURE' | 'PARTIAL';
  github_run_id: string | null;
  unrecovered_total: number | null;
}

export interface FxHealthInput {
  /** 期間内の ingest:fx-prices のログ(古い順) */
  runs: readonly FxRunLog[];
  credits: { automatic: number; manual: number; total: number };
  caps: { automatic: number; total: number };
  unverifiedCandles: number;
}

export interface FxHealthFinding {
  check: 'STALE' | 'RUN_GAP' | 'LOOP_INCOMPLETE' | 'FAILURES' | 'CREDITS' | 'UNRECOVERED' | 'UNVERIFIED';
  level: Exclude<HealthLevel, 'OK'>;
  message: string;
  detail?: Record<string, unknown>;
}

export interface FxHealthReport {
  level: HealthLevel;
  findings: FxHealthFinding[];
  summary: {
    runs: number;
    failures: number;
    github_runs: { github_run_id: string; iterations: number; failures: number; first: string; last: string }[];
    longest_gap_minutes: number | null;
    minutes_since_last_run: number | null;
    credits: FxHealthInput['credits'];
  };
}

export const FX_HEALTH_THRESHOLDS = {
  staleWarnMinutes: 30,
  staleAlertMinutes: 60,
  gapWarnMinutes: 30,
  gapAlertMinutes: 120,
  loopIterations: 17,
  consecutiveFailureAlert: 3,
  creditTotalWarn: 0.8,
  creditTotalAlert: 0.95,
  creditAutomaticWarn: 0.9,
} as const;

const MINUTE_MS = 60_000;

/** [fromMs, toMs) に市場が開いている分があるか(5分刻みで見る)。 */
function marketOpenBetween(fromMs: number, toMs: number): boolean {
  for (let ms = fromMs; ms < toMs; ms += 5 * MINUTE_MS) if (isFxMarketOpen(ms)) return true;
  return false;
}

const rank = (l: HealthLevel) => (l === 'ALERT' ? 2 : l === 'WARN' ? 1 : 0);

export function evaluateFxHealth(input: FxHealthInput, now: Date, t = FX_HEALTH_THRESHOLDS): FxHealthReport {
  const findings: FxHealthFinding[] = [];
  const runs = [...input.runs].sort((a, b) => Date.parse(a.started_at) - Date.parse(b.started_at));
  const nowMs = now.getTime();

  // STALE
  const last = runs.at(-1);
  const sinceLast = last ? Math.floor((nowMs - Date.parse(last.started_at)) / MINUTE_MS) : null;
  if (isFxMarketOpen(nowMs)) {
    if (sinceLast === null || sinceLast > t.staleWarnMinutes) {
      findings.push({
        check: 'STALE',
        level: sinceLast === null || sinceLast > t.staleAlertMinutes ? 'ALERT' : 'WARN',
        message:
          sinceLast === null
            ? '市場が開いているのに、期間内に ingest:fx-prices の実行がない'
            : `市場が開いているのに、最後の取り込みから ${sinceLast} 分たっている`,
        detail: { last_started_at: last?.started_at ?? null },
      });
    }
  }

  // RUN_GAP
  let longestGap: number | null = null;
  for (let i = 1; i < runs.length; i += 1) {
    const from = Date.parse(runs[i - 1]!.started_at);
    const to = Date.parse(runs[i]!.started_at);
    const minutes = Math.floor((to - from) / MINUTE_MS);
    longestGap = longestGap === null ? minutes : Math.max(longestGap, minutes);
    if (minutes > t.gapWarnMinutes && marketOpenBetween(from + t.gapWarnMinutes * MINUTE_MS, to)) {
      findings.push({
        check: 'RUN_GAP',
        level: minutes > t.gapAlertMinutes ? 'ALERT' : 'WARN',
        message: `市場の時間に ${minutes} 分、取り込みが無かった(定時起動の取りこぼしの可能性)`,
        detail: { from: runs[i - 1]!.started_at, to: runs[i]!.started_at, minutes },
      });
    }
  }

  // LOOP_INCOMPLETE(github_run_id ごと)
  const groups = new Map<string, FxRunLog[]>();
  for (const r of runs) {
    if (!r.github_run_id) continue;
    groups.set(r.github_run_id, [...(groups.get(r.github_run_id) ?? []), r]);
  }
  const githubRuns = [...groups.entries()].map(([id, list]) => ({
    github_run_id: id,
    iterations: list.length,
    failures: list.filter((r) => r.status === 'FAILURE').length,
    first: list[0]!.started_at,
    last: list.at(-1)!.started_at,
  }));
  const newestGroup = [...githubRuns].sort((a, b) => Date.parse(b.last) - Date.parse(a.last))[0]?.github_run_id ?? null;
  const firstInWindow = runs[0]?.github_run_id ?? null;
  for (const g of githubRuns) {
    if (g.github_run_id === newestGroup) continue; // まだ続いているかもしれない
    // 期間の最初の回を含む実行は、期間より前から始まっていて回数を数えきれないので判定しない
    if (g.github_run_id === firstInWindow) continue;
    if (g.iterations < t.loopIterations) {
      findings.push({
        check: 'LOOP_INCOMPLETE',
        level: 'WARN',
        message: `GitHub Actions の実行 ${g.github_run_id} の取り込みが ${g.iterations} 回で終わった(${t.loopIterations} 回の予定)`,
        detail: g,
      });
    }
  }

  // FAILURES
  const failures = runs.filter((r) => r.status === 'FAILURE');
  if (failures.length > 0) {
    let streak = 0;
    let maxStreak = 0;
    for (const r of runs) {
      streak = r.status === 'FAILURE' ? streak + 1 : 0;
      maxStreak = Math.max(maxStreak, streak);
    }
    const recovered = last?.status !== 'FAILURE';
    findings.push({
      check: 'FAILURES',
      level: !recovered && streak >= t.consecutiveFailureAlert ? 'ALERT' : 'WARN',
      message: `期間内に FAILURE が ${failures.length} 回(最長 ${maxStreak} 回続いた)。${recovered ? '最後の実行は成功(回復済み)' : `今も ${streak} 回続いている`}`,
      detail: { failures: failures.length, max_streak: maxStreak, current_streak: streak, recovered },
    });
  }

  // CREDITS
  const totalRate = input.caps.total > 0 ? input.credits.total / input.caps.total : 0;
  const autoRate = input.caps.automatic > 0 ? input.credits.automatic / input.caps.automatic : 0;
  if (totalRate >= t.creditTotalWarn || autoRate >= t.creditAutomaticWarn) {
    findings.push({
      check: 'CREDITS',
      level: totalRate >= t.creditTotalAlert ? 'ALERT' : 'WARN',
      message: `今日(UTC)のクレジット: 合計 ${input.credits.total}/${input.caps.total}(${Math.round(totalRate * 100)}%)、自動 ${input.credits.automatic}/${input.caps.automatic}(${Math.round(autoRate * 100)}%)`,
      detail: { ...input.credits, ...input.caps },
    });
  }

  // UNRECOVERED(最新の実行)
  const latestUnrecovered = [...runs].reverse().find((r) => r.unrecovered_total !== null)?.unrecovered_total ?? null;
  if (latestUnrecovered !== null && latestUnrecovered > 0) {
    findings.push({
      check: 'UNRECOVERED',
      level: 'WARN',
      message: `最新の実行で、取り戻せなかった1分足が ${latestUnrecovered} 区間ある(次の実行が7日分を取り直す)`,
      detail: { unrecovered_total: latestUnrecovered },
    });
  }

  // UNVERIFIED
  if (input.unverifiedCandles > 0) {
    findings.push({
      check: 'UNVERIFIED',
      level: 'WARN',
      message: `期間内に UNVERIFIED の1分足が ${input.unverifiedCandles} 本ある(反応値の計算には使わない)`,
      detail: { unverified: input.unverifiedCandles },
    });
  }

  const level = findings.reduce<HealthLevel>((acc, f) => (rank(f.level) > rank(acc) ? f.level : acc), 'OK');
  return {
    level,
    findings,
    summary: {
      runs: runs.length,
      failures: failures.length,
      github_runs: githubRuns,
      longest_gap_minutes: longestGap,
      minutes_since_last_run: sinceLast,
      credits: input.credits,
    },
  };
}
