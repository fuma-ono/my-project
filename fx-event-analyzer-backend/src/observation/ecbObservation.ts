/**
 * ECB 週間予定の2週間観測(GitHub Actions、.github/workflows/fx-ecb-weekly-snapshot.yml)の確認の判定
 * (HQ指示 2026-10-28「ECB週間予定・観測確認スクリプト」)。入出力の無い純粋な関数だけ。取得と再現テストの実行は
 * src/jobs/checkEcbObservation.ts。
 *
 * - 予定の時刻(09:30 / 17:30 JST = 00:30 / 08:30 UTC)ごとに、Actions の実行と観測ログ(log.jsonl)を突き合わせる
 * - GitHub 側の遅延(予定から実行の開始まで)と、ワークフロー内の失敗(取得・解析・保存の段階)と、
 *   実行は成功したが取得に失敗した記録(HTTP の失敗・項目0件)を分ける
 * - まだ予定の時刻に達していない回・遅延の猶予内の回は欠落にしない
 * - 実行の履歴が読めない(GitHub API の失敗)ときは、欠落0件とせず「集計不能」にする
 * - 1つの記録は1つの実行にだけ対応させる(二重に数えない)
 */

export const OBSERVATION_SLOTS_UTC: readonly (readonly [number, number])[] = [
  [0, 30],
  [8, 30],
];
/** 予定の時刻から実行の開始までがこれを超えたら「遅延」(GitHub 側)。 */
export const DELAY_MINUTES = 30;
/** 予定の時刻からこの時間までは、実行が無くても欠落にしない(GitHub の定期実行は数十分遅れることがある)。 */
export const PENDING_GRACE_MINUTES = 120;
const MINUTE_MS = 60_000;

/** GET /repos/{repo}/actions/workflows/{file}/runs の1件(使う列だけ)。 */
export interface WorkflowRun {
  id: number;
  event: string;
  status: string;
  conclusion: string | null;
  created_at: string;
  run_started_at: string | null;
  updated_at: string;
  html_url: string;
}

/** 失敗した実行の段階(GET .../runs/{id}/jobs の steps)。 */
export interface RunStep {
  name: string;
  conclusion: string | null;
}

/** log.jsonl の1行(fx_ecb_weekly_snapshot.py が書く)。 */
export interface ObservationLogRecord {
  fetched_at: string;
  http_status: number | null;
  error?: string;
  page_last_modified?: string | null;
  entries?: number;
  board_items?: number;
  parse_errors?: string[];
  snapshot?: string;
  previous?: string;
  added?: string[];
  removed?: string[];
}

export interface ParsedLog {
  /** 読めた行(行番号つき)。 */
  records: { line: number; record: ObservationLogRecord }[];
  /** 形式不正・重複・時刻の不整合など(表示用、日本語)。 */
  problems: string[];
  /** log.jsonl が無い(読めなかった)。 */
  missing: boolean;
}

/** log.jsonl の本文(null = 無い)を読み、形式不正・重複・時刻の順の乱れ・未来の時刻を出す。 */
export function parseObservationLog(text: string | null, now: Date): ParsedLog {
  if (text === null) return { records: [], problems: ['log.jsonl が無い(読めない)'], missing: true };
  const records: ParsedLog['records'] = [];
  const problems: string[] = [];
  const seen = new Set<string>();
  let previousMs: number | null = null;
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = index + 1;
    if (raw.trim() === '') return;
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      problems.push(`${line}行目: JSON として読めない`);
      return;
    }
    const record = value as Partial<ObservationLogRecord>;
    const ms = typeof record.fetched_at === 'string' ? Date.parse(record.fetched_at) : NaN;
    if (!Number.isFinite(ms) || !('http_status' in record)) {
      problems.push(`${line}行目: fetched_at・http_status が無い、または時刻が読めない`);
      return;
    }
    if (seen.has(record.fetched_at!)) {
      problems.push(`${line}行目: 同じ取得日時の行が重複(${record.fetched_at})`);
      return;
    }
    seen.add(record.fetched_at!);
    if (previousMs !== null && ms < previousMs) problems.push(`${line}行目: 取得日時が前の行より前(順序の乱れ)`);
    if (ms > now.getTime() + 5 * MINUTE_MS) problems.push(`${line}行目: 取得日時が現在より先(${record.fetched_at})`);
    previousMs = ms;
    records.push({ line, record: record as ObservationLogRecord });
  });
  return { records, problems, missing: false };
}

/** 観測の期間で、予定の時刻に達した回(start より後、min(now, stop) 以前)。未到来の回は入れない。 */
export function dueSlots(start: Date, stop: Date, now: Date, slotsUtc = OBSERVATION_SLOTS_UTC): Date[] {
  const end = Math.min(now.getTime(), stop.getTime());
  const slots: Date[] = [];
  const day = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  for (let d = day.getTime(); d <= end; d += 24 * 60 * MINUTE_MS) {
    for (const [hour, minute] of slotsUtc) {
      const slot = d + (hour * 60 + minute) * MINUTE_MS;
      if (slot > start.getTime() && slot <= end) slots.push(new Date(slot));
    }
  }
  return slots;
}

export type SlotOutcome =
  /** 実行が成功し、取得・保存もできた */
  | 'OK'
  /** 実行は成功したが、記録は取得の失敗(HTTP の失敗・通信の失敗・項目0件) */
  | 'FETCH_FAILED'
  /** ワークフローの段階が失敗した(取得・解析、保存、その他) */
  | 'WORKFLOW_FAILED'
  /** 実行は成功したのに、対応する記録が無い */
  | 'RECORD_MISSING'
  /** 実行中・待ち */
  | 'RUNNING'
  /** 予定の時刻を過ぎたが、猶予の内(まだ欠落にしない) */
  | 'PENDING'
  /** 猶予を過ぎても実行が無い(GitHub が起動しなかった) */
  | 'MISSING'
  /** 実行の履歴が読めない(推定は記録からだけ) */
  | 'UNKNOWN';

export interface SlotResult {
  slot: string;
  outcome: SlotOutcome;
  run: { id: number; started_at: string | null; ended_at: string; conclusion: string | null; url: string } | null;
  /** 予定の時刻から実行の開始まで(分)。GitHub 側の遅延。 */
  delayMinutes: number | null;
  delayed: boolean;
  /** 失敗した段階(WORKFLOW_FAILED のとき)。 */
  failedStep: string | null;
  failureKind: '取得・解析' | '保存' | 'その他' | null;
  /** 対応した記録の行番号。 */
  recordLine: number | null;
  /** 記録の取得の失敗の内容(FETCH_FAILED のとき)。 */
  fetchError: string | null;
  /** API が読めないとき、記録だけから推定した内容。 */
  estimate: string | null;
}

export interface ObservationSummary {
  slots: SlotResult[];
  /** 予定の時刻以外の実行(初回の push・手動)。 */
  otherRuns: { run: WorkflowRun; recordLine: number | null }[];
  /** どの実行にも対応しない記録(時刻の不整合)。 */
  unmatchedRecords: number[];
  /** 実行の履歴が読めたか。false = 集計不能。 */
  runsAvailable: boolean;
  counts: Record<SlotOutcome, number> & { delayed: number };
}

function failureKindOf(step: string | null): SlotResult['failureKind'] {
  if (step === null) return null;
  if (/fetch and record/i.test(step)) return '取得・解析';
  if (/commit/i.test(step)) return '保存';
  return 'その他';
}

/**
 * 予定の時刻ごとの判定。`runs` が null(API が読めない)なら、各回は UNKNOWN で、記録があれば estimate に
 * 「記録あり(実行されたと推定)」を入れる(欠落0件とは数えない)。`failedSteps` は失敗した実行の id → 段階。
 */
export function summarizeObservation(input: {
  start: Date;
  stop: Date;
  now: Date;
  runs: readonly WorkflowRun[] | null;
  failedSteps?: ReadonlyMap<number, readonly RunStep[]>;
  log: ParsedLog;
}): ObservationSummary {
  const { start, stop, now, runs, log } = input;
  const slots = dueSlots(start, stop, now);
  const used = new Set<number>(); // 対応済みの記録の行番号(二重に数えない)
  const recordTimes = log.records.map(({ line, record }) => ({ line, record, ms: Date.parse(record.fetched_at) }));

  const takeRecord = (fromMs: number, toMs: number) => {
    const hit = recordTimes.find((r) => !used.has(r.line) && r.ms >= fromMs && r.ms <= toMs);
    if (hit) used.add(hit.line);
    return hit ?? null;
  };

  const results: SlotResult[] = [];
  const otherRuns: ObservationSummary['otherRuns'] = [];
  const base = (slot: Date): SlotResult => ({
    slot: slot.toISOString(),
    outcome: 'UNKNOWN',
    run: null,
    delayMinutes: null,
    delayed: false,
    failedStep: null,
    failureKind: null,
    recordLine: null,
    fetchError: null,
    estimate: null,
  });

  if (runs === null) {
    slots.forEach((slot, index) => {
      const next = slots[index + 1]?.getTime() ?? slot.getTime() + 8 * 60 * MINUTE_MS;
      const hit = takeRecord(slot.getTime(), next - 1);
      const result = base(slot);
      if (hit) {
        result.recordLine = hit.line;
        result.delayMinutes = Math.round((hit.ms - slot.getTime()) / MINUTE_MS);
        result.estimate = `記録あり(${result.delayMinutes}分後に取得。実行されたと推定)`;
      } else {
        result.estimate =
          now.getTime() < slot.getTime() + PENDING_GRACE_MINUTES * MINUTE_MS ? '記録なし(猶予の内)' : '記録なし';
      }
      results.push(result);
    });
  } else {
    const sorted = [...runs].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
    const scheduled = sorted.filter((run) => run.event === 'schedule');
    const claimed = new Set<number>();
    slots.forEach((slot, index) => {
      const next = slots[index + 1]?.getTime() ?? Number.POSITIVE_INFINITY;
      const result = base(slot);
      const run = scheduled.find(
        (r) => !claimed.has(r.id) && Date.parse(r.created_at) >= slot.getTime() && Date.parse(r.created_at) < next,
      );
      if (!run) {
        result.outcome = now.getTime() < slot.getTime() + PENDING_GRACE_MINUTES * MINUTE_MS ? 'PENDING' : 'MISSING';
        results.push(result);
        return;
      }
      claimed.add(run.id);
      const startedMs = Date.parse(run.run_started_at ?? run.created_at);
      result.run = {
        id: run.id,
        started_at: run.run_started_at,
        ended_at: run.updated_at,
        conclusion: run.conclusion,
        url: run.html_url,
      };
      result.delayMinutes = Math.round((startedMs - slot.getTime()) / MINUTE_MS);
      result.delayed = result.delayMinutes > DELAY_MINUTES;
      const record = takeRecord(startedMs - MINUTE_MS, Date.parse(run.updated_at) + MINUTE_MS);
      result.recordLine = record?.line ?? null;
      if (run.status !== 'completed') {
        result.outcome = 'RUNNING';
      } else if (run.conclusion !== 'success') {
        result.outcome = 'WORKFLOW_FAILED';
        const steps = input.failedSteps?.get(run.id) ?? [];
        result.failedStep = steps.find((step) => step.conclusion === 'failure')?.name ?? null;
        result.failureKind = failureKindOf(result.failedStep);
      } else if (!record) {
        result.outcome = 'RECORD_MISSING';
      } else if (record.record.error || record.record.http_status !== 200) {
        result.outcome = 'FETCH_FAILED';
        result.fetchError = record.record.error ?? `HTTP ${record.record.http_status}`;
      } else {
        result.outcome = 'OK';
      }
      results.push(result);
    });
    for (const run of sorted.filter((r) => !claimed.has(r.id))) {
      const startedMs = Date.parse(run.run_started_at ?? run.created_at);
      const record = takeRecord(startedMs - MINUTE_MS, Date.parse(run.updated_at) + MINUTE_MS);
      otherRuns.push({ run, recordLine: record?.line ?? null });
    }
  }

  const counts = {
    OK: 0,
    FETCH_FAILED: 0,
    WORKFLOW_FAILED: 0,
    RECORD_MISSING: 0,
    RUNNING: 0,
    PENDING: 0,
    MISSING: 0,
    UNKNOWN: 0,
    delayed: 0,
  };
  for (const result of results) {
    counts[result.outcome] += 1;
    if (result.delayed) counts.delayed += 1;
  }
  return {
    slots: results,
    otherRuns,
    unmatchedRecords: recordTimes.filter((r) => !used.has(r.line)).map((r) => r.line),
    runsAvailable: runs !== null,
    counts,
  };
}

/** 再現テスト(tests/ingestion/ecbWeeklyReplay.test.ts)の1ページ分の出力(使う列だけ)。 */
interface ReplayLine {
  snapshot: string;
  coverage: { fromIso: string; toIso: string } | null;
  parsed: number;
  feed_skipped: string[];
  uncertain_days: string[];
  page_anomaly: string | null;
  pipeline_skips: Record<string, number>;
  cancelled: unknown[];
  rescheduled: unknown[];
  held: unknown[];
  cancel_suppressed: unknown[];
}

/** ページごとの解析結果。ページの本文(題名・名前・連絡先)は入れない(件数・理由・日付だけ)。 */
export interface ReplayPageResult {
  snapshot: string;
  speeches: number;
  skipped: number;
  skipReasons: Record<string, number>;
  /** 読み漏れの跡(時刻・名前・日付が読めない)とページの異常。 */
  parseErrors: string[];
  coverage: { fromIso: string; toIso: string } | null;
  uncertainDays: string[];
  judgments: { cancelled: number; rescheduled: number; held: number; cancelSuppressed: number };
}

export interface ReplaySummary {
  ok: boolean;
  pages: ReplayPageResult[];
  /** 出力に出てこなかった保存ページ。 */
  missingPages: string[];
  /** 失敗の原因の手がかり(エラーの種類と1行目だけ。ページの本文は入れない)。 */
  failure: string | null;
}

const UNREADABLE = new Set(['TIME_MISSING', 'TIME_NONEXISTENT', 'BOARD_MEMBER_UNREADABLE', 'DATE_UNPARSEABLE']);

/** 再現テストの標準出力と終了コードから、ページごとの結果をまとめる。 */
export function summarizeReplay(stdout: string, exitCode: number | null, expected: readonly string[]): ReplaySummary {
  const pages: ReplayPageResult[] = [];
  for (const raw of stdout.split(/\r?\n/)) {
    if (!raw.startsWith('{"snapshot"')) continue;
    let line: ReplayLine;
    try {
      line = JSON.parse(raw) as ReplayLine;
    } catch {
      continue;
    }
    const skipReasons: Record<string, number> = {};
    for (const item of line.feed_skipped) {
      const reason = item.split(' ')[1] ?? 'UNKNOWN';
      skipReasons[reason] = (skipReasons[reason] ?? 0) + 1;
    }
    for (const [reason, n] of Object.entries(line.pipeline_skips)) {
      skipReasons[`pipeline:${reason}`] = (skipReasons[`pipeline:${reason}`] ?? 0) + n;
    }
    const parseErrors = Object.keys(skipReasons).filter((reason) => UNREADABLE.has(reason));
    if (line.page_anomaly) parseErrors.push(`PAGE_ANOMALY:${line.page_anomaly}`);
    pages.push({
      snapshot: line.snapshot,
      speeches: line.parsed,
      skipped: line.feed_skipped.length,
      skipReasons,
      parseErrors,
      coverage: line.coverage,
      uncertainDays: line.uncertain_days,
      judgments: {
        cancelled: line.cancelled.length,
        rescheduled: line.rescheduled.length,
        held: line.held.length,
        cancelSuppressed: line.cancel_suppressed.length,
      },
    });
  }
  const seen = new Set(pages.map((page) => page.snapshot));
  const missingPages = expected.filter((name) => !seen.has(name));
  const ok = exitCode === 0 && missingPages.length === 0;
  let failure: string | null = null;
  if (!ok) {
    const errorLine = stdout
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => /^(AssertionError|Error|TypeError|SyntaxError|FAIL)\b/.test(l));
    failure =
      `終了コード ${exitCode ?? '不明'}` +
      (missingPages.length > 0 ? `、結果の出なかったページ ${missingPages.length} 件` : '') +
      (errorLine ? `、${errorLine.slice(0, 160)}` : '');
  }
  return { ok, pages, missingPages, failure };
}

const OUTCOME_LABEL: Record<SlotOutcome, string> = {
  OK: '成功',
  FETCH_FAILED: '取得の失敗(実行は成功)',
  WORKFLOW_FAILED: 'ワークフローの失敗',
  RECORD_MISSING: '記録なし(実行は成功)',
  RUNNING: '実行中',
  PENDING: '判定待ち(猶予の内)',
  MISSING: '欠落(実行されなかった)',
  UNKNOWN: '集計不能',
};

/**
 * レポート(Markdown)。「確認できた事実」「推定」「確認不能」を分ける。ページの本文・連絡先は入れない
 * (件数・理由・日付・実行の URL だけ)。
 */
export function renderObservationReport(input: {
  now: Date;
  state: { started_at: string; stop_after: string } | null;
  stateError: string | null;
  workflowState: string | null;
  apiError: string | null;
  summary: ObservationSummary;
  log: ParsedLog;
  replay: ReplaySummary | null;
  replayError: string | null;
}): string {
  const { now, state, summary, log, replay } = input;
  const facts: string[] = [];
  const estimates: string[] = [];
  const unknowns: string[] = [];
  const lines: string[] = [`# ECB 週間予定の観測の確認(${now.toISOString().slice(0, 16)}Z)`, ''];

  if (state) {
    facts.push(`観測の期間: ${state.started_at} 〜 ${state.stop_after}`);
    if (now.getTime() >= Date.parse(state.stop_after)) {
      if (input.workflowState === 'active') facts.push('停止の期限を過ぎたのに、ワークフローが有効のまま(要確認)');
      else if (input.workflowState) facts.push(`停止の期限後。ワークフローの状態: ${input.workflowState}`);
    }
  } else {
    unknowns.push(`観測の期間(state.json)が読めない: ${input.stateError ?? '不明'}`);
  }
  if (input.workflowState) facts.push(`ワークフローの状態: ${input.workflowState}`);

  const c = summary.counts;
  if (summary.runsAvailable) {
    facts.push(
      `予定の時刻 ${summary.slots.length} 回: 成功 ${c.OK} / 取得の失敗 ${c.FETCH_FAILED} / ワークフローの失敗 ${c.WORKFLOW_FAILED} / ` +
        `記録なし ${c.RECORD_MISSING} / 実行中 ${c.RUNNING} / 欠落 ${c.MISSING}(うち遅延 ${c.delayed})。判定待ち ${c.PENDING}`,
    );
    if (c.delayed > 0)
      estimates.push(
        `遅延 ${c.delayed} 回は GitHub 側の起動の遅れ(予定から実行の開始まで ${DELAY_MINUTES} 分超)と推定`,
      );
    if (c.MISSING > 0) estimates.push(`欠落 ${c.MISSING} 回は GitHub が定期実行を起動しなかったと推定(混雑時に起きる)`);
    for (const r of summary.slots.filter((s) => s.outcome === 'WORKFLOW_FAILED' && s.failedStep === null)) {
      unknowns.push(`${r.slot} の失敗した段階が読めない(${r.run?.url ?? ''})`);
    }
  } else {
    unknowns.push(`実行の履歴が読めない(${input.apiError ?? '不明'})。成功・失敗・欠落は集計不能(欠落0件とは数えない)`);
    const withRecord = summary.slots.filter((s) => s.recordLine !== null).length;
    estimates.push(`記録からの推定: 予定の時刻 ${summary.slots.length} 回のうち、記録のある回 ${withRecord} 回`);
  }
  if (summary.otherRuns.length > 0) {
    facts.push(
      `予定の時刻以外の実行 ${summary.otherRuns.length} 回: ` +
        summary.otherRuns.map(({ run }) => `${run.event} ${run.conclusion ?? run.status}`).join('、'),
    );
  }

  if (log.missing) unknowns.push('観測ログ(log.jsonl)が無い・読めない');
  else facts.push(`観測ログ ${log.records.length} 行`);
  for (const problem of log.problems) facts.push(`観測ログの問題: ${problem}`);
  if (summary.unmatchedRecords.length > 0 && summary.runsAvailable) {
    facts.push(
      `どの実行にも対応しない記録(時刻の不整合): ${summary.unmatchedRecords.map((n) => `${n}行目`).join('、')}`,
    );
  }
  const records = log.records.map((r) => r.record);
  const stamps = [...new Set(records.map((r) => r.page_last_modified).filter((s): s is string => !!s))];
  if (records.length > 0) {
    facts.push(`ページの更新日時: ${stamps.length > 0 ? stamps.join(' / ') : '記録なし'}`);
    const changed = records.filter((r) => (r.added?.length ?? 0) + (r.removed?.length ?? 0) > 0);
    facts.push(
      changed.length === 0
        ? '前回との差分: すべて +0/−0(またはまだ比べる前回が無い)'
        : `前回との差分のあった取得 ${changed.length} 回: ` +
            changed.map((r) => `${r.fetched_at} +${r.added?.length ?? 0}/−${r.removed?.length ?? 0}`).join('、'),
    );
    const errors = records.filter((r) => (r.parse_errors?.length ?? 0) > 0 || r.error);
    if (errors.length > 0) {
      facts.push(
        `取得・解析のエラーのあった記録 ${errors.length} 回: ` +
          errors.map((r) => `${r.fetched_at} ${r.error ?? `解析エラー ${r.parse_errors?.length ?? 0}`}`).join('、'),
      );
    }
  }

  if (replay) {
    if (replay.ok) facts.push(`再現テスト: 成功(保存ページ ${replay.pages.length} 件)`);
    else facts.push(`再現テスト: 失敗(${replay.failure ?? '原因不明'})`);
    const judged = replay.pages.filter(
      (p) => p.judgments.cancelled + p.judgments.rescheduled + p.judgments.held + p.judgments.cancelSuppressed > 0,
    );
    if (judged.length === 0) unknowns.push('実際の予定の変更・削除は、まだ観測されていない(取り込みの判定は未検証)');
    else facts.push(`取り込みの判定があったページ ${judged.length} 件(下の表)`);
  } else {
    unknowns.push(`再現テストを実行できない(${input.replayError ?? '保存ページなし'})`);
  }

  const section = (title: string, items: string[]) => {
    lines.push(`## ${title}`, '');
    lines.push(...(items.length > 0 ? items.map((item) => `- ${item}`) : ['- なし']), '');
  };
  section('確認できた事実', facts);
  section('推定', estimates);
  section('確認不能', unknowns);

  lines.push(
    '## 予定の時刻ごと',
    '',
    '| 予定(UTC) | 結果 | 開始 | 終了 | 遅延(分) | 失敗の段階 | 記録 |',
    '|---|---|---|---|---|---|---|',
  );
  for (const s of summary.slots) {
    lines.push(
      `| ${s.slot.slice(0, 16)}Z | ${OUTCOME_LABEL[s.outcome]}${s.delayed ? '・遅延' : ''}${s.fetchError ? `(${s.fetchError})` : ''}` +
        `${s.estimate ? `(${s.estimate})` : ''} | ${s.run?.started_at ?? '-'} | ${s.run?.ended_at ?? '-'} | ` +
        `${s.delayMinutes ?? '-'} | ${s.failedStep ? `${s.failureKind}: ${s.failedStep}` : '-'} | ${s.recordLine ? `${s.recordLine}行目` : '-'} |`,
    );
  }
  lines.push('');
  if (replay && replay.pages.length > 0) {
    lines.push(
      '## 保存ページの再現テスト(古い順)',
      '',
      '| ページ | 発言 | スキップ(理由) | 解析エラー | 範囲 | 区別できない日 | 中止 / 時刻の変更 / 保留 / 安全弁 |',
      '|---|---|---|---|---|---|---|',
    );
    for (const p of replay.pages) {
      const reasons =
        Object.entries(p.skipReasons)
          .map(([r, n]) => `${r} ${n}`)
          .join(', ') || '-';
      lines.push(
        `| ${p.snapshot} | ${p.speeches} | ${p.skipped}(${reasons}) | ${p.parseErrors.join(', ') || 'なし'} | ` +
          `${p.coverage ? `${p.coverage.fromIso.slice(0, 16)}〜${p.coverage.toIso.slice(0, 16)}` : '不明'} | ` +
          `${p.uncertainDays.join(', ') || '-'} | ${p.judgments.cancelled} / ${p.judgments.rescheduled} / ${p.judgments.held} / ${p.judgments.cancelSuppressed} |`,
      );
    }
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}
