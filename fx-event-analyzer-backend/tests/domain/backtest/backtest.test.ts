/**
 * Backtest framework tests: exact hand-computed PnL, look-ahead immunity, event visibility,
 * walk-forward windows, determinism, multiple-testing guard and the fail-closed display gate.
 * Example strategies are framework fixtures only (no performance claims).
 */
import { describe, expect, it } from 'vitest';
import type { Bar } from '../../../src/domain/technical/index.js';
import {
  bonferroni,
  bootstrapExpectancy,
  eventSurpriseStrategy,
  fingerprintBars,
  maCrossStrategy,
  rsiMeanReversionStrategy,
  runBacktest,
  runWalkForwardExperiment,
  shouldDisplay,
  walkForwardWindows,
  type Candidate,
  type DisplayThresholds,
  type EventFeature,
  type ExperimentResult,
  type SimulationOptions,
  type Strategy,
  type TargetPosition,
} from '../../../src/domain/backtest/index.js';

const BAR = 60_000;
const mkBar = (i: number, o: number, c: number): Bar => ({
  t: i * BAR,
  o,
  h: Math.max(o, c) + 0.1,
  l: Math.min(o, c) - 0.1,
  c,
});

function scripted(plan: Record<number, TargetPosition>): Strategy {
  return {
    name: 'scripted',
    params: {},
    warmupBars: 1,
    decide: (ctx) => plan[ctx.barIndex],
  };
}

/** Deterministic pseudo-random walk, prices in "pips" (pipSize = 1). */
function walk(n: number, seed = 7): Bar[] {
  let s = seed;
  const rnd = (): number => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
  const out: Bar[] = [];
  let p = 1000;
  for (let i = 0; i < n; i++) {
    const o = p;
    const c = o + (rnd() - 0.5) * 10 + Math.sin(i / 15) * 1.5;
    out.push({ t: i * BAR, o, h: Math.max(o, c) + rnd() * 2, l: Math.min(o, c) - rnd() * 2, c });
    p = c;
  }
  return out;
}

const costs = { spreadPips: 2, slippagePips: 0.5, commissionPipsPerSide: 0.25 };
const sim: SimulationOptions = { barMs: BAR, pipSize: 1, costs, codeVersion: 'test-1', seed: 1 };
const bars4 = [mkBar(0, 100, 100), mkBar(1, 101, 102), mkBar(2, 103, 104), mkBar(3, 105, 104)];

describe('simulator accounting (hand-checked)', () => {
  it('long: fills at next open with spread/2+slippage, exact net PnL, equity and exposure', () => {
    const r = runBacktest(bars4, [], scripted({ 0: 'long', 2: 'flat' }), sim);
    expect(r.trades).toHaveLength(1);
    const t = r.trades[0]!;
    // entry fill 101 + 1.5 = 102.5 ; exit fill 105 - 1.5 = 103.5
    expect([t.entryIndex, t.exitIndex, t.entryPrice, t.exitPrice]).toEqual([1, 3, 102.5, 103.5]);
    expect(t.grossPips).toBeCloseTo(4, 12);
    expect(t.costPips).toBeCloseTo(3.5, 12); // spread 2 + 2*0.5 slip + 2*0.25 commission
    expect(t.pnlPips).toBeCloseTo(0.5, 12);
    expect(t.forced).toBe(false);
    expect(r.equity.map((e) => Math.round(e * 1e9) / 1e9)).toEqual([0, -0.75, 1.25, 0.5]);
    expect(r.metrics.exposure).toBeCloseTo(0.5, 12);
    expect(r.metrics.totalPips).toBeCloseTo(0.5, 12);
  });

  it('open position is force-closed at the last close and flagged', () => {
    const r = runBacktest(bars4, [], scripted({ 0: 'long' }), sim);
    const t = r.trades[0]!;
    expect(t.forced).toBe(true);
    expect(t.exitIndex).toBe(3);
    expect(t.grossPips).toBeCloseTo(3, 12); // 104 - 101
    expect(t.pnlPips).toBeCloseTo(-0.5, 12);
  });

  it('reversal closes and reopens at the same open; short PnL sign is correct', () => {
    const r = runBacktest(bars4, [], scripted({ 0: 'long', 1: 'short' }), sim);
    expect(r.trades.map((t) => [t.side, t.entryIndex, t.exitIndex])).toEqual([
      ['long', 1, 2],
      ['short', 2, 3],
    ]);
    expect(r.trades[0]!.pnlPips).toBeCloseTo(-1.5, 12); // gross 2 - cost 3.5
    expect(r.trades[1]!.pnlPips).toBeCloseTo(-4.5, 12); // gross -1 - cost 3.5
  });

  it('zero costs: PnL equals the open-to-open move', () => {
    const r = runBacktest(bars4, [], scripted({ 0: 'long', 2: 'flat' }), {
      ...sim,
      costs: { spreadPips: 0, slippagePips: 0, commissionPipsPerSide: 0 },
    });
    expect(r.trades[0]!.pnlPips).toBe(4);
  });

  it('metrics on known trades', () => {
    const b = [mkBar(0, 10, 10), mkBar(1, 10, 12), mkBar(2, 14, 12), mkBar(3, 12, 11), mkBar(4, 9, 9), mkBar(5, 9, 9)];
    const z = { spreadPips: 0, slippagePips: 0, commissionPipsPerSide: 0 };
    // long 1->2 (+4: 10 -> 14), long 3->4 (12 -> 9 = -3)
    const r = runBacktest(b, [], scripted({ 0: 'long', 1: 'flat', 2: 'long', 3: 'flat' }), { ...sim, costs: z });
    expect(r.trades.map((t) => t.pnlPips)).toEqual([4, -3]);
    expect(r.metrics).toMatchObject({ trades: 2, wins: 1, hitRate: 0.5, totalPips: 1, expectancyPips: 0.5 });
    expect(r.metrics.profitFactor).toBeCloseTo(4 / 3, 12);
    expect(r.metrics.avgWinPips).toBe(4);
    expect(r.metrics.avgLossPips).toBe(-3);
    expect(r.metrics.maxDrawdownPips).toBeGreaterThanOrEqual(3);
    expect(r.metrics.caveats.length).toBeGreaterThan(0);
  });
});

describe('no look-ahead', () => {
  it('changing bars from index m onward does not change earlier trades or equity', () => {
    const base = walk(300);
    const m = 200;
    const altered = base.map((b, i) => (i < m ? b : { ...b, o: b.o + 50, h: b.h + 80, l: b.l - 80, c: b.c - 40 }));
    for (const strat of [() => maCrossStrategy(5, 20), () => rsiMeanReversionStrategy(14, 35, 65)]) {
      const a = runBacktest(base, [], strat(), sim);
      const b = runBacktest(altered, [], strat(), sim);
      const early = (r: typeof a) => r.trades.filter((t) => t.exitIndex < m);
      expect(early(a).length).toBeGreaterThan(0);
      expect(early(b)).toEqual(early(a));
      expect(b.equity.slice(0, m - 1)).toEqual(a.equity.slice(0, m - 1));
    }
  });

  it('the strategy never receives bars beyond the decision bar', () => {
    const seen: number[] = [];
    const spy: Strategy = {
      name: 'spy',
      params: {},
      warmupBars: 1,
      decide: (ctx) => {
        seen.push(ctx.history.length - 1 - ctx.barIndex);
        expect(ctx.history.at(-1)).toBe(bars4[ctx.barIndex]);
        return undefined;
      },
    };
    runBacktest(bars4, [], spy, sim);
    expect(seen.every((x) => x === 0)).toBe(true);
    expect(seen).toHaveLength(3); // not called on the last bar
  });

  it('events become visible only from eventTime onward (at the bar close that includes them)', () => {
    const counts: number[] = [];
    const spy: Strategy = {
      name: 'spy',
      params: {},
      warmupBars: 1,
      decide: (ctx) => {
        counts.push(ctx.events.length);
        return undefined;
      },
    };
    // close time of bar 1 = 2*BAR. Event exactly then is visible at bar 1; event 1ms later at bar 2.
    const ev: EventFeature[] = [
      { eventTime: 2 * BAR, indicatorCode: 'X', surprise: 1 },
      { eventTime: 2 * BAR + 1, indicatorCode: 'Y', surprise: 1 },
    ];
    runBacktest(bars4, ev, spy, sim);
    expect(counts).toEqual([0, 1, 2]);
  });

  it('event strategy: trades the surprise direction for holdBars after release only', () => {
    const b = walk(40);
    const ev: EventFeature[] = [{ eventTime: 10 * BAR, indicatorCode: 'CPI', surprise: -2 }];
    const r = runBacktest(b, ev, eventSurpriseStrategy(1, 5), sim);
    expect(r.trades).toHaveLength(1);
    expect(r.trades[0]!.side).toBe('short');
    expect(r.trades[0]!.entryIndex).toBeGreaterThanOrEqual(10);
    expect(r.trades[0]!.exitIndex - r.trades[0]!.entryIndex).toBe(5);
  });
});

describe('walk-forward windows', () => {
  const o = { totalBars: 100, trainSize: 30, validSize: 10, testSize: 10, step: 10, purge: 2, embargo: 1 };
  it('rolling windows have exact boundaries and respect purge/embargo', () => {
    const w = walkForwardWindows(o);
    expect(w).toHaveLength(5);
    expect(w[0]).toMatchObject({
      train: { start: 0, end: 30 },
      valid: { start: 32, end: 42 },
      test: { start: 45, end: 55 },
    });
    expect(w[1]!.train).toEqual({ start: 10, end: 40 });
    expect(w.at(-1)!.test.end).toBeLessThanOrEqual(100);
    for (const x of w) {
      expect(x.train.end + 2).toBeLessThanOrEqual(x.valid.start);
      expect(x.valid.end + 2 + 1).toBeLessThanOrEqual(x.test.start);
    }
    // test segments never overlap and are chronological
    for (let i = 1; i < w.length; i++) expect(w[i]!.test.start).toBeGreaterThanOrEqual(w[i - 1]!.test.end);
  });
  it('expanding mode keeps the train start fixed', () => {
    const w = walkForwardWindows({ ...o, mode: 'expanding' });
    expect(w.every((x) => x.train.start === 0)).toBe(true);
    expect(w[2]!.train.end).toBe(50);
  });
  it('event guard truncates the earlier segment before a straddling event', () => {
    const w = walkForwardWindows({ ...o, eventIndices: [29], eventGuardBars: 5 });
    expect(w[0]!.train).toEqual({ start: 0, end: 29 });
    const none = walkForwardWindows({ ...o, eventIndices: [10], eventGuardBars: 5 });
    expect(none[0]!.train).toEqual({ start: 0, end: 30 });
  });
  it('returns no windows when data is too short and validates sizes', () => {
    expect(walkForwardWindows({ ...o, totalBars: 40 })).toEqual([]);
    expect(() => walkForwardWindows({ ...o, trainSize: 0 })).toThrow(RangeError);
  });
});

describe('experiment, determinism, multiple-testing guard', () => {
  const data = walk(600, 11);
  const candidates: Candidate[] = [
    { id: 'ma5_20', create: () => maCrossStrategy(5, 20) },
    { id: 'ma10_40', create: () => maCrossStrategy(10, 40) },
    { id: 'rsi14', create: () => rsiMeanReversionStrategy(14, 30, 70) },
  ];
  const opts = {
    sim,
    walkForward: { trainSize: 150, validSize: 80, testSize: 80, purge: 5, embargo: 2 },
    seed: 42,
    bootstrapResamples: 500,
  };

  it('is deterministic and reports only test-segment trades with a full manifest', () => {
    const a = runWalkForwardExperiment(data, [], candidates, opts);
    const b = runWalkForwardExperiment(data, [], candidates, opts);
    expect(b).toEqual(a);
    expect(a.windows.length).toBeGreaterThan(2);
    const tests = a.windows.filter((w) => w.chosenId).map((w) => w.window.test);
    for (const t of a.oos.trades) {
      expect(tests.some((s) => t.entryIndex >= s.start && t.exitIndex < s.end)).toBe(true);
    }
    expect(a.manifest).toMatchObject({
      codeVersion: 'test-1',
      seed: 42,
      configsTried: 3,
      dataFingerprint: fingerprintBars(data),
    });
    expect(a.oos.configsTried).toBe(3);
    const c = runWalkForwardExperiment(data, [], candidates, { ...opts, seed: 43 });
    expect(c.oos.trades).toEqual(a.oos.trades);
  });

  it('priorConfigsTried raises the adjusted p-value', () => {
    const a = runWalkForwardExperiment(data, [], candidates, opts);
    const b = runWalkForwardExperiment(data, [], candidates, { ...opts, priorConfigsTried: 10 });
    expect(b.oos.configsTried).toBe(13);
    if (a.oos.ci && a.oos.pValueAdjusted !== null && a.oos.pValueAdjusted < 1) {
      expect(b.oos.pValueAdjusted!).toBeGreaterThan(a.oos.pValueAdjusted);
    }
  });

  it('fingerprint changes when any bar changes', () => {
    const alt = data.map((x, i) => (i === 100 ? { ...x, c: x.c + 0.0001 } : x));
    expect(fingerprintBars(alt)).not.toBe(fingerprintBars(data));
  });

  it('bootstrap is seeded; CI brackets the mean; Bonferroni caps at 1', () => {
    const x = [3, -1, 2, 4, -2, 5, 1, 0, 2, 3];
    const a = bootstrapExpectancy(x, { seed: 5, resamples: 1000 })!;
    expect(bootstrapExpectancy(x, { seed: 5, resamples: 1000 })).toEqual(a);
    expect(a.lower).toBeLessThanOrEqual(a.meanPips);
    expect(a.upper).toBeGreaterThanOrEqual(a.meanPips);
    expect(a.pValue).toBeLessThan(0.1);
    expect(bootstrapExpectancy([1], { seed: 1 })).toBeNull();
    expect(bonferroni(0.01, 5)).toBeCloseTo(0.05, 12);
    expect(bonferroni(0.5, 5)).toBe(1);
  });
});

describe('shouldDisplay fails closed', () => {
  const th: DisplayThresholds = {
    minTrades: 30,
    minExpectancyPips: 0,
    minCiLowerPips: 0,
    maxDrawdownPips: 100,
    maxAdjustedPValue: 0.05,
    minWindowsWithResult: 2,
  };
  const good = (): ExperimentResult => {
    const metrics = {
      trades: 50,
      wins: 30,
      hitRate: 0.6,
      totalPips: 100,
      expectancyPips: 2,
      avgWinPips: 5,
      avgLossPips: -2,
      profitFactor: 2,
      maxDrawdownPips: 40,
      exposure: 0.3,
      sharpeLikePerTrade: 0.4,
      sharpeLikePerBar: 0.1,
      caveats: [],
    };
    const win = {
      window: { index: 0, train: { start: 0, end: 1 }, valid: { start: 1, end: 2 }, test: { start: 2, end: 3 } },
    };
    return {
      windows: [
        { ...win, chosenId: 'a', validExpectancyPips: 1, testMetrics: metrics },
        { ...win, chosenId: 'a', validExpectancyPips: 1, testMetrics: metrics },
      ],
      oos: {
        metrics,
        trades: [],
        ci: {
          method: 'conservative',
          blockLength: 3,
          meanPips: 2,
          lower: 0.5,
          upper: 3.5,
          confidence: 0.95,
          resamples: 1000,
          pValue: 0.001,
          seed: 1,
        },
        ciIid: null,
        ciBlock: null,
        configsTried: 3,
        pValueAdjusted: 0.003,
      },
      manifest: {
        codeVersion: 'abc123',
        dataFingerprint: 'f'.repeat(64),
        eventsFingerprint: 'e'.repeat(64),
        strategy: null,
        costs,
        costAssumptions: { label: 'ASSUMPTION', pair: 'USDJPY', spreadModel: {} },
        pipSize: 0.0001,
        barMs: BAR,
        range: { startIndex: 0, endIndex: 10 },
        seed: 1,
        configsTried: 3,
      },
    };
  };

  it('passes only when every criterion holds', () => {
    expect(shouldDisplay(good(), th)).toEqual({ display: true, reasons: [] });
  });

  it('fails closed on missing inputs, missing thresholds and unspecified provenance', () => {
    expect(shouldDisplay(null, th).display).toBe(false);
    expect(shouldDisplay(good(), null).display).toBe(false);
    expect(shouldDisplay(good(), {}).display).toBe(false);
    expect(shouldDisplay(good(), { ...th, maxAdjustedPValue: Number.NaN }).display).toBe(false);
    const noVersion = good();
    noVersion.manifest.codeVersion = 'unspecified';
    expect(shouldDisplay(noVersion, th).display).toBe(false);
    const noCi = good();
    noCi.oos.ci = null;
    expect(shouldDisplay(noCi, th).display).toBe(false);
    const iidOnly = good();
    iidOnly.oos.ci!.method = 'iid';
    expect(shouldDisplay(iidOnly, th).display).toBe(false);
    const noCost = good();
    (noCost.manifest as { costAssumptions?: unknown }).costAssumptions = undefined;
    expect(shouldDisplay(noCost, th).display).toBe(false);
    const nan = good();
    nan.oos.metrics.expectancyPips = Number.NaN;
    expect(shouldDisplay(nan, th).display).toBe(false);
  });

  it('each threshold can block on its own', () => {
    const cases: [(r: ExperimentResult) => void, string][] = [
      [(r) => (r.oos.metrics.trades = 29), 'trades'],
      [(r) => (r.oos.metrics.expectancyPips = 0), 'expectancy'],
      [(r) => (r.oos.ci!.lower = 0), 'CI'],
      [(r) => (r.oos.metrics.maxDrawdownPips = 101), 'drawdown'],
      [(r) => (r.oos.pValueAdjusted = 0.06), 'p-value'],
      [(r) => (r.windows[1]!.testMetrics = null), 'windows'],
    ];
    for (const [mutate, label] of cases) {
      const r = good();
      mutate(r);
      const d = shouldDisplay(r, th);
      expect(d.display, label).toBe(false);
      expect(d.reasons.length, label).toBe(1);
    }
  });
});
