/**
 * 為替の定時取得の健全性(HQ指示 2026-11-11「FX価格定時取得の実績検証・運用監視準備」)。
 * 2026-11-11(水)は市場が開いている。2026-11-14(土)は閉まっている。
 */
import { describe, expect, it } from 'vitest';
import { evaluateFxHealth, type FxHealthInput, type FxRunLog } from '../../src/ingestion/quality/fxHealth.js';
import { isFxMarketOpen } from '../../src/ingestion/marketHours.js';
import { exitCodeFor } from '../../src/jobs/reportFxHealth.js';

const MIN = 60_000;
const at = (ms: number) => new Date(ms).toISOString();

/** start から 20 分ごとに n 回の取り込み(同じ GitHub Actions の実行)。 */
function loop(githubRunId: string, startMs: number, n: number, over: Partial<FxRunLog> = {}): FxRunLog[] {
  return Array.from({ length: n }, (_, i) => ({
    started_at: at(startMs + i * 20 * MIN),
    completed_at: at(startMs + i * 20 * MIN + 30_000),
    status: 'SUCCESS' as const,
    github_run_id: githubRunId,
    unrecovered_total: 0,
    ...over,
  }));
}

const base = (runs: FxRunLog[], over: Partial<FxHealthInput> = {}): FxHealthInput => ({
  runs,
  credits: { automatic: 300, manual: 0, total: 300 },
  caps: { automatic: 700, total: 800 },
  unverifiedCandles: 0,
  ...over,
});

const T0 = Date.parse('2026-11-11T00:13:00Z'); // 水曜
const fullLoop = 17 * 20 * MIN; // 次の実行が前の実行の直後に始まった形

describe('evaluateFxHealth', () => {
  it('back-to-back loops of 17 runs, recent last run, credits low → OK', () => {
    expect(isFxMarketOpen(T0)).toBe(true);
    const runs = [...loop('100', T0, 17), ...loop('101', T0 + fullLoop, 17), ...loop('102', T0 + 2 * fullLoop, 3)];
    const now = new Date(Date.parse(runs.at(-1)!.started_at) + 5 * MIN);
    const r = evaluateFxHealth(base(runs), now);
    expect(r.level).toBe('OK');
    expect(r.findings).toEqual([]);
    expect(r.summary.github_runs.map((g) => [g.github_run_id, g.iterations])).toEqual([
      ['100', 17],
      ['101', 17],
      ['102', 3],
    ]);
    expect(r.summary.longest_gap_minutes).toBe(20);
  });

  it('a 194-minute gap between scheduled runs on a market day → RUN_GAP ALERT (the 2026-11-10 13:45–16:59Z case)', () => {
    const first = loop('200', T0, 17);
    const lastStart = Date.parse(first.at(-1)!.started_at);
    const second = loop('201', lastStart + 194 * MIN, 4);
    const r = evaluateFxHealth(base([...first, ...second]), new Date(Date.parse(second.at(-1)!.started_at) + 5 * MIN));
    expect(r.level).toBe('ALERT');
    expect(r.findings.map((f) => [f.check, f.level, f.detail?.minutes])).toEqual([['RUN_GAP', 'ALERT', 194]]);
  });

  it('a loop that stopped after 10 runs is LOOP_INCOMPLETE (not the newest loop, not the one cut by the window)', () => {
    const runs = [
      ...loop('300', T0, 17),
      ...loop('301', T0 + fullLoop, 10),
      ...loop('302', T0 + fullLoop + 10 * 20 * MIN, 2),
    ];
    const r = evaluateFxHealth(base(runs), new Date(Date.parse(runs.at(-1)!.started_at) + 5 * MIN));
    expect(r.findings.map((f) => [f.check, f.level, (f.detail as { github_run_id?: string }).github_run_id])).toEqual([
      ['LOOP_INCOMPLETE', 'WARN', '301'],
    ]);
    // 期間の最初の回を含む実行(期間の前から続いていた)は判定しない
    const cut = evaluateFxHealth(
      base([...loop('400', T0, 5), ...loop('401', T0 + 5 * 20 * MIN, 3)]),
      new Date(T0 + 8 * 20 * MIN),
    );
    expect(cut.findings.filter((f) => f.check === 'LOOP_INCOMPLETE')).toEqual([]);
  });

  it('no run for 45 / 90 minutes while the market is open → STALE WARN / ALERT; on Saturday nothing', () => {
    const runs = loop('500', T0, 3);
    const last = Date.parse(runs.at(-1)!.started_at);
    expect(evaluateFxHealth(base(runs), new Date(last + 45 * MIN)).findings).toEqual([
      expect.objectContaining({ check: 'STALE', level: 'WARN' }),
    ]);
    expect(evaluateFxHealth(base(runs), new Date(last + 90 * MIN)).level).toBe('ALERT');
    expect(evaluateFxHealth(base([]), new Date(T0)).findings[0]).toMatchObject({ check: 'STALE', level: 'ALERT' });
    const sat = Date.parse('2026-11-14T12:00:00Z');
    expect(isFxMarketOpen(sat)).toBe(false);
    expect(evaluateFxHealth(base(loop('501', sat - 10 * 60 * MIN, 2)), new Date(sat)).findings).toEqual([]);
  });

  it('failures: still failing 3 times in a row → ALERT; failed then recovered → WARN (recovered)', () => {
    const ok = loop('600', T0, 3);
    const failing = loop('600', T0 + 3 * 20 * MIN, 3, { status: 'FAILURE' });
    const now = new Date(Date.parse(failing.at(-1)!.started_at) + 5 * MIN);
    expect(evaluateFxHealth(base([...ok, ...failing]), now).findings).toEqual([
      expect.objectContaining({ check: 'FAILURES', level: 'ALERT' }),
    ]);
    expect(evaluateFxHealth(base([...ok, ...failing]), now).findings[0]!.detail?.current_streak).toBe(3);
    const recovered = [...ok, ...failing, ...loop('600', T0 + 6 * 20 * MIN, 1)];
    const r = evaluateFxHealth(base(recovered), new Date(T0 + 6 * 20 * MIN + 5 * MIN));
    expect(r.findings.map((f) => [f.check, f.level, f.detail?.recovered, f.detail?.max_streak])).toEqual([
      ['FAILURES', 'WARN', true, 3],
    ]);
  });

  it('credits near the cap: 81% of total → WARN, 96% → ALERT, automatic 91% of 700 → WARN', () => {
    const runs = loop('700', T0, 2);
    const now = new Date(T0 + 25 * MIN);
    const credits = (automatic: number, manual: number) => ({ automatic, manual, total: automatic + manual });
    expect(evaluateFxHealth(base(runs, { credits: credits(600, 50) }), now).findings).toEqual([
      expect.objectContaining({ check: 'CREDITS', level: 'WARN' }),
    ]);
    expect(evaluateFxHealth(base(runs, { credits: credits(690, 80) }), now).level).toBe('ALERT');
    expect(evaluateFxHealth(base(runs, { credits: credits(640, 0) }), now).findings[0]).toMatchObject({
      check: 'CREDITS',
      level: 'WARN',
    });
  });

  it('unrecovered minutes in the latest run and UNVERIFIED candles → WARN', () => {
    const runs = loop('800', T0, 2, { unrecovered_total: 3 });
    const r = evaluateFxHealth(base(runs, { unverifiedCandles: 5 }), new Date(T0 + 25 * MIN));
    expect(r.findings.map((f) => f.check)).toEqual(['UNRECOVERED', 'UNVERIFIED']);
    expect(r.level).toBe('WARN');
  });

  it('exit code: only with --fail-on, at or above the level', () => {
    const warn = evaluateFxHealth(base(loop('900', T0, 2), { unverifiedCandles: 1 }), new Date(T0 + 25 * MIN));
    expect(exitCodeFor(warn, null)).toBe(0);
    expect(exitCodeFor(warn, 'ALERT')).toBe(0);
    expect(exitCodeFor(warn, 'WARN')).toBe(1);
  });
});
