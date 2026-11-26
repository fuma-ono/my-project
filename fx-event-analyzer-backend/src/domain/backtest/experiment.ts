/**
 * Walk-forward experiment with a multiple-testing guard.
 *
 * For each window: every candidate is run on the VALIDATION segment (the train segment is reserved
 * for future fitted models; parameter-grid candidates are only scored on validation), the candidate
 * with the highest validation expectancy (min `minValidTrades` trades; ties -> first listed) is
 * chosen, then run ONCE on the untouched TEST segment. Only test-segment trades are reported.
 * `configsTried` = number of candidates (+ `priorConfigsTried` from earlier experiments on the same
 * data) and feeds the Bonferroni adjustment of the bootstrap p-value.
 */
import type { Bar } from '../technical/index.js';
import { toEpochMs } from '../technical/index.js';
import { fingerprintBars, fingerprintEvents } from './manifest.js';
import { bonferroni, computeMetrics } from './metrics.js';
import { conservativeExpectancyCI, type BootstrapResult } from './bootstrap.js';
import { costAssumptions, runBacktest, type SimulationOptions } from './simulator.js';
import { constantSpread } from './spread.js';
import type { EventFeature, Manifest, Metrics, Strategy, Trade } from './types.js';
import { walkForwardWindows, type WalkForwardOptions, type WalkForwardWindow } from './walkForward.js';

export interface Candidate {
  id: string;
  create: () => Strategy;
}

export interface WindowReport {
  window: WalkForwardWindow;
  chosenId: string | null;
  validExpectancyPips: number | null;
  testMetrics: Metrics | null;
}

export interface OosReport {
  metrics: Metrics;
  trades: Trade[];
  /** Conservative interval (widest of iid and stationary bootstrap, max p-value); the gate uses this. */
  ci: BootstrapResult | null;
  ciIid: BootstrapResult | null;
  ciBlock: BootstrapResult | null;
  configsTried: number;
  /** Bonferroni-adjusted one-sided p-value (null when too few trades). */
  pValueAdjusted: number | null;
}

export interface ExperimentResult {
  windows: WindowReport[];
  oos: OosReport;
  manifest: Manifest;
}

export interface ExperimentOptions {
  sim: Omit<SimulationOptions, 'startIndex' | 'endIndex' | 'configsTried'>;
  walkForward: Omit<WalkForwardOptions, 'totalBars' | 'eventIndices'>;
  seed: number;
  minValidTrades?: number;
  priorConfigsTried?: number;
  bootstrapResamples?: number;
  confidence?: number;
}

export function runWalkForwardExperiment(
  bars: readonly Bar[],
  events: readonly EventFeature[],
  candidates: readonly Candidate[],
  opts: ExperimentOptions,
): ExperimentResult {
  if (candidates.length === 0) throw new RangeError('no candidates');
  const times = bars.map((b) => toEpochMs(b.t));
  const eventIndices = events
    .map((e) => times.findIndex((t) => t + opts.sim.barMs > e.eventTime))
    .filter((i) => i >= 0);
  const windows = walkForwardWindows({ ...opts.walkForward, totalBars: bars.length, eventIndices });
  const configsTried = candidates.length + (opts.priorConfigsTried ?? 0);
  const minValid = opts.minValidTrades ?? 1;

  const reports: WindowReport[] = [];
  const oosTrades: Trade[] = [];
  const oosEquity: number[] = [];
  let barsInPosition = 0;
  for (const w of windows) {
    let best: { c: Candidate; exp: number } | null = null;
    for (const c of candidates) {
      const r = runBacktest(bars, events, c.create(), {
        ...opts.sim,
        startIndex: w.valid.start,
        endIndex: w.valid.end,
        configsTried,
      });
      const exp = r.metrics.expectancyPips;
      if (exp !== null && r.metrics.trades >= minValid && (best === null || exp > best.exp)) best = { c, exp };
    }
    if (!best) {
      reports.push({ window: w, chosenId: null, validExpectancyPips: null, testMetrics: null });
      continue;
    }
    const t = runBacktest(bars, events, best.c.create(), {
      ...opts.sim,
      startIndex: w.test.start,
      endIndex: w.test.end,
      configsTried,
    });
    const offset = oosEquity.length ? oosEquity[oosEquity.length - 1]! : 0;
    oosEquity.push(...t.equity.map((e) => e + offset));
    oosTrades.push(...t.trades);
    barsInPosition += Math.round(t.metrics.exposure * t.equity.length);
    reports.push({ window: w, chosenId: best.c.id, validExpectancyPips: best.exp, testMetrics: t.metrics });
  }

  const {
    combined: ci,
    iid: ciIid,
    block: ciBlock,
  } = conservativeExpectancyCI(
    oosTrades.map((t) => t.pnlPips),
    {
      seed: opts.seed,
      ...(opts.bootstrapResamples !== undefined ? { resamples: opts.bootstrapResamples } : {}),
      ...(opts.confidence !== undefined ? { confidence: opts.confidence } : {}),
    },
  );
  return {
    windows: reports,
    oos: {
      metrics: computeMetrics(oosTrades, oosEquity, barsInPosition),
      trades: oosTrades,
      ci,
      ciIid,
      ciBlock,
      configsTried,
      pValueAdjusted: ci ? bonferroni(ci.pValue, configsTried) : null,
    },
    manifest: {
      codeVersion: opts.sim.codeVersion ?? 'unspecified',
      dataFingerprint: fingerprintBars(bars),
      eventsFingerprint: fingerprintEvents([...events].sort((a, b) => a.eventTime - b.eventTime)),
      strategy: null,
      costs: opts.sim.costs,
      costAssumptions: costAssumptions(
        opts.sim.spreadModel ?? constantSpread(opts.sim.costs.spreadPips),
        opts.sim.pair ?? 'UNKNOWN',
      ),
      pipSize: opts.sim.pipSize,
      barMs: opts.sim.barMs,
      range: { startIndex: windows[0]?.train.start ?? 0, endIndex: windows.at(-1)?.test.end ?? 0 },
      seed: opts.seed,
      configsTried,
    },
  };
}
