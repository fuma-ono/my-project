/**
 * Renders a DataQualityReport (quality/metrics.ts) as Markdown (Japanese
 * labels) for stdout and the GitHub Actions step summary. Pure — no I/O.
 * Nothing secret is ever part of the report (no keys, no URLs).
 */
import {
  FX_INGEST_WINDOW_MINUTES,
  FX_MARKET_WEEK_UTC,
  RELEASE_WINDOW_MINUTES,
  type DataQualityReport,
  type ReleaseWindowCounts,
} from './metrics.js';

const percent = (value: number | null): string => (value === null ? '—' : `${(value * 100).toFixed(2)}%`);
const num = (value: number | null): string => (value === null ? '—' : String(value));
const cell = (value: string): string => value.replace(/\|/g, '\\|').replace(/\n/g, ' ');
/** "2026-10-12T13:30:00.000Z" → "2026-10-12 13:30Z" */
const time = (iso: string): string => `${iso.slice(0, 10)} ${iso.slice(11, 16)}Z`;

function table(header: readonly string[], rows: readonly (readonly string[])[]): string[] {
  return [
    `| ${header.join(' | ')} |`,
    `|${header.map(() => '---').join('|')}|`,
    ...rows.map((row) => `| ${row.map(cell).join(' | ')} |`),
  ];
}

function counts(record: Record<string, number>): string {
  const entries = Object.entries(record).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return entries.length === 0 ? '—' : entries.map(([key, value]) => `${key}: ${value}`).join(', ');
}

function windowRow(label: string, c: ReleaseWindowCounts): string[] {
  return [
    label,
    String(c.windows),
    String(c.complete),
    String(c.incomplete),
    percent(c.windows === 0 ? null : c.complete / c.windows),
    String(c.outsideMarket),
    String(c.outsidePeriod),
  ];
}

export function renderDataQualityMarkdown(report: DataQualityReport): string {
  const lines: string[] = [];
  lines.push(`# データ品質レポート(直近${report.days}日)`);
  lines.push('');
  lines.push(`- 作成: ${time(report.generatedAt)}`);
  lines.push(`- 対象期間: ${time(report.period.from)} 〜 ${time(report.period.to)}(終端は直近の取得待ち分を除外)`);
  lines.push(
    `- 想定する市場時間: 日曜 ${FX_MARKET_WEEK_UTC.openHour}:00 UTC 〜 金曜 ${FX_MARKET_WEEK_UTC.closeHour}:00 UTC(夏時間のずれ・祝日は未考慮のため、欠損率は上限値)`,
  );
  lines.push('');

  lines.push('## 1. 為替1分足の取得率・欠損率');
  lines.push('');
  const t = report.fxTotals;
  lines.push(
    `全通貨ペア合計: 想定 ${t.expectedMinutes} 分 / 取得 ${t.presentMinutes} 分 / 欠損 ${t.missingMinutes} 分(取得率 ${percent(t.missingRate === null ? null : 1 - t.missingRate)}、欠損率 ${percent(t.missingRate)})`,
  );
  lines.push('');
  lines.push(
    ...table(
      ['通貨ペア', '想定(分)', '取得(分)', '欠損(分)', '欠損率', '反応計算に使える(分)', '市場時間外の足'],
      report.fx.map((f) => [
        f.symbol,
        String(f.expectedMinutes),
        String(f.presentMinutes),
        String(f.missingMinutes),
        percent(f.missingRate),
        String(f.usableMinutes),
        String(f.outsideMarketRows),
      ]),
    ),
  );
  lines.push('');
  lines.push('### 長い欠損(通貨ペアごとに上位5件)');
  lines.push('');
  const gapRows = report.fx.flatMap((f) =>
    f.longestGaps.map((gap) => [f.symbol, time(gap.start), String(gap.minutes)]),
  );
  if (gapRows.length === 0) lines.push('欠損なし。');
  else lines.push(...table(['通貨ペア', '開始', '長さ(分)'], gapRows));
  lines.push('');

  lines.push('## 2. 照合一致率(1分足)');
  lines.push('');
  lines.push(
    ...table(
      ['通貨ペア', 'VERIFIED', 'SINGLE_SOURCE', 'UNVERIFIED', '照合した足', '照合一致率', '最大差(pips)'],
      report.fx.map((f) => [
        f.symbol,
        String(f.status.VERIFIED),
        String(f.status.SINGLE_SOURCE),
        String(f.status.UNVERIFIED),
        String(f.crossChecked),
        percent(f.agreementRate),
        f.maxAbsDiffPips === null ? '—' : f.maxAbsDiffPips.toFixed(2),
      ]),
    ),
  );
  lines.push('');
  lines.push('照合一致率 = VERIFIED ÷ 2つ目の取得元と照合できた足。照合した足が0件なら「—」(照合元が未設定)。');
  lines.push('');

  lines.push('## 3. 集約足(5分〜60分)の作成率');
  lines.push('');
  lines.push(
    ...table(
      ['通貨ペア', ...(report.fx[0]?.aggregates.map((a) => a.timeframe) ?? [])],
      report.fx.map((f) => [
        f.symbol,
        ...f.aggregates.map((a) => `${a.presentBuckets}/${a.eligibleBuckets} (${percent(a.coverageRate)})`),
      ]),
    ),
  );
  lines.push('');
  lines.push(
    '分母 = 期間内の区間のうち、1分足がすべて揃っていて UNVERIFIED を含まない区間(集約足を作れるはずの区間)。',
  );
  lines.push('');

  lines.push('## 4. 発表・発言前後の1分足');
  lines.push('');
  lines.push(
    `発表・発言時刻 T に対し、T−${RELEASE_WINDOW_MINUTES.before}分〜T+${RELEASE_WINDOW_MINUTES.after}分の1分足(UNVERIFIED は欠損扱い)が全部あるか。通貨ペアごとに1件と数える。`,
  );
  lines.push('');
  const rw = report.releaseWindows;
  lines.push(
    ...table(
      ['種類', '判定した件数', '完全', '欠けあり', '完全率', '市場時間外', '期間の端で未判定'],
      [windowRow('経済指標(RELEASED)', rw.byKind.ECONOMIC), windowRow('要人発言(DELIVERED)', rw.byKind.SPEECH)],
    ),
  );
  lines.push('');
  if (rw.issues.length > 0) {
    lines.push('欠けのある時間帯(欠けの多い順、最大20件):');
    lines.push('');
    lines.push(
      ...table(
        ['種類', '時刻', '内容', '通貨ペア', '欠け(分)'],
        rw.issues.map((issue) => [
          issue.kind === 'ECONOMIC' ? '経済指標' : '要人発言',
          time(issue.at),
          issue.label,
          issue.symbol,
          String(issue.missingMinutes),
        ]),
      ),
    );
    lines.push('');
  }

  lines.push('## 5. 取得ジョブの実行状況');
  lines.push('');
  if (report.runs.length === 0) lines.push('期間内の ingestion_logs なし。');
  else
    lines.push(
      ...table(
        ['ジョブ', '実行', 'SUCCESS', 'PARTIAL', 'FAILURE', '所要時間の中央値(秒)', 'スキップ理由'],
        report.runs.map((r) => [
          r.job,
          String(r.runs),
          String(r.success),
          String(r.partial),
          String(r.failure),
          r.medianDurationSeconds === null ? '—' : r.medianDurationSeconds.toFixed(1),
          counts(r.skipReasons),
        ]),
      ),
    );
  lines.push('');
  const s = report.fxSchedule;
  lines.push('### ingest:fx-prices の実行間隔');
  lines.push('');
  lines.push(`- 成功した実行: ${s.successfulRuns} 回`);
  lines.push(
    `- 成功した実行の最長間隔: ${num(s.longestIntervalMinutes)} 分${s.longestInterval ? `(${time(s.longestInterval.from)} 〜 ${time(s.longestInterval.to)})` : ''}`,
  );
  lines.push(`- 最後の成功からの経過: ${num(s.minutesSinceLastSuccess)} 分`);
  lines.push(
    `- 取得範囲(${FX_INGEST_WINDOW_MINUTES}分)を超えた間隔: ${s.gapsOverWindow.length} 件${s.gapsOverWindow.length > 0 ? '(この間の市場時間は取りこぼしの可能性あり)' : ''}`,
  );
  if (s.gapsOverWindow.length > 0) {
    lines.push('');
    lines.push(
      ...table(
        ['前回の成功', '次の成功', '間隔(分)', 'どの実行も取得しなかった市場時間(分)'],
        s.gapsOverWindow.map((gap) => [
          time(gap.from),
          time(gap.to),
          String(gap.minutes),
          String(gap.uncoveredMarketMinutes),
        ]),
      ),
    );
  }
  lines.push('');

  lines.push('## 6. 時刻ずれ');
  lines.push('');
  lines.push(
    `- 為替: 最新1分足の経過時間(レポート作成時点、足の終了時刻から): ${
      report.fx.map((f) => `${f.symbol} ${num(report.latestCandleAgeMinutes[f.symbol] ?? null)}分`).join(', ') || '—'
    }`,
  );
  lines.push(
    '- 為替: 実行ごとの「足の時刻と取得時刻の差」は ingestion_logs に取得範囲・最新足の時刻を記録していないため算出できない(未計測)。',
  );
  lines.push(
    `- 要人発言: 正確な時刻が無いためスキップした発言(TIME_NOT_EXACT): ${report.speechTimeNotExact} 件。発言時刻そのもののずれは自動では測れない(手作業で公式発表と照合)。`,
  );
  lines.push('');

  lines.push('## 7. 経済指標の値');
  lines.push('');
  const e = report.economic;
  lines.push(`- 公開した発表値(event_snapshots RELEASE): ${counts(e.snapshots)}`);
  lines.push(`- 検証待ち・要確認(ingestion_staged_values): ${counts(e.staged)}`);
  lines.push(`- 要確認の理由: ${counts(e.pendingReviewReasons)}`);
  lines.push(
    `- 公式統計との一致率: ${percent(e.agreementRate)}(VERIFIED ${e.snapshots.VERIFIED ?? 0} ÷ (VERIFIED + 公式値と不一致 ${e.officialMismatches}))`,
  );
  lines.push('');
  return `${lines.join('\n')}\n`;
}
