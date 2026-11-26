import type { Metrics, Trade } from './types.js';

const CAVEATS: readonly string[] = [
  'Historical simulation; not a forecast or a promise of future returns.',
  'Sharpe-like ratios are NOT annualised and assume i.i.d. returns; event-driven trades are sparse, non-normal and autocorrelated.',
  'Costs are assumptions (fixed spread/slippage); real spreads widen around releases.',
];

function mean(x: readonly number[]): number {
  return x.reduce((a, b) => a + b, 0) / x.length;
}

function sd(x: readonly number[]): number {
  const m = mean(x);
  return Math.sqrt(x.reduce((a, b) => a + (b - m) ** 2, 0) / (x.length - 1));
}

function ratio(x: readonly number[]): number | null {
  if (x.length < 2) return null;
  const s = sd(x);
  return s > 0 ? mean(x) / s : null;
}

export function maxDrawdown(equity: readonly number[]): number {
  let peak = 0;
  let dd = 0;
  for (const e of equity) {
    peak = Math.max(peak, e);
    dd = Math.max(dd, peak - e);
  }
  return dd;
}

export function computeMetrics(trades: readonly Trade[], equity: readonly number[], barsInPosition: number): Metrics {
  const pnls = trades.map((t) => t.pnlPips);
  const wins = pnls.filter((p) => p > 0);
  const losses = pnls.filter((p) => p < 0);
  const grossLoss = -losses.reduce((a, b) => a + b, 0);
  const diffs = equity.map((e, i) => e - (i === 0 ? 0 : equity[i - 1]!));
  return {
    trades: trades.length,
    wins: wins.length,
    hitRate: trades.length ? wins.length / trades.length : null,
    totalPips: pnls.reduce((a, b) => a + b, 0),
    expectancyPips: trades.length ? mean(pnls) : null,
    avgWinPips: wins.length ? mean(wins) : null,
    avgLossPips: losses.length ? mean(losses) : null,
    profitFactor: grossLoss > 0 ? wins.reduce((a, b) => a + b, 0) / grossLoss : null,
    maxDrawdownPips: maxDrawdown(equity),
    exposure: equity.length ? barsInPosition / equity.length : 0,
    sharpeLikePerTrade: ratio(pnls),
    sharpeLikePerBar: ratio(diffs),
    caveats: CAVEATS,
  };
}

/** Bonferroni: p * number of configurations tried, capped at 1. */
export function bonferroni(p: number, configsTried: number): number {
  return Math.min(1, p * Math.max(1, configsTried));
}
