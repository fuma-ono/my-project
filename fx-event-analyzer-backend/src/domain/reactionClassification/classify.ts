import type { BarCloses } from './baseline.js';
import type { ReactionParams } from './params.js';
import { median } from './stats.js';

/**
 * Descriptive classification of the price path after a release (CONTINUATION / PULLBACK / FULL_RETRACE / REVERSAL, or
 * UNDETERMINED with a reason). It describes what the closes did; it is not a forecast or trading advice.
 *
 * Faithful port of the Python reference (analysis/clf2.py `classify`, parameter set rx-v1). Pure function of
 * the closes c_0..c_n (c_0 = P0, the close of the bar that ends at the release time T), the baseline sigma and the
 * parameter set. Every threshold comes from `ReactionParams`; this file has no numeric literals except 0 and 1.
 * Only closes are used (the order of highs / lows inside a bar is unknown). Closes at or after T + n minutes are never
 * read: the label of window n depends on c_0..c_n only. Missing closes are `null` and are never filled in.
 */
export type ClassLabel = 'CONTINUATION' | 'PULLBACK' | 'FULL_RETRACE' | 'REVERSAL';
export type UndeterminedReason =
  | 'RELEASE_TIME_NOT_EXACT'
  | 'NO_PRICE_DATA'
  | 'MISSING_BARS'
  | 'BASELINE_UNAVAILABLE'
  | 'WINDOW_TOO_SHORT'
  | 'NO_INITIAL_MOVE'
  | 'SMALL_INITIAL';

export interface ClassifyResult {
  window: number;
  label: ClassLabel | 'UNDETERMINED';
  reason: UndeterminedReason | null;
  /** +1 when the initial move (c_w0 - c_0) is up, -1 down. Set once the initial move exists. */
  sign?: number;
  /** Initial move in noise units: |c_w0 - c_0| / (sigma x sqrt(w0)). */
  z0?: number;
  /** Peak distance from P0 in the initial direction (price units, close-based). */
  M?: number;
  /** Window-end position from P0 in the initial direction (median of the last end_median_bars closes). */
  F?: number;
  /** Deepest pullback ratio (0 when no pullback reached k_pb x S0). */
  Rmax?: number;
  /** Depth of that pullback in price units (0 when none). */
  worstPullback?: number;
  /** Final retracement ratio (0 when the end is within k_pb x S0 of the peak). */
  Rf?: number;
  /** F in noise units: F / (sigma x sqrt(n)). */
  Fz?: number;
  S0?: number;
  Sn?: number;
  /** True when any threshold comparison is within borderline_tolerance of its threshold. */
  borderline?: boolean;
}

/** c_0..c_n with null where a bar is missing: c_0 = close of the bar opening at T-1, c_k = close of the bar opening at T+k-1. */
export function pathCloses(bars: BarCloses, tMin: number, n: number): (number | null)[] {
  const closes: (number | null)[] = [bars.get(tMin - 1) ?? null];
  for (let k = 0; k < n; k++) closes.push(bars.get(tMin + k) ?? null);
  return closes;
}

export function classifyWindow(
  path: readonly (number | null)[] | null,
  sigma: number | null,
  n: number,
  params: ReactionParams,
  timeExact: boolean,
): ClassifyResult {
  const out: ClassifyResult = { window: n, label: 'UNDETERMINED', reason: null };
  if (!timeExact) return { ...out, reason: 'RELEASE_TIME_NOT_EXACT' };
  if (path === null || path.every((v) => v === null)) return { ...out, reason: 'NO_PRICE_DATA' };
  const seg = path.slice(0, n + 1);
  // Tolerance 0 (validateParams): one missing close in c_0..c_n and the window is not classified.
  if (seg.length < n + 1 || seg.some((v) => v === null)) return { ...out, reason: 'MISSING_BARS' };
  if (sigma === null || sigma <= 0) return { ...out, reason: 'BASELINE_UNAVAILABLE' };
  const w0 = params.w0;
  const eps = params.eps;
  if (n <= w0) return { ...out, reason: 'WINDOW_TOO_SHORT' };
  const closes = seg as number[];
  const c0 = closes[0]!;
  const raw = closes.map((v) => v - c0);
  if (Math.abs(raw[w0]!) <= eps * Math.max(1, Math.abs(c0))) return { ...out, reason: 'NO_INITIAL_MOVE' };
  const sign = raw[w0]! > 0 ? 1 : -1;
  const x = raw.map((v) => sign * v);
  const S0 = sigma * Math.sqrt(w0);
  const Sn = sigma * Math.sqrt(n);
  const z0 = x[w0]! / S0;
  out.sign = sign;
  out.z0 = z0;
  if (z0 < params.k_small - eps) return { ...out, reason: 'SMALL_INITIAL' };

  let run = x[w0]!;
  let peak = x[w0]!;
  let Rmax = 0;
  let worstPullback = 0;
  for (let i = w0 + 1; i <= n; i++) {
    run = Math.max(run, x[i]!);
    const depth = run - x[i]!;
    const ratio = depth >= params.k_pb * S0 - eps ? depth / run : 0;
    if (ratio > Rmax) {
      Rmax = ratio;
      worstPullback = depth;
    }
    if (x[i]! >= peak) peak = x[i]!;
  }
  const m = Math.min(params.end_median_bars, n - w0 + 1);
  const F = median(x.slice(n - m + 1, n + 1));
  const Rf = peak - F >= params.k_pb * S0 - eps ? (peak - F) / peak : 0;
  Object.assign(out, { M: peak, F, Rmax, worstPullback, Rf, Fz: F / Sn, S0, Sn });

  let label: ClassLabel;
  if (F <= -Math.max(params.rho * Sn, params.phi * peak) + eps) label = 'REVERSAL';
  else if (Rf >= params.r_full - eps) label = 'FULL_RETRACE';
  else if (Rmax >= params.r_push - eps) label = 'PULLBACK';
  else label = 'CONTINUATION';
  out.label = label;

  const checks: [number, number][] = [
    [z0, params.k_small],
    [Rmax, params.r_push],
    [Rf, params.r_full],
    [-F, Math.max(params.rho * Sn, params.phi * peak)],
  ];
  out.borderline = checks.some(([v, t]) => t > 0 && v > 0 && Math.abs(v / t - 1) <= params.borderline_tolerance);
  return out;
}
