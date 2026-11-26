/**
 * Spread model (exact hand-computed PnL) and bootstrap-method tests.
 * Cost numbers are assumptions used to exercise the framework, never measured spreads.
 */
import { describe, expect, it } from 'vitest';
import type { Bar } from '../../../src/domain/technical/index.js';
import {
  bootstrapExpectancy,
  bootstrapMovingBlock,
  bootstrapStationary,
  conservativeExpectancyCI,
  conservativeInterval,
  constantSpread,
  lag1Autocorrelation,
  runBacktest,
  selectBlockLength,
  tableSpread,
  type EventFeature,
  type SimulationOptions,
  type Strategy,
  type TargetPosition,
} from '../../../src/domain/backtest/index.js';

const BAR = 60_000;
const bars: Bar[] = [
  { t: 0, o: 100, h: 100.1, l: 99.9, c: 100 },
  { t: BAR, o: 101, h: 102.1, l: 100.9, c: 102 },
  { t: 2 * BAR, o: 103, h: 104.1, l: 102.9, c: 104 },
  { t: 3 * BAR, o: 105, h: 105.1, l: 103.9, c: 104 },
];
const plan: Record<number, TargetPosition> = { 0: 'long', 2: 'flat' };
const scripted: Strategy = { name: 'scripted', params: {}, warmupBars: 1, decide: (c) => plan[c.barIndex] };
const costs = { spreadPips: 2, slippagePips: 0.5, commissionPipsPerSide: 0.25 };
const base: SimulationOptions = { barMs: BAR, pipSize: 1, costs, codeVersion: 't' };
const ev = (minutesFromStart: number, importance: string): EventFeature => ({
  eventTime: minutesFromStart * BAR,
  indicatorCode: 'X',
  surprise: 1,
  importance,
});
const flat = new Array<number>(24).fill(1);

describe('SpreadModel', () => {
  // Entry fill = open of bar 1 (t = 60s), exit fill = open of bar 3 (t = 180s). gross = 105 - 101 = 4.
  // net = 4 - (entrySpread + exitSpread)/2 - 2*0.5 slippage - 2*0.25 commission.
  const model = (extra: Partial<Parameters<typeof tableSpread>[0]> = {}) =>
    tableSpread({
      basePipsByPair: { USDJPY: 2, EURUSD: 1 },
      defaultBasePips: 3,
      eventWindows: [{ importance: 'high', fromMinutes: -5, toMinutes: 10, multiplier: 3 }],
      ...extra,
    });

  it('constant model equals the legacy constant cost (pnl 0.5)', () => {
    const r = runBacktest(bars, [], scripted, { ...base, spreadModel: constantSpread(2) });
    expect(r.trades[0]!.pnlPips).toBeCloseTo(0.5, 12);
    expect(r.trades[0]!.entrySpreadPips).toBe(2);
  });

  it('widens around a high-impact event: spread 6 at both fills -> cost 7.5, pnl -3.5', () => {
    const r = runBacktest(bars, [ev(3, 'high')], scripted, { ...base, spreadModel: model(), pair: 'USDJPY' });
    const t = r.trades[0]!;
    expect([t.entrySpreadPips, t.exitSpreadPips]).toEqual([6, 6]);
    expect(t.entryPrice).toBeCloseTo(101 + 3.5, 12);
    expect(t.exitPrice).toBeCloseTo(105 - 3.5, 12);
    expect(t.costPips).toBeCloseTo(7.5, 12);
    expect(t.pnlPips).toBeCloseTo(-3.5, 12);
  });

  it('only fills inside the window widen: event 6 min after entry fill (-5..+10 window)', () => {
    // event at minute 7: entry fill at minute 1 is -6 min from event (outside), exit at minute 3 is -4 (inside)
    const r = runBacktest(bars, [ev(7, 'high')], scripted, { ...base, spreadModel: model(), pair: 'USDJPY' });
    const t = r.trades[0]!;
    expect([t.entrySpreadPips, t.exitSpreadPips]).toEqual([2, 6]);
    expect(t.costPips).toBeCloseTo(4 + 1 + 0.5, 12);
    expect(t.pnlPips).toBeCloseTo(4 - 5.5, 12);
  });

  it('importance filter: a low-importance event does not widen; wildcard window does', () => {
    const low = runBacktest(bars, [ev(3, 'low')], scripted, { ...base, spreadModel: model(), pair: 'USDJPY' });
    expect(low.trades[0]!.pnlPips).toBeCloseTo(0.5, 12);
    const wild = model({ eventWindows: [{ importance: '*', fromMinutes: -5, toMinutes: 10, multiplier: 2 }] });
    const r = runBacktest(bars, [ev(3, 'low')], scripted, { ...base, spreadModel: wild, pair: 'USDJPY' });
    expect(r.trades[0]!.pnlPips).toBeCloseTo(4 - (4 + 1 + 0.5), 12);
  });

  it('per-pair base spread and default for unknown pairs', () => {
    const eur = runBacktest(bars, [], scripted, { ...base, spreadModel: model(), pair: 'EURUSD' });
    expect(eur.trades[0]!.pnlPips).toBeCloseTo(4 - (1 + 1 + 0.5), 12);
    const unk = runBacktest(bars, [], scripted, { ...base, spreadModel: model(), pair: 'GBPNZD' });
    expect(unk.trades[0]!.pnlPips).toBeCloseTo(4 - (3 + 1 + 0.5), 12);
  });

  it('hour-of-day profile (UTC): hour 0 multiplier 2 doubles the spread', () => {
    const h = [...flat];
    h[0] = 2; // all bars are within UTC hour 0 (epoch)
    const r = runBacktest(bars, [], scripted, {
      ...base,
      spreadModel: model({ hourMultipliersUtc: h }),
      pair: 'USDJPY',
    });
    expect(r.trades[0]!.pnlPips).toBeCloseTo(4 - (4 + 1 + 0.5), 12);
  });

  it('multipliers combine (hour x event) and different fills can differ', () => {
    const h = [...flat];
    h[0] = 1.5;
    const r = runBacktest(bars, [ev(3, 'high')], scripted, {
      ...base,
      spreadModel: model({ hourMultipliersUtc: h }),
      pair: 'USDJPY',
    });
    expect(r.trades[0]!.entrySpreadPips).toBeCloseTo(2 * 1.5 * 3, 12);
  });

  it('forced exit is charged at the bar close time', () => {
    const onlyLong: Strategy = { ...scripted, decide: (c) => (c.barIndex === 0 ? 'long' : undefined) };
    // close time of bar 3 = 4*BAR; event at minute 4 -> exit spread widened, entry (minute 1, -3 min) too
    const r = runBacktest(bars, [ev(4, 'high')], onlyLong, { ...base, spreadModel: model(), pair: 'USDJPY' });
    expect(r.trades[0]!.forced).toBe(true);
    expect(r.trades[0]!.exitSpreadPips).toBe(6);
  });

  it('manifest labels cost parameters as assumptions and records the model', () => {
    const r = runBacktest(bars, [], scripted, { ...base, spreadModel: model(), pair: 'USDJPY' });
    expect(r.manifest.costAssumptions.label).toMatch(/ASSUMPTION/);
    expect(r.manifest.costAssumptions.pair).toBe('USDJPY');
    expect(r.manifest.costAssumptions.spreadModel).toMatchObject({ kind: 'table', defaultBasePips: 3 });
    const legacy = runBacktest(bars, [], scripted, base);
    expect(legacy.manifest.costAssumptions.spreadModel).toMatchObject({ kind: 'constant', spreadPips: 2 });
  });

  it('validates configuration', () => {
    expect(() => constantSpread(-1)).toThrow(RangeError);
    expect(() => tableSpread({ basePipsByPair: {}, defaultBasePips: 1, hourMultipliersUtc: [1] })).toThrow(RangeError);
    expect(() =>
      tableSpread({
        basePipsByPair: {},
        defaultBasePips: 1,
        eventWindows: [{ importance: '*', fromMinutes: 5, toMinutes: -5, multiplier: 2 }],
      }),
    ).toThrow(RangeError);
  });
});

/** Deterministic AR(1) series: x_t = rho x_{t-1} + e_t, e_t ~ roughly uniform(-1,1). */
function ar1(n: number, rho: number, seed: number, mu = 0): number[] {
  let s = seed;
  const rnd = (): number => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
  const out: number[] = [];
  let x = 0;
  for (let i = 0; i < n; i++) {
    x = rho * x + (rnd() - 0.5) * 2;
    out.push(mu + x);
  }
  return out;
}

describe('bootstrap methods', () => {
  const dep = ar1(120, 0.7, 5, 0.1);
  const width = (r: { lower: number; upper: number }): number => r.upper - r.lower;

  it('block length: 1 for white-looking data, larger for autocorrelated, clamped, degenerate-safe', () => {
    expect(selectBlockLength([1, 1, 1, 1, 1])).toBe(1);
    expect(selectBlockLength([1, 2])).toBe(1);
    const rho = lag1Autocorrelation(dep)!;
    expect(rho).toBeGreaterThan(0.5);
    const b = selectBlockLength(dep);
    expect(b).toBeGreaterThan(3);
    expect(b).toBeLessThanOrEqual(60);
    const white = ar1(400, 0, 9);
    expect(selectBlockLength(white)).toBeLessThanOrEqual(3);
    expect(selectBlockLength([1, -1, 1, -1, 1, -1, 1, -1])).toBeLessThanOrEqual(4); // |rho| used: negative dependence
  });

  it('autocorrelated data: block CIs are wider than the iid CI (iid is too narrow)', () => {
    const o = { seed: 3, resamples: 1500 };
    const iid = bootstrapExpectancy(dep, o)!;
    const b = selectBlockLength(dep);
    const sb = bootstrapStationary(dep, { ...o, blockLength: b })!;
    const mb = bootstrapMovingBlock(dep, { ...o, blockLength: b })!;
    expect(width(sb)).toBeGreaterThan(width(iid) * 1.2);
    expect(width(mb)).toBeGreaterThan(width(iid) * 1.2);
    expect(sb.method).toBe('stationary');
    expect(mb.blockLength).toBe(b);
  });

  it('moving block with blockLength = n reproduces the sample exactly (degenerate CI)', () => {
    const x = [1, 2, 3, 4, 5, 6];
    const r = bootstrapMovingBlock(x, { seed: 1, resamples: 50, blockLength: 6 })!;
    expect([r.lower, r.upper, r.meanPips]).toEqual([3.5, 3.5, 3.5]);
  });

  it('seeded and deterministic; different seeds differ; tiny samples return null', () => {
    const a = bootstrapStationary(dep, { seed: 2, resamples: 300, blockLength: 6 })!;
    expect(bootstrapStationary(dep, { seed: 2, resamples: 300, blockLength: 6 })).toEqual(a);
    expect(bootstrapStationary(dep, { seed: 3, resamples: 300, blockLength: 6 })).not.toEqual(a);
    expect(bootstrapStationary([1], { seed: 1, blockLength: 2 })).toBeNull();
    expect(bootstrapMovingBlock([1], { seed: 1, blockLength: 2 })).toBeNull();
  });

  it('conservative combination = widest interval and largest p-value', () => {
    const { combined, iid, block } = conservativeExpectancyCI(dep, { seed: 4, resamples: 800 });
    expect(combined!.method).toBe('conservative');
    expect(combined!.lower).toBe(Math.min(iid!.lower, block!.lower));
    expect(combined!.upper).toBe(Math.max(iid!.upper, block!.upper));
    expect(combined!.pValue).toBe(Math.max(iid!.pValue, block!.pValue));
    expect(width(combined!)).toBeGreaterThanOrEqual(width(iid!));
    expect(conservativeInterval([])).toBeNull();
  });
});
