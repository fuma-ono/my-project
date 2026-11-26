/**
 * Honest display gate. Decides whether an OUT-OF-SAMPLE result may be shown to users.
 * Fails closed: any missing/non-finite input, missing threshold, or unspecified manifest field
 * yields display = false with the reasons listed. In-sample numbers are never accepted here.
 */
import type { ExperimentResult } from './experiment.js';

export interface DisplayThresholds {
  minTrades: number;
  /** OOS expectancy must be strictly greater than this (pips). Use 0 for "positive". */
  minExpectancyPips: number;
  /** Lower bound of the bootstrap CI must be strictly greater than this (pips). */
  minCiLowerPips: number;
  maxDrawdownPips: number;
  /** Bonferroni-adjusted p-value must be <= this. */
  maxAdjustedPValue: number;
  /** Minimum number of walk-forward windows that actually produced a test result. */
  minWindowsWithResult: number;
}

export interface DisplayDecision {
  display: boolean;
  reasons: string[];
}

const fin = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

export function shouldDisplay(
  result: Pick<ExperimentResult, 'oos' | 'manifest' | 'windows'> | null | undefined,
  thresholds: Partial<DisplayThresholds> | null | undefined,
): DisplayDecision {
  const reasons: string[] = [];
  if (!result || !thresholds) return { display: false, reasons: ['missing result or thresholds'] };
  const t = thresholds;
  for (const k of [
    'minTrades',
    'minExpectancyPips',
    'minCiLowerPips',
    'maxDrawdownPips',
    'maxAdjustedPValue',
    'minWindowsWithResult',
  ] as const) {
    if (!fin(t[k])) reasons.push(`threshold ${k} not set`);
  }
  const { oos, manifest } = result;
  const m = oos?.metrics;
  if (!m) reasons.push('no out-of-sample metrics');
  if (!manifest || !manifest.codeVersion || manifest.codeVersion === 'unspecified')
    reasons.push('manifest codeVersion missing');
  if (!manifest?.costAssumptions?.label) reasons.push('manifest costAssumptions missing');
  if (!manifest?.dataFingerprint) reasons.push('manifest dataFingerprint missing');
  if (m && fin(t.minTrades) && !(m.trades >= t.minTrades)) reasons.push(`trades ${m.trades} < ${t.minTrades}`);
  if (m && fin(t.minExpectancyPips) && !(fin(m.expectancyPips) && m.expectancyPips > t.minExpectancyPips)) {
    reasons.push('OOS expectancy not above threshold');
  }
  if (!oos?.ci) reasons.push('no bootstrap CI');
  else if (oos.ci.method !== 'conservative') reasons.push('CI is not the conservative iid+block interval');
  else if (fin(t.minCiLowerPips) && !(fin(oos.ci.lower) && oos.ci.lower > t.minCiLowerPips)) {
    reasons.push('CI lower bound not above threshold');
  }
  if (m && fin(t.maxDrawdownPips) && !(fin(m.maxDrawdownPips) && m.maxDrawdownPips <= t.maxDrawdownPips)) {
    reasons.push('max drawdown above limit');
  }
  if (fin(t.maxAdjustedPValue) && !(fin(oos?.pValueAdjusted) && oos.pValueAdjusted <= t.maxAdjustedPValue)) {
    reasons.push('adjusted p-value above limit or missing');
  }
  if (!fin(oos?.configsTried) || oos.configsTried < 1) reasons.push('configsTried not recorded');
  if (fin(t.minWindowsWithResult)) {
    const n = (result.windows ?? []).filter((w) => w.testMetrics !== null).length;
    if (n < t.minWindowsWithResult) reasons.push(`windows with result ${n} < ${t.minWindowsWithResult}`);
  }
  return { display: reasons.length === 0, reasons };
}
