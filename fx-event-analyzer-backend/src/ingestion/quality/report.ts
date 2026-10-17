/**
 * Renders a DataQualityReport (quality/metrics.ts) as Markdown (Japanese
 * labels) for stdout and the GitHub Actions step summary. Pure — no I/O.
 * Nothing secret is ever part of the report (no keys, no URLs).
 *
 * A zero denominator is never shown as 0 % or "0件": it is 「—(理由)」, and
 * "no data" / "the check never ran" are shown as states (HQ 2026-10-16).
 */
import {
  CREDIT_CAPS,
  FX_INGEST_WINDOW_MINUTES,
  MISSING_CAUSES,
  RELEASE_WINDOW_MINUTES,
  type AggregateCoverage,
  type DataQualityReport,
  type FxCompleteness,
  type MissingCause,
  type ReleaseWindowCounts,
} from './metrics.js';

const percent = (value: number): string => `${(value * 100).toFixed(2)}%`;
/** Rate or 「—(理由)」 when the denominator is zero. */
const rate = (value: number | null, reason: string): string => (value === null ? `—(${reason})` : percent(value));
const num = (value: number | null, reason = '記録なし'): string => (value === null ? `—(${reason})` : String(value));
const cell = (value: string): string => value.replace(/\|/g, '\\|').replace(/\n/g, ' ');
/** "2026-10-12T13:30:00.000Z" → "2026-10-12 13:30Z" */
const time = (iso: string): string => {
  const d = new Date(Date.parse(iso)).toISOString();
  return `${d.slice(0, 10)} ${d.slice(11, 16)}Z`;
};

const NO_DATA = 'データなし(取り込み未開始)';
const ECONOMIC_EMPTY = '期間内に発表済みの経済指標データなし';
const SPEECH_EMPTY = '期間内に要人発言データなし';

export const MISSING_CAUSE_LABELS: Record<MissingCause, string> = {
  NO_DATA_UNCONFIRMED: '取得元にデータなしの可能性(未確認)',
  BEYOND_HORIZON: '未回収(回収期間外・7日超)',
  BUDGET: '未回収(クレジット上限)',
  RATE_LIMITED: '未回収(レート制限)',
  TIMEOUT: '未回収(タイムアウト)',
  API_ERROR: '未回収(APIエラー)',
  UNKNOWN: '未取得(原因未特定)',
};

function table(header: readonly string[], rows: readonly (readonly string[])[]): string[] {
  return [
    `| ${header.join(' | ')} |`,
    `|${header.map(() => '---').join('|')}|`,
    ...rows.map((row) => `| ${row.map(cell).join(' | ')} |`),
  ];
}

function counts(record: Record<string, number>, empty = '—(該当なし)'): string {
  const entries = Object.entries(record).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return entries.length === 0 ? empty : entries.map(([key, value]) => `${key}: ${value}`).join(', ');
}

function breakdown(record: Record<MissingCause, number>): string {
  const parts = MISSING_CAUSES.filter((c) => record[c] > 0).map((c) => `${MISSING_CAUSE_LABELS[c]} ${record[c]}`);
  return parts.length === 0 ? '—(欠損なし)' : parts.join(', ');
}

/** Why a pair has nothing to judge. null = it has. */
function notJudgedReason(f: FxCompleteness): string | null {
  if (f.state === 'NO_DATA') return NO_DATA;
  if (f.state === 'STARTED_AFTER_PERIOD') return '—(取り込み開始が期間後)';
  if (f.expectedMinutes === 0) return '—(期間内に市場時間なし)';
  return null;
}

function aggregateCell(f: FxCompleteness, a: AggregateCoverage, which: 'success' | 'coverage'): string {
  const reason = notJudgedReason(f);
  if (reason) return reason;
  return which === 'success'
    ? `${a.presentBuckets}/${a.eligibleBuckets} (${rate(a.successRate, '作成可能な区間なし')})`
    : `${a.presentExpectedBuckets}/${a.expectedBuckets} (${rate(a.coverageRate, '評価対象の区間なし')})`;
}

function windowRow(label: string, c: ReleaseWindowCounts, emptyReason: string): string[] {
  if (c.instants === 0) return [label, '0', '—', '—', '—', '—', `—(${emptyReason})`, '—', '—', '—'];
  return [
    label,
    String(c.instants),
    String(c.evaluatedInstants),
    String(c.windows),
    String(c.complete),
    String(c.incomplete),
    rate(c.windows === 0 ? null : c.complete / c.windows, '判定対象なし'),
    String(c.beforeIngestionStart),
    String(c.outsideMarket),
    String(c.outsidePeriod),
  ];
}

function windowLine(noun: string, emptyReason: string, c: ReleaseWindowCounts, pairs: number): string {
  if (c.instants === 0) return `- ${noun}: —(${emptyReason})`;
  if (c.windows === 0) return `- ${noun}: 期間内 ${c.instants}件、判定できたものなし(下表の未判定の理由を参照)`;
  if (c.windows === c.evaluatedInstants * pairs) {
    return `- ${noun}: ${c.evaluatedInstants}件 × ${pairs}ペア = ${c.windows}判定(完全 ${c.complete}、欠けあり ${c.incomplete})`;
  }
  return `- ${noun}: 判定した件数 ${c.evaluatedInstants}件、通貨ペア別の判定 ${c.windows}件(一部の通貨ペアは未判定。完全 ${c.complete}、欠けあり ${c.incomplete})`;
}

export function renderDataQualityMarkdown(report: DataQualityReport): string {
  const lines: string[] = [];
  lines.push(`# データ品質レポート(直近${report.days}日)`);
  lines.push('');
  lines.push(`- 作成: ${time(report.generatedAt)}`);
  lines.push(`- 対象期間: ${time(report.period.from)} 〜 ${time(report.period.to)}(終端は直近の取得待ち分を除外)`);
  lines.push(
    '- 市場時間: ニューヨーク時間の日曜 17:00 〜 金曜 17:00(米国の夏時間に連動。UTC では夏 21:00、冬 22:00)。12/25・1/1(ニューヨークの日付)は終日休場として想定に含めない',
  );
  lines.push(
    '- 限界: 休場は 12/25・1/1 のみを扱う。その他の祝日・短縮取引(例: 12/24・12/31 の早い終了)は考慮していないため、その日の欠損は過大になる場合がある',
  );
  lines.push(
    '- 取り込み開始: 通貨ペアごとに最初に保存された1分足の時刻。それより前の市場時間は「取り込み開始前(対象外)」とし、欠損に数えない',
  );
  lines.push('');

  // 1 -----------------------------------------------------------------------
  lines.push('## 1. 為替1分足の取得率・欠損率');
  lines.push('');
  const t = report.fxTotals;
  const totalRate =
    t.expectedMinutes === 0
      ? `—(${report.fx.length === 0 ? '通貨ペアなし' : t.pairsWithoutData.length === report.fx.length ? 'どの通貨ペアも取り込み未開始' : '判定対象の市場時間なし'})`
      : `取得率 ${percent(t.presentMinutes / t.expectedMinutes)}、欠損率 ${percent(t.missingRate!)}`;
  lines.push(
    `全通貨ペア合計: 取り込み開始前(対象外) ${t.beforeStartMinutes} 分 / 想定 ${t.expectedMinutes} 分 / 取得 ${t.presentMinutes} 分 / 欠損 ${t.missingMinutes} 分(${totalRate})`,
  );
  if (t.pairsWithoutData.length > 0) lines.push(`${NO_DATA}: ${t.pairsWithoutData.join(', ')}`);
  lines.push('');
  lines.push(
    '想定 = 取り込み開始(期間の始めより後ならその時刻)〜 期間の終わりの市場時間の分数。欠損 = 想定 − 取得。欠損率 = 欠損 ÷ 想定。',
  );
  lines.push('');
  lines.push(
    ...table(
      [
        '通貨ペア',
        '取り込み開始',
        '取り込み開始前(対象外・分)',
        '想定(分)',
        '取得(分)',
        '欠損(分)',
        '欠損率',
        '反応計算に使える(分)',
        '市場時間外の足',
      ],
      report.fx.map((f) => {
        const reason = notJudgedReason(f);
        const judged = f.state === 'OK';
        return [
          f.symbol,
          f.ingestionStart === null ? NO_DATA : time(f.ingestionStart),
          String(f.beforeStartMinutes),
          judged ? String(f.expectedMinutes) : '—',
          judged ? String(f.presentMinutes) : '—',
          judged ? String(f.missingMinutes) : '—',
          reason ?? percent(f.missingRate!),
          judged ? String(f.usableMinutes) : '—',
          String(f.outsideMarketRows),
        ];
      }),
    ),
  );
  lines.push('');
  lines.push('### 欠損の内訳(取り込みログから)');
  lines.push('');
  lines.push(`全通貨ペア合計: ${breakdown(t.missingBreakdown)}`);
  lines.push('');
  const missingRows = report.fx
    .filter((f) => f.missingMinutes > 0)
    .map((f) => [f.symbol, String(f.missingMinutes), breakdown(f.missingBreakdown)]);
  if (missingRows.length > 0) {
    lines.push(...table(['通貨ペア', '欠損(分)', '内訳(分)'], missingRows));
    lines.push('');
  }
  lines.push(
    '「取得元にデータなしの可能性(未確認)」= ingest:fx-prices のログ no_data_unconfirmed の時間帯。「未回収(…)」= 最新の実行のログ unrecovered の時間帯と理由。どちらにも無い分は「未取得(原因未特定)」(次回以降の実行で回収される可能性がある。古い形式のログしか無い期間はすべてここに入る)。',
  );
  lines.push('');
  lines.push('### 長い欠損(通貨ペアごとに上位5件)');
  lines.push('');
  const gapRows = report.fx.flatMap((f) =>
    f.longestGaps.map((gap) => [f.symbol, time(gap.start), String(gap.minutes)]),
  );
  if (gapRows.length === 0) lines.push('欠損なし(判定対象の期間内)。');
  else lines.push(...table(['通貨ペア', '開始', '長さ(分)'], gapRows));
  lines.push('');

  // 2 -----------------------------------------------------------------------
  lines.push('## 2. 照合一致率(1分足)');
  lines.push('');
  lines.push(
    ...table(
      ['通貨ペア', 'VERIFIED', 'SINGLE_SOURCE', 'UNVERIFIED', '照合した足', '照合一致率', '最大差(pips)'],
      report.fx.map((f) => {
        if (f.presentMinutes === 0) {
          const reason = f.state === 'NO_DATA' ? NO_DATA : '—(期間内の足なし)';
          return [f.symbol, '—', '—', '—', '—', reason, '—'];
        }
        return [
          f.symbol,
          String(f.status.VERIFIED),
          String(f.status.SINGLE_SOURCE),
          String(f.status.UNVERIFIED),
          String(f.crossChecked),
          rate(f.agreementRate, '照合未実行: 照合元未設定'),
          f.maxAbsDiffPips === null ? '—' : f.maxAbsDiffPips.toFixed(2),
        ];
      }),
    ),
  );
  lines.push('');
  lines.push('照合一致率 = VERIFIED ÷ 2つ目の取得元と照合できた足。');
  lines.push('');
  lines.push('### 個別の異常値・差異の一覧(最大20件、新しい順)');
  lines.push('');
  if (report.anomalies.length === 0) {
    lines.push('—(この期間にUNVERIFIEDの足なし)');
  } else {
    lines.push(
      ...table(
        ['通貨ペア', '対象日時(足の開始)', '差(pips)', '参照元', '理由', 'ログの実行'],
        report.anomalies.map((a) => [
          a.symbol,
          time(a.minute),
          a.diffPips === null ? '—' : a.diffPips.toFixed(2),
          a.referenceSource ?? '—(照合元未設定)',
          a.notes.length === 0 ? '—' : a.notes.join(', '),
          time(a.loggedAt),
        ]),
      ),
    );
    lines.push('');
    lines.push(
      '理由: CROSS_CHECK_DIFF = 2つ目の取得元との差が許容を超えた。PRICE_JUMP = 直前の分からの変化が大きすぎた(両方つくこともある)。' +
        'これらの足は反応計算(値動きの算出)には使われない。',
    );
  }
  lines.push('');

  // 3 -----------------------------------------------------------------------
  lines.push('## 3. 集約足(5分〜60分)');
  lines.push('');
  const timeframes = report.fx[0]?.aggregates.map((a) => a.timeframe) ?? [];
  lines.push('### (a) 作成可能区間での成功率');
  lines.push('');
  lines.push(
    ...table(
      ['通貨ペア', ...timeframes],
      report.fx.map((f) => [f.symbol, ...f.aggregates.map((a) => aggregateCell(f, a, 'success'))]),
    ),
  );
  lines.push('');
  lines.push(
    '作成済み ÷ 作成可能な区間。作成可能な区間 = 1分足がすべて揃っていて UNVERIFIED を含まない区間(集約処理が正しく動いているかを見る)。',
  );
  lines.push('');
  lines.push('### (b) 評価期間全体に対するカバレッジ');
  lines.push('');
  lines.push(
    ...table(
      ['通貨ペア', ...timeframes],
      report.fx.map((f) => [f.symbol, ...f.aggregates.map((a) => aggregateCell(f, a, 'coverage'))]),
    ),
  );
  lines.push('');
  lines.push(
    '作成済み ÷ 評価対象の区間。評価対象の区間 = 取り込み開始後〜期間の終わりに収まり、全体が市場時間の区間(1分足の欠損があると下がる。実際に使える集約足の割合)。',
  );
  lines.push('');

  // 4 -----------------------------------------------------------------------
  lines.push('## 4. 発表・発言前後の1分足');
  lines.push('');
  lines.push(
    `発表・発言時刻 T に対し、T−${RELEASE_WINDOW_MINUTES.before}分〜T+${RELEASE_WINDOW_MINUTES.after}分の1分足(UNVERIFIED は欠損扱い)が全部あるか。件数(発表・発言の数)と通貨ペア別の判定件数を分けて数える。`,
  );
  lines.push('');
  const rw = report.releaseWindows;
  lines.push(windowLine('経済指標(RELEASED)', ECONOMIC_EMPTY, rw.byKind.ECONOMIC, rw.pairs));
  lines.push(windowLine('要人発言(DELIVERED)', SPEECH_EMPTY, rw.byKind.SPEECH, rw.pairs));
  lines.push('');
  lines.push(
    ...table(
      [
        '種類',
        '期間内の件数',
        '判定した件数',
        '通貨ペア別の判定',
        '完全',
        '欠けあり',
        '完全率',
        '未判定: 取り込み開始前',
        '未判定: 市場時間外',
        '未判定: 期間の端',
      ],
      [
        windowRow('経済指標(RELEASED)', rw.byKind.ECONOMIC, ECONOMIC_EMPTY),
        windowRow('要人発言(DELIVERED)', rw.byKind.SPEECH, SPEECH_EMPTY),
      ],
    ),
  );
  lines.push('');
  lines.push('未判定の列は通貨ペア別の件数(件数 × 通貨ペア)。');
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

  // 5 -----------------------------------------------------------------------
  lines.push('## 5. 取得ジョブの実行状況');
  lines.push('');
  if (report.runs.length === 0) lines.push('—(期間内の ingestion_logs なし: どのジョブも実行されていない)');
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
          r.medianDurationSeconds === null ? '—(完了記録なし)' : r.medianDurationSeconds.toFixed(1),
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
    `- 成功した実行の最長間隔: ${num(s.longestIntervalMinutes, '成功した実行が2回未満')}${s.longestInterval ? ` 分(${time(s.longestInterval.from)} 〜 ${time(s.longestInterval.to)})` : ''}`,
  );
  lines.push(
    `- 最後の成功からの経過: ${num(s.minutesSinceLastSuccess, '成功した実行なし')}${s.minutesSinceLastSuccess === null ? '' : ' 分'}`,
  );
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

  // 6 -----------------------------------------------------------------------
  lines.push('## 6. API 利用量と取り込み件数の照合');
  lines.push('');
  const u = report.apiUsage;
  lines.push('### API リクエスト(ingest:fx-prices のログ)');
  lines.push('');
  if (u.runsWithCount === 0) {
    lines.push(
      u.fxRuns === 0
        ? '—(期間内に ingest:fx-prices の実行なし)'
        : `—(ログに API リクエスト数の記録なし: 期間内の ${u.fxRuns} 回はすべて古い形式の実行)`,
    );
  } else {
    lines.push(
      `- 合計: ${u.totalRequests} リクエスト(記録のある実行 ${u.runsWithCount} 回 / ingest:fx-prices の実行 ${u.fxRuns} 回)`,
    );
    lines.push(`- 1回の実行の最大: ${u.maxPerRun!.requests} リクエスト(${time(u.maxPerRun!.startedAt)})`);
    if (u.latestBudget) {
      lines.push(
        `- 最新の予算記録(${time(u.latestBudget.startedAt)}): 1日 ${num(u.latestBudget.daily)} / 実行前の使用 ${num(u.latestBudget.usedBeforeRun)} / 実行後の残り ${num(u.latestBudget.leftAfterRun)}`,
      );
    }
    lines.push('');
    lines.push(
      ...table(
        [
          '日付(UTC)',
          'リクエスト',
          '記録のある実行',
          `プラン上限 ${u.dailyLimit} に対して`,
          `予算 ${u.dailyBudget} に対して`,
        ],
        u.perDay.map((d) => [
          d.date,
          String(d.requests),
          String(d.runs),
          `${percent(d.requests / u.dailyLimit)}${d.requests > u.dailyLimit ? '(超過)' : ''}`,
          `${percent(d.requests / u.dailyBudget)}${d.requests > u.dailyBudget ? '(超過)' : ''}`,
        ]),
      ),
    );
  }
  lines.push('');
  if (u.latestUnrecovered) {
    const reasons = Object.entries(u.latestUnrecovered.minutesByReason).map(
      ([reason, minutes]) => `${MISSING_CAUSE_LABELS[reason as MissingCause] ?? reason} ${minutes}分`,
    );
    lines.push(
      `- 最新の実行(${time(u.latestUnrecovered.startedAt)})の未回収: ${reasons.length === 0 ? 'なし' : reasons.join(', ')}(unrecovered_total ${num(u.latestUnrecovered.total)})`,
    );
    lines.push('');
  }
  lines.push('### API クレジット(api_credit_usage、UTC 日ごと)');
  lines.push('');
  lines.push(
    `- 上限: 自動取り込み ${CREDIT_CAPS.AUTO} / 手動 最大 ${CREDIT_CAPS.MANUAL} / 契約プラン ${CREDIT_CAPS.PLAN}(1日)。契約プランは未確認(Basic 前提)`,
  );
  lines.push('- 失敗・再試行がクレジットを消費するかは未確認のため、試行ごとに予約して数えている');
  lines.push('');
  const c = report.credits;
  if (c === null) lines.push('—(クレジット記録なし)');
  else if (c.days.length === 0) lines.push('—(期間内のクレジット記録なし)');
  else {
    lines.push(
      ...table(
        [
          '日付(UTC)',
          '取得元',
          `自動取り込み(上限 ${CREDIT_CAPS.AUTO})`,
          `手動(上限 ${CREDIT_CAPS.MANUAL})`,
          'eval:providers',
          `合計(プラン ${CREDIT_CAPS.PLAN})`,
          '超過',
        ],
        c.days.map((d) => [
          d.date,
          d.provider,
          String(d.auto),
          String(d.manual),
          String(d.eval),
          String(d.total),
          [d.overAutoCap ? '自動' : '', d.overManualCap ? '手動' : '', d.overPlan ? 'プラン' : '']
            .filter(Boolean)
            .join('・') || 'なし',
        ]),
      ),
    );
    if (c.manualJobs.length > 0) {
      lines.push('');
      lines.push(`手動に数えたジョブ: ${c.manualJobs.join(', ')}`);
    }
  }
  lines.push('');
  lines.push('### 取り込み件数の照合(ingest:fx-prices のログ reconciliation の合計)');
  lines.push('');
  const r = u.reconciliation;
  if (r === null) lines.push('—(ログに照合件数の記録なし: 古い形式の実行のみ)');
  else {
    lines.push(
      ...table(
        ['項目', '合計'],
        [
          ['記録のある実行', String(r.runs)],
          ['fetched(取得)', String(r.fetched)],
          ['accepted(採用)', String(r.accepted)],
          ['rejected(除外)', `${r.rejected}(${counts(r.rejectedByReason)})`],
          ['upserted_1m', String(r.upserted1m)],
          ['upserted_aggregated', String(r.upsertedAggregated)],
          ['corrected(訂正)', String(r.corrected)],
          ['failed_requests(失敗したリクエスト)', String(r.failedRequests)],
        ],
      ),
    );
    lines.push('');
    lines.push(
      r.mismatchRuns === 0 && !r.sumMismatch
        ? '- 件数の整合: 一致(fetched = accepted + rejected、upserted_1m = accepted)'
        : `- 件数の整合: **不一致あり**(fetched ≠ accepted + rejected、または upserted_1m ≠ accepted。不一致の実行 ${r.mismatchRuns} 回${r.sumMismatch ? '、合計でも不一致' : ''})`,
    );
  }
  lines.push('');

  // 7 -----------------------------------------------------------------------
  lines.push('## 7. 時刻ずれ');
  lines.push('');
  lines.push(
    `- 為替: 最新1分足の経過時間(レポート作成時点、足の終了時刻から): ${
      report.fx
        .map((f) => {
          const age = report.latestCandleAgeMinutes[f.symbol] ?? null;
          return `${f.symbol} ${age === null ? 'データなし' : `${age}分`}`;
        })
        .join(', ') || '—(通貨ペアなし)'
    }`,
  );
  lines.push('- 為替: 実行ごとの「足の時刻と取得時刻の差」は未集計(このレポートでは計測していない)。');
  const speechRuns = report.runs.find((r) => r.job === 'ingest:speeches')?.runs ?? 0;
  lines.push(
    `- 要人発言: 正確な時刻が無いためスキップした発言(TIME_NOT_EXACT): ${speechRuns === 0 ? '—(期間内に ingest:speeches の実行なし)' : `${report.speechTimeNotExact} 件`}。発言時刻そのもののずれは自動では測れない(手作業で公式発表と照合)。`,
  );
  lines.push('');

  // 8 -----------------------------------------------------------------------
  lines.push('## 8. 経済指標の値');
  lines.push('');
  const e = report.economic;
  if (e.state === 'NO_DATA') {
    lines.push('- 状態: 未検証(経済指標データ未取得)');
    lines.push(
      '- 期間内に economic_events・event_snapshots の行が無い(経済カレンダーの取り込みが未実行)。一致率は算出しない',
    );
  } else {
    if (e.state === 'NOT_RUN') {
      lines.push('- 状態: 未検証(照合処理未実行)');
      lines.push('- 経済指標データはあるが、期間内に ingest:official の実行記録が無い。一致率は算出しない');
    } else {
      lines.push('- 状態: 照合済み');
    }
    if (e.economicEvents !== null) lines.push(`- 期間内の経済指標イベント(economic_events): ${e.economicEvents} 件`);
    lines.push(`- 公開した発表値(event_snapshots RELEASE): ${counts(e.snapshots)}`);
    lines.push(`- 検証待ち・要確認(ingestion_staged_values): ${counts(e.staged)}`);
    lines.push(`- 要確認の理由: ${counts(e.pendingReviewReasons)}`);
    if (e.state === 'MEASURED') {
      lines.push(
        `- 公式統計との一致率: ${rate(e.agreementRate, '公式値と照合できた値なし')}(VERIFIED ${e.snapshots.VERIFIED ?? 0} ÷ (VERIFIED + 公式値と不一致 ${e.officialMismatches}))`,
      );
    }
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}
