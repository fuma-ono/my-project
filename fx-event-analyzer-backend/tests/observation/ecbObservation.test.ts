/**
 * ECB 週間予定の観測の確認(HQ指示 2026-10-28「ECB週間予定・観測確認スクリプト」)の判定。
 * 正常・実行の失敗・取得の失敗・ログの欠落・遅延・未到来の予定時刻・API の失敗・二重計上・ログの不整合・再現テストの失敗。
 */
import { describe, expect, it } from 'vitest';
import {
  dueSlots,
  parseObservationLog,
  renderObservationReport,
  summarizeObservation,
  summarizeReplay,
  type RunStep,
  type WorkflowRun,
} from '../../src/observation/ecbObservation.js';

const START = new Date('2026-10-28T04:17:39Z'); // 初回(push)
const STOP = new Date('2026-11-11T04:17:39Z');
const iso = (s: string) => new Date(s).toISOString();

function run(id: number, createdAt: string, overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  const started = new Date(Date.parse(createdAt) + 10_000).toISOString();
  return {
    id,
    event: 'schedule',
    status: 'completed',
    conclusion: 'success',
    created_at: createdAt,
    run_started_at: started,
    updated_at: new Date(Date.parse(started) + 30_000).toISOString(),
    html_url: `https://github.com/runs/${id}`,
    ...overrides,
  };
}
const rec = (fetchedAt: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ fetched_at: fetchedAt, http_status: 200, entries: 25, board_items: 7, parse_errors: [], ...extra });
const logOf = (lines: string[], now: Date) => parseObservationLog(lines.join('\n'), now);

const PUSH = run(1, '2026-10-28T04:17:20Z', { event: 'push' });
const PUSH_RECORD = rec('2026-10-28T04:17:39+00:00', { snapshot: '20261028T0417Z.html' });

describe('dueSlots: 09:30 / 17:30 JST(00:30 / 08:30 UTC)', () => {
  it('only slots already reached, after the start and not after the stop', () => {
    expect(dueSlots(START, STOP, new Date('2026-10-28T08:29:00Z'))).toEqual([]); // まだ予定の時刻に達していない
    expect(dueSlots(START, STOP, new Date('2026-10-29T01:00:00Z')).map((d) => d.toISOString())).toEqual([
      iso('2026-10-28T08:30:00Z'),
      iso('2026-10-29T00:30:00Z'),
    ]);
    const all = dueSlots(START, STOP, new Date('2026-12-01T00:00:00Z'));
    expect(all).toHaveLength(28); // 14日 × 2回(最後は 11/11 00:30Z。停止の 04:17Z より後の 08:30Z は入れない)
    expect(all.at(-1)!.toISOString()).toBe(iso('2026-11-11T00:30:00Z'));
  });
});

describe('summarizeObservation', () => {
  it('normal: scheduled runs with records → OK; the first push run is listed separately; nothing double counted', () => {
    const now = new Date('2026-10-29T01:00:00Z');
    const runs = [PUSH, run(2, '2026-10-28T08:31:00Z'), run(3, '2026-10-29T00:33:00Z')];
    const log = logOf(
      [PUSH_RECORD, rec('2026-10-28T08:31:20+00:00', { snapshot: 'b.html' }), rec('2026-10-29T00:33:20+00:00')],
      now,
    );
    const s = summarizeObservation({ start: START, stop: STOP, now, runs, log });
    expect(s.slots.map((slot) => [slot.slot, slot.outcome, slot.delayed, slot.recordLine])).toEqual([
      [iso('2026-10-28T08:30:00Z'), 'OK', false, 2],
      [iso('2026-10-29T00:30:00Z'), 'OK', false, 3],
    ]);
    expect(s.otherRuns.map((o) => [o.run.event, o.recordLine])).toEqual([['push', 1]]);
    expect(s.unmatchedRecords).toEqual([]);
    expect(s.counts).toMatchObject({ OK: 2, MISSING: 0, delayed: 0 });
  });

  it('a workflow failure: the failed step tells fetch/parse from save', () => {
    const now = new Date('2026-10-29T01:00:00Z');
    const runs = [
      PUSH,
      run(2, '2026-10-28T08:31:00Z', { conclusion: 'failure' }),
      run(3, '2026-10-29T00:31:00Z', { conclusion: 'failure' }),
    ];
    const steps = new Map<number, RunStep[]>([
      [2, [{ name: 'Fetch and record', conclusion: 'failure' }]],
      [
        3,
        [
          { name: 'Fetch and record', conclusion: 'success' },
          { name: 'Commit the record', conclusion: 'failure' },
        ],
      ],
    ]);
    const s = summarizeObservation({
      start: START,
      stop: STOP,
      now,
      runs,
      failedSteps: steps,
      log: logOf([PUSH_RECORD], now),
    });
    expect(s.slots.map((slot) => [slot.outcome, slot.failureKind])).toEqual([
      ['WORKFLOW_FAILED', '取得・解析'],
      ['WORKFLOW_FAILED', '保存'],
    ]);
  });

  it('a fetch failure inside a successful run (HTTP 503 recorded) is FETCH_FAILED, not OK', () => {
    const now = new Date('2026-10-28T09:00:00Z');
    const log = logOf(
      [
        PUSH_RECORD,
        JSON.stringify({ fetched_at: '2026-10-28T08:31:20+00:00', http_status: 503, error: 'HTTPError 503' }),
      ],
      now,
    );
    const s = summarizeObservation({
      start: START,
      stop: STOP,
      now,
      runs: [PUSH, run(2, '2026-10-28T08:31:00Z')],
      log,
    });
    expect(s.slots[0]).toMatchObject({ outcome: 'FETCH_FAILED', fetchError: 'HTTPError 503' });
  });

  it('a missing log: parseObservationLog(null) says so; a successful run without a record is RECORD_MISSING', () => {
    const now = new Date('2026-10-28T09:00:00Z');
    const log = parseObservationLog(null, now);
    expect(log).toMatchObject({ missing: true, problems: ['log.jsonl が無い(読めない)'] });
    const s = summarizeObservation({
      start: START,
      stop: STOP,
      now,
      runs: [PUSH, run(2, '2026-10-28T08:31:00Z')],
      log,
    });
    expect(s.slots[0]!.outcome).toBe('RECORD_MISSING');
    expect(
      renderObservationReport({
        now,
        state: null,
        stateError: 'state.json が無い',
        workflowState: 'active',
        apiError: null,
        summary: s,
        log,
        replay: null,
        replayError: null,
      }),
    ).toContain('観測ログ(log.jsonl)が無い・読めない');
  });

  it('a delayed run (GitHub started it 50 minutes late) is still OK but counted as delayed', () => {
    const now = new Date('2026-10-28T10:00:00Z');
    const late = run(2, '2026-10-28T09:20:00Z');
    const log = logOf([PUSH_RECORD, rec('2026-10-28T09:20:30+00:00')], now);
    const s = summarizeObservation({ start: START, stop: STOP, now, runs: [PUSH, late], log });
    expect(s.slots[0]).toMatchObject({ outcome: 'OK', delayed: true, delayMinutes: 50 });
    expect(s.counts.delayed).toBe(1);
  });

  it('a slot not yet reached is not counted; a reached slot without a run is PENDING within the grace, MISSING after', () => {
    const before = summarizeObservation({
      start: START,
      stop: STOP,
      now: new Date('2026-10-28T08:00:00Z'),
      runs: [PUSH],
      log: logOf([PUSH_RECORD], new Date()),
    });
    expect(before.slots).toEqual([]);
    const within = summarizeObservation({
      start: START,
      stop: STOP,
      now: new Date('2026-10-28T09:30:00Z'),
      runs: [PUSH],
      log: logOf([PUSH_RECORD], new Date()),
    });
    expect(within.slots[0]!.outcome).toBe('PENDING');
    expect(within.counts.MISSING).toBe(0);
    const after = summarizeObservation({
      start: START,
      stop: STOP,
      now: new Date('2026-10-28T11:00:00Z'),
      runs: [PUSH],
      log: logOf([PUSH_RECORD], new Date()),
    });
    expect(after.slots[0]!.outcome).toBe('MISSING');
  });

  it('GitHub API failure: every slot UNKNOWN (never "0 missing"), with a record-based estimate', () => {
    const now = new Date('2026-10-29T03:00:00Z');
    const log = logOf([PUSH_RECORD, rec('2026-10-28T08:40:00+00:00')], now);
    const s = summarizeObservation({ start: START, stop: STOP, now, runs: null, log });
    expect(s.runsAvailable).toBe(false);
    expect(s.slots.map((slot) => [slot.outcome, slot.estimate])).toEqual([
      ['UNKNOWN', '記録あり(10分後に取得。実行されたと推定)'],
      ['UNKNOWN', '記録なし'],
    ]);
    const report = renderObservationReport({
      now,
      state: { started_at: START.toISOString(), stop_after: STOP.toISOString() },
      stateError: null,
      workflowState: null,
      apiError: 'GitHub API: Error: HTTP 403',
      summary: s,
      log,
      replay: null,
      replayError: null,
    });
    expect(report).toContain('成功・失敗・欠落は集計不能(欠落0件とは数えない)');
    expect(report).not.toMatch(/欠落 0/);
  });

  it('one record is matched to one run only (a manual run right after a scheduled one does not double count)', () => {
    const now = new Date('2026-10-28T09:00:00Z');
    const runs = [PUSH, run(2, '2026-10-28T08:31:00Z'), run(3, '2026-10-28T08:31:05Z', { event: 'workflow_dispatch' })];
    const log = logOf([PUSH_RECORD, rec('2026-10-28T08:31:20+00:00')], now);
    const s = summarizeObservation({ start: START, stop: STOP, now, runs, log });
    expect(s.slots[0]!.recordLine).toBe(2);
    expect(s.otherRuns.find((o) => o.run.id === 3)!.recordLine).toBeNull();
  });
});

describe('parseObservationLog: malformed / duplicate / out of order / future', () => {
  it('lists every problem with its line', () => {
    const now = new Date('2026-10-29T00:00:00Z');
    const log = parseObservationLog(
      [
        rec('2026-10-28T08:31:00+00:00'),
        '{not json',
        rec('2026-10-28T08:31:00+00:00'),
        rec('2026-10-28T04:00:00+00:00'),
        JSON.stringify({ http_status: 200 }),
        rec('2026-10-30T00:00:00+00:00'),
      ].join('\n'),
      now,
    );
    expect(log.records.map((r) => r.line)).toEqual([1, 4, 6]);
    expect(log.problems).toEqual([
      '2行目: JSON として読めない',
      '3行目: 同じ取得日時の行が重複(2026-10-28T08:31:00+00:00)',
      '4行目: 取得日時が前の行より前(順序の乱れ)',
      '5行目: fetched_at・http_status が無い、または時刻が読めない',
      '6行目: 取得日時が現在より先(2026-10-30T00:00:00+00:00)',
    ]);
  });
});

describe('summarizeReplay', () => {
  const line = (snapshot: string, extra: Record<string, unknown> = {}) =>
    JSON.stringify({
      snapshot,
      coverage: { fromIso: '2026-10-22T22:00:00.000Z', toIso: '2026-10-30T23:00:00.000Z' },
      parsed: 4,
      feed_skipped: ['2026-10-23 SUMMER_TIME_UNVERIFIED Someone: Secret title', '2026-10-27 NOT_PUBLIC Other: Dinner'],
      uncertain_days: ['2026-10-23', '2026-10-27'],
      page_anomaly: null,
      pipeline_skips: {},
      cancelled: [],
      rescheduled: [],
      held: [],
      cancel_suppressed: [],
      rows: ['2026-10-29T15:50:00.000Z SCHEDULED name id'],
      ...extra,
    });

  it('per page: speeches, skips by reason, parse errors, range, uncertain days, judgments — never the titles or names', () => {
    const r = summarizeReplay(`${line('a.html')}\n✓ done`, 0, ['a.html']);
    expect(r).toMatchObject({ ok: true, missingPages: [], failure: null });
    expect(r.pages[0]).toEqual({
      snapshot: 'a.html',
      speeches: 4,
      skipped: 2,
      skipReasons: { SUMMER_TIME_UNVERIFIED: 1, NOT_PUBLIC: 1 },
      parseErrors: [],
      coverage: { fromIso: '2026-10-22T22:00:00.000Z', toIso: '2026-10-30T23:00:00.000Z' },
      uncertainDays: ['2026-10-23', '2026-10-27'],
      judgments: { cancelled: 0, rescheduled: 0, held: 0, cancelSuppressed: 0 },
    });
    expect(JSON.stringify(r)).not.toMatch(/Secret title|Someone|Dinner|name id/);
  });

  it('a page parse failure / anomaly and a failed test run are reported (exit code, missing pages, the error line)', () => {
    const anomaly = summarizeReplay(
      line('a.html', { page_anomaly: 'DATE_UNPARSEABLE', feed_skipped: ['? DATE_UNPARSEABLE X: y'] }),
      0,
      ['a.html'],
    );
    expect(anomaly.pages[0]!.parseErrors).toEqual(['DATE_UNPARSEABLE', 'PAGE_ANOMALY:DATE_UNPARSEABLE']);
    const failed = summarizeReplay(`${line('a.html')}\nAssertionError: expected [ 'x' ] to deeply equal []`, 1, [
      'a.html',
      'b.html',
    ]);
    expect(failed).toMatchObject({ ok: false, missingPages: ['b.html'] });
    expect(failed.failure).toBe(
      "終了コード 1、結果の出なかったページ 1 件、AssertionError: expected [ 'x' ] to deeply equal []",
    );
  });
});
