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
  MAX_MISMATCH_DETAILS,
  MISSING_CAUSES,
  RELEASE_WINDOW_MINUTES,
  SPEECH_INGEST_PAST_DAYS,
  SPEECH_OVERDUE_HOURS,
  SPEECH_SOURCE_STALE_DAYS,
  SPEECH_SUCCESS_MAX_AGE_HOURS,
  type AggregateCoverage,
  type DataQualityReport,
  type FxCompleteness,
  type MissingCause,
  type ReleaseWindowCounts,
  type SpeechFreshness,
  type SpeechFreshnessJudgement,
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
  const FRESHNESS_LABEL: Record<string, string> = {
    NORMAL: '正常',
    WARNING: '警告',
    CRITICAL: '異常',
    MARKET_CLOSED: '休場中(判定対象外)',
    NO_DATA: 'データなし',
  };
  lines.push(
    `- 為替: 最新1分足の経過時間(レポート作成時点、足の終了時刻から): ${
      report.fx
        .map((f) => {
          const age = report.latestCandleAgeMinutes[f.symbol] ?? null;
          const status = report.candleFreshness[f.symbol] ?? 'NO_DATA';
          const ageText = age === null ? 'データなし' : `${age}分`;
          return `${f.symbol} ${ageText}(${FRESHNESS_LABEL[status] ?? status})`;
        })
        .join(', ') || '—(通貨ペアなし)'
    }`,
  );
  lines.push(
    '- 判定基準(HQ決定2026-10-18): 正常=25分以内、警告=25分超〜45分以内、異常=45分超' +
      '(取り込みは20分ごと+finality lag 2分のため、1サイクル分の遅れは正常、2サイクル以内は警告とする)。' +
      '市場休場中(週末・祝日)は新しい足自体が来ないため「休場中」として判定しない(誤警告の防止)。',
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
  lines.push(
    '- 相場反応の計算状況(HQ指示2026-10-18「未実装・実装済み未検証・テスト済みを区別する」): ' +
      '要人発言の値動きは従来から実装・テスト済み(API応答時にその場で計算、speechReactions.ts)。' +
      '経済指標の値動き(event_price_reactions)は2026-10-18に実装(ingest:event-reactions、' +
      '自動テストのみ・実データでの検証はまだ行っていない)。実機での表示確認はいずれも未実施。',
  );
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
      lines.push('');
      lines.push('### 検証の内訳(自己一致は独立照合に数えない、HQ判断 2026-10-17)');
      lines.push('');
      lines.push(
        ...table(
          ['分類', '件数', '説明'],
          [
            ['独立照合済み', String(e.independentlyVerified), '取得元と照合元が別(本当の裏付け)'],
            ['自己一致', String(e.selfMatched), '取得元と照合元が同じ出所(例: BLSスケジュール経由。独立検証ではない)'],
            ['単一ソース・未照合', String(e.singleSource), '照合先が無い、または不要な指標'],
            ['差異あり', String(e.officialMismatches), '公式値と不一致(要確認のまま、公開していない)'],
            [
              '未発表・確認待ち',
              String(e.awaitingOfficial),
              '実績値はあるが公式統計での確認がまだ(ingest:official待ち)',
            ],
          ],
        ),
      );
      lines.push('');
      lines.push(
        `独立照合の一致率(自己一致を除く): ${rate(e.independentAgreementRate, '独立照合できた値なし')}(独立照合済み ${e.independentlyVerified} ÷ (独立照合済み + 差異あり ${e.officialMismatches}))`,
      );
      lines.push('');
      lines.push(`### 差異あり の一覧(最大${MAX_MISMATCH_DETAILS}件)`);
      lines.push('');
      if (e.mismatches.length === 0) {
        lines.push('—(差異ありの指標なし)');
      } else {
        lines.push(
          ...table(
            ['指標', '対象期間', '取得元', '値', '公式値'],
            e.mismatches.map((m) => [
              m.indicatorCode,
              m.referencePeriod ?? '—',
              m.provider,
              m.actual === null ? '—' : String(m.actual),
              m.officialActual === null ? '—' : String(m.officialActual),
            ]),
          ),
        );
      }
    }
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

// ---------------------------------------------------------------------------
// 9. 要人発言の鮮度(HQ承認 2026-10-23)。第1〜8章とは別に描画し、run.ts が末尾に足す
// (第1〜8章の出力は変えない)
// ---------------------------------------------------------------------------

export const SPEECH_FRESHNESS_LABELS: Record<SpeechFreshnessJudgement, string> = {
  FETCH_FAILED: '取得の失敗(異常)',
  INGEST_GAP: '取り込みの漏れ(異常)',
  SOURCE_NOT_UPDATED: '取得元の更新なし(注意)',
  OVERDUE_SCHEDULED: '終わった予定が SCHEDULED のまま(注意)',
  TIME_NOT_EXACT_ONLY: '時刻なしで未取り込み(情報)',
  NORMAL: '正常',
};

const NOT_RECORDED = '—(記録なし)';

function fetchedWithDiff(f: SpeechFreshness): string {
  const latest = f.latest?.fetched_count ?? null;
  if (latest === null) return NOT_RECORDED;
  const previous = f.previous?.fetched_count ?? null;
  if (!f.previous) return `${latest}(前回の実行なし)`;
  if (previous === null) return `${latest}(前回は記録なし)`;
  const diff = latest - previous;
  return `${latest}(前回比 ${diff > 0 ? '+' : diff < 0 ? '−' : '±'}${Math.abs(diff)})`;
}

function speechFreshnessRows(f: SpeechFreshness): string[] {
  const run = f.latest;
  const noRun = '—(実行記録なし)';
  return [
    SPEECH_FRESHNESS_LABELS[f.judgement],
    f.judgementReasons.length === 0 ? '—' : f.judgementReasons.join('、'),
    run ? time(run.started_at) : noRun,
    run ? (run.completed_at ? time(run.completed_at) : NOT_RECORDED) : noRun,
    run ? `${run.status}(エラー ${run.error_count ?? 0} 件)` : noRun,
    run ? fetchedWithDiff(f) : noRun,
    run ? num(run.success_count) : noRun,
    run ? counts(f.skipReasons) : noRun,
    !run || !f.sourceRecorded ? NOT_RECORDED : f.sourceLatestAt ? time(f.sourceLatestAt) : '—(取得0件)',
    !run || f.sourceFutureCount === null ? NOT_RECORDED : String(f.sourceFutureCount),
    f.db.latestAt ? time(f.db.latestAt) : '—(行なし)',
    String(f.db.futureScheduled),
    String(f.db.overdueScheduled),
    f.lastSuccessAt ? time(f.lastSuccessAt) : '—(SUCCESSなし)',
  ];
}

export function renderSpeechFreshnessMarkdown(freshness: readonly SpeechFreshness[]): string {
  const lines: string[] = [];
  lines.push('## 9. 要人発言の鮮度');
  lines.push('');
  lines.push(
    `取得元(provider)ごとに、ingest:speeches の最新の実行と speech_events を比べる。FRB と ECB は混ぜずに別々に判定する。対象期間(直近の日数)に関係なく、各取得元の最新の実行と最後の SUCCESS を読む。`,
  );
  lines.push('');
  const columns = freshness.map(speechFreshnessRows);
  const labels = [
    '判定',
    '判定の理由',
    '最新の実行(開始)',
    '最新の実行(完了)',
    '最新の実行の状態',
    '取得件数',
    '取り込み件数',
    'スキップ理由(最新の実行)',
    '取得元の最新の予定(source_latest_at)',
    '取得元の未来の予定(source_future_count)',
    'DB の最新(statement_datetime、状態問わず)',
    'DB の未来の SCHEDULED',
    `DB の開始から ${SPEECH_OVERDUE_HOURS} 時間を過ぎた SCHEDULED`,
    '最後の SUCCESS',
  ];
  lines.push(
    ...table(
      ['項目', ...freshness.map((f) => f.provider)],
      labels.map((label, index) => [label, ...columns.map((column) => column[index]!)]),
    ),
  );
  lines.push('');
  lines.push('判定(上ほど優先。1つだけ表示):');
  lines.push(
    `1. 取得の失敗(異常): 最新の実行が FAILURE/PARTIAL・エラーあり・取得件数 0、または最後の SUCCESS から ${SPEECH_SUCCESS_MAX_AGE_HOURS} 時間以上経過(SUCCESS なしを含む)`,
  );
  lines.push(
    `2. 取り込みの漏れ(異常): 取得元の最新の予定が取り込み期間内(直近 ${SPEECH_INGEST_PAST_DAYS} 日以降。未来を含む)で、DB の最新より新しい(DB に行が無い場合を含む)。取得元の最新はスキップされた項目も含むため、話者未登録(SPEAKER_UNKNOWN 等)でもここに当たる。期間内の項目がすべて時刻なしの実行では判定しない`,
  );
  lines.push(
    `3. 取得元の更新なし(注意): 取得元の最新の予定が ${SPEECH_SOURCE_STALE_DAYS} 日以上前で、未来の予定が 0 件`,
  );
  lines.push(
    `4. 終わった予定が SCHEDULED のまま(注意): 開始から ${SPEECH_OVERDUE_HOURS} 時間を過ぎても SCHEDULED の行がある(ECB の週間予定だけで判定。ほかの取得元は件数の表示だけ)`,
  );
  lines.push(
    '5. 時刻なしで未取り込み(情報): 取り込み期間内の項目がすべて TIME_NOT_EXACT(公開時刻のみ)で取り込み 0 件。ECB RSS の通常の状態',
  );
  lines.push('6. 正常: 上のいずれにも当たらない');
  lines.push('');
  lines.push(
    `「${NOT_RECORDED}」の取得元の最新の予定は、この記録を追加する前の実行。2.・3. は判定せず、1.・4.・5. だけで判定する。ECB の週間予定(ecb_weekly_schedule)は、実行記録が無ければ(INGEST_ECB_WEEKLY が未設定)表示しない。`,
  );
  lines.push('');
  return `${lines.join('\n')}\n`;
}

// ---------------------------------------------------------------------------
// 10. 暫定の予定(HQ判断 2026-10-27 案B)。暫定の予定は通知しないので、発表が近いのに暫定のままの予定
// (= 人が公式の情報を確かめて表を直す作業の漏れ)を出す。第1〜9章とは別に描画し、run.ts が末尾に足す。
// ---------------------------------------------------------------------------

/** これより先の暫定は「注意」ではなく「情報」(通知の候補の範囲 = 7日)。 */
export const PROVISIONAL_WARN_DAYS = 7;
/** 一覧に出す範囲。 */
export const PROVISIONAL_LIST_DAYS = 30;

export function renderProvisionalEventsMarkdown(
  events: readonly { provider_event_id: string | null; indicator_code: string; release_datetime: string }[],
  now: Date,
): string {
  const warnUntil = now.getTime() + PROVISIONAL_WARN_DAYS * 86_400_000;
  const warn = events.filter((e) => Date.parse(e.release_datetime) < warnUntil);
  const lines: string[] = [];
  lines.push('## 10. 暫定の予定(確定の作業の漏れ)');
  lines.push('');
  lines.push(
    `暫定(is_provisional)の予定は通知しない(HQ判断 2026-10-27)。今から ${PROVISIONAL_LIST_DAYS} 日以内に発表があるのに暫定のままの予定を出す。` +
      `${PROVISIONAL_WARN_DAYS} 日以内のものは、確定しないと**通知が出ない**(注意)。公式の情報を確かめ、コードの表を直してジョブを動かす(dev-environment.md 12.7)。`,
  );
  lines.push('');
  lines.push(
    `判定: ${warn.length > 0 ? `注意(${PROVISIONAL_WARN_DAYS}日以内に暫定 ${warn.length} 件)` : events.length > 0 ? '情報(7日より先の暫定のみ)' : '正常(暫定の予定なし)'}`,
  );
  lines.push('');
  if (events.length > 0) {
    lines.push(
      ...table(
        ['発表(UTC)', '指標', 'provider_event_id', '区分'],
        events.map((e) => [
          time(e.release_datetime),
          e.indicator_code,
          e.provider_event_id ?? '—',
          Date.parse(e.release_datetime) < warnUntil ? '注意(通知が出ない)' : '情報',
        ]),
      ),
    );
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}
