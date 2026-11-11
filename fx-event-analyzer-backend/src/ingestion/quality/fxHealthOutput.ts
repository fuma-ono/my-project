/**
 * report:fx-health の出力(HQ承認 2026-11-11「FX価格監視のワークフロー組み込み」)。DB にも外部 API にも触れない。
 *   - GitHub Actions の注釈: WARN → `::warning`、ALERT → `::error`(ログ・実行の画面で区別できる)
 *   - ステップのサマリー(Markdown): 判定・理由・集計の値・読んだ記録
 *   - 監視の処理そのものが失敗したときの注釈(原因を残す)
 * 判定は fxHealth.ts。Workflow を失敗させるかは --fail-on(ALERT のときだけ Exit 1)。
 */
import type { FxHealthInput, FxHealthReport } from './fxHealth.js';

/** 何を読んだか(ログに残す。PostgREST の問い合わせを SQL の形で書いたもの)。 */
export function fxHealthQueries(sinceIso: string, untilIso: string, usageDate: string): string[] {
  return [
    `select started_at, completed_at, status, details from ingestion_logs where job = 'ingest:fx-prices' and started_at >= '${sinceIso}' and started_at <= '${untilIso}' order by started_at limit 2000`,
    `select mode, credits from api_credit_usage where provider = 'twelvedata' and usage_date = '${usageDate}'`,
    `select daily_total_cap, automatic_cap from api_credit_limits where provider = 'twelvedata'`,
    `select count(*) from fx_prices where timeframe = '1m' and verification_status = 'UNVERIFIED' and "timestamp" >= '${sinceIso}'`,
  ];
}

/** 注釈の文字列の中で、GitHub Actions が特別に扱う文字を逃がす。 */
const escapeData = (s: string) => s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const escapeProperty = (s: string) => escapeData(s).replace(/:/g, '%3A').replace(/,/g, '%2C');

/** 判定ごとの注釈の行(OK なら1行の notice)。 */
export function fxHealthAnnotations(report: FxHealthReport): string[] {
  if (report.findings.length === 0) {
    return [`::notice title=${escapeProperty('FX health OK')}::${escapeData('為替の定時取得に異常なし')}`];
  }
  return report.findings.map((f) => {
    const command = f.level === 'ALERT' ? 'error' : 'warning';
    return `::${command} title=${escapeProperty(`FX health ${f.level} ${f.check}`)}::${escapeData(f.message)}`;
  });
}

/** 監視の処理が失敗したときの注釈(DB に読めない・設定が無い など)。 */
export function fxHealthFailureAnnotation(error: unknown): string {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return `::error title=${escapeProperty('FX health check failed')}::${escapeData(`report:fx-health が判定できなかった — ${message}`)}`;
}

/** ステップのサマリー(Markdown)。 */
export function renderFxHealthMarkdown(
  report: FxHealthReport,
  input: FxHealthInput,
  meta: { at: string; hours: number; failOn: string | null; queries: readonly string[] },
): string {
  const icon = report.level === 'ALERT' ? '🔴' : report.level === 'WARN' ? '🟡' : '🟢';
  const lines: string[] = [];
  lines.push(`## 為替の定時取得の監視(report:fx-health)— ${icon} ${report.level}`);
  lines.push('');
  lines.push(`- 判定の時刻: ${meta.at}(直近 ${meta.hours} 時間)`);
  lines.push(
    `- Workflow を失敗にする判定: ${meta.failOn ?? 'なし'}(ALERT のときだけ失敗。WARN は記録だけで失敗にしない)`,
  );
  lines.push('');
  lines.push('### 判定');
  lines.push('');
  if (report.findings.length === 0) lines.push('異常なし。');
  else {
    lines.push('| 判定 | 項目 | 理由 |');
    lines.push('|---|---|---|');
    for (const f of report.findings) lines.push(`| ${f.level} | ${f.check} | ${f.message.replace(/\|/g, '\\|')} |`);
  }
  lines.push('');
  lines.push('### 集計の値');
  lines.push('');
  const s = report.summary;
  lines.push(`- ingest:fx-prices の実行: ${s.runs} 回(FAILURE ${s.failures} 回)`);
  lines.push(`- 実行と実行の最長の間隔: ${s.longest_gap_minutes ?? '—(実行が2回未満)'} 分`);
  lines.push(`- 最後の実行からの経過: ${s.minutes_since_last_run ?? '—(実行なし)'} 分`);
  lines.push(
    `- 今日(UTC)のクレジット: 合計 ${input.credits.total} / ${input.caps.total}、自動 ${input.credits.automatic} / ${input.caps.automatic}、手動 ${input.credits.manual}`,
  );
  lines.push(`- UNVERIFIED の1分足: ${input.unverifiedCandles} 本`);
  if (s.github_runs.length > 0) {
    lines.push('');
    lines.push('| GitHub の実行 | 取り込みの回数 | FAILURE | 最初 | 最後 |');
    lines.push('|---|---|---|---|---|');
    for (const g of s.github_runs) {
      lines.push(`| ${g.github_run_id} | ${g.iterations} | ${g.failures} | ${g.first} | ${g.last} |`);
    }
  } else {
    lines.push('- GitHub の実行ごとの回数: —(ログに github_run_id が無い。この記録を入れる前の実行)');
  }
  lines.push('');
  lines.push('### 読んだ記録(読むだけ)');
  lines.push('');
  lines.push('```sql');
  lines.push(...meta.queries.map((q) => `${q};`));
  lines.push('```');
  lines.push('');
  lines.push(
    '注: この監視は異常に気づくためのもの。GitHub の定期実行(schedule)の取りこぼし自体は防げない(この監視も同じ定期実行で動く)。',
  );
  return `${lines.join('\n')}\n`;
}
