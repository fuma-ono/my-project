/**
 * Bootstrap confidence intervals for expectancy (mean net pips per trade).
 *
 * Why three methods: trades are often serially dependent (clustered around events, overlapping
 * regimes). The i.i.d. bootstrap ignores that and gives intervals that are too narrow for positively
 * autocorrelated PnL. The moving-block and stationary (Politis-Romano) bootstraps resample blocks
 * of consecutive trades and keep short-range dependence. The display gate consumes the
 * CONSERVATIVE combination: widest interval and largest p-value across iid and stationary results.
 * All methods are seeded and deterministic. Residual limitation: block methods assume short memory
 * and stationarity, and tiny samples (n < ~30) are unreliable whatever the method.
 */
import { mulberry32 } from './manifest.js';

export type BootstrapMethod = 'iid' | 'moving-block' | 'stationary' | 'conservative';

export interface BootstrapResult {
  method: BootstrapMethod;
  meanPips: number;
  /** Percentile CI of the mean at the given two-sided confidence. */
  lower: number;
  upper: number;
  confidence: number;
  resamples: number;
  /** One-sided p-value for H0: mean <= 0 (null-centred bootstrap). */
  pValue: number;
  seed: number;
  /** Mean block length (block methods); null for iid. */
  blockLength: number | null;
}

export interface BootstrapOptions {
  seed: number;
  resamples?: number;
  confidence?: number;
}

type Sampler = (n: number, rnd: () => number) => number[];

const mean = (x: readonly number[]): number => x.reduce((a, b) => a + b, 0) / x.length;

const iidSampler: Sampler = (n, rnd) => Array.from({ length: n }, () => Math.floor(rnd() * n));

/** Moving-block bootstrap: concatenate randomly placed blocks of fixed length b (no wrap), truncate to n. */
function movingBlockSampler(b: number): Sampler {
  return (n, rnd) => {
    const idx: number[] = [];
    while (idx.length < n) {
      const start = Math.floor(rnd() * (n - b + 1));
      for (let k = 0; k < b && idx.length < n; k++) idx.push(start + k);
    }
    return idx;
  };
}

/** Stationary bootstrap (Politis-Romano): geometric block lengths with mean b, circular wrap. */
function stationarySampler(b: number): Sampler {
  return (n, rnd) => {
    const idx: number[] = [];
    let cur = Math.floor(rnd() * n);
    idx.push(cur);
    while (idx.length < n) {
      cur = rnd() < 1 / b ? Math.floor(rnd() * n) : (cur + 1) % n;
      idx.push(cur);
    }
    return idx;
  };
}

function bootstrapMean(
  pnls: readonly number[],
  opts: BootstrapOptions,
  method: BootstrapMethod,
  blockLength: number | null,
  sampler: Sampler,
): BootstrapResult | null {
  const n = pnls.length;
  if (n < 2) return null;
  const B = opts.resamples ?? 2000;
  const confidence = opts.confidence ?? 0.95;
  const rnd = mulberry32(opts.seed);
  const m = mean(pnls);
  const means: number[] = [];
  let atLeast = 0;
  for (let b = 0; b < B; b++) {
    let s = 0;
    for (const k of sampler(n, rnd)) s += pnls[k]!;
    means.push(s / n);
    if (s / n - m >= m) atLeast++; // null-centred resample mean >= observed mean
  }
  means.sort((a, b) => a - b);
  const lo = (1 - confidence) / 2;
  const at = (q: number): number => means[Math.min(B - 1, Math.max(0, Math.floor(q * B)))]!;
  return {
    method,
    meanPips: m,
    lower: at(lo),
    upper: at(1 - lo),
    confidence,
    resamples: B,
    pValue: (atLeast + 1) / (B + 1),
    seed: opts.seed,
    blockLength,
  };
}

/** Seeded i.i.d. bootstrap of the mean. Too narrow when PnL is positively autocorrelated. */
export function bootstrapExpectancy(pnls: readonly number[], opts: BootstrapOptions): BootstrapResult | null {
  return bootstrapMean(pnls, opts, 'iid', null, iidSampler);
}

/** Moving-block bootstrap with fixed block length (clamped to 1..n). */
export function bootstrapMovingBlock(
  pnls: readonly number[],
  opts: BootstrapOptions & { blockLength: number },
): BootstrapResult | null {
  const b = Math.max(1, Math.min(Math.floor(opts.blockLength), pnls.length));
  return bootstrapMean(pnls, opts, 'moving-block', b, movingBlockSampler(b));
}

/** Stationary bootstrap with mean block length `blockLength` (>= 1). */
export function bootstrapStationary(
  pnls: readonly number[],
  opts: BootstrapOptions & { blockLength: number },
): BootstrapResult | null {
  const b = Math.max(1, opts.blockLength);
  return bootstrapMean(pnls, opts, 'stationary', b, stationarySampler(b));
}

/** Lag-1 sample autocorrelation (null for fewer than 3 points or zero variance). */
export function lag1Autocorrelation(x: readonly number[]): number | null {
  if (x.length < 3) return null;
  const m = mean(x);
  let num = 0;
  let den = 0;
  for (let i = 0; i < x.length; i++) {
    den += (x[i]! - m) ** 2;
    if (i > 0) num += (x[i]! - m) * (x[i - 1]! - m);
  }
  return den > 0 ? num / den : null;
}

/**
 * Simple block-length rule: AR(1) plug-in of the Politis-White optimal stationary-bootstrap block
 * length for the sample mean,
 *   b = ceil( (2|rho| / (1 - rho^2))^(2/3) * n^(1/3) ),
 * rho = lag-1 autocorrelation (|rho| capped at 0.95), clamped to [1, floor(n/2)]. rho = 0 gives
 * b = 1 (= iid). A heuristic, not the full flat-top-kernel Politis-White estimator; it assumes
 * AR(1)-like short memory.
 */
export function selectBlockLength(x: readonly number[]): number {
  const n = x.length;
  const rho = lag1Autocorrelation(x);
  if (rho === null || n < 4) return 1;
  const r = Math.min(Math.abs(rho), 0.95);
  const b = Math.ceil(((2 * r) / (1 - r * r)) ** (2 / 3) * n ** (1 / 3));
  return Math.max(1, Math.min(Math.floor(n / 2), b));
}

/** Widest interval and largest p-value of the given results. */
export function conservativeInterval(results: readonly BootstrapResult[]): BootstrapResult | null {
  const first = results[0];
  if (!first) return null;
  return {
    ...first,
    method: 'conservative',
    lower: Math.min(...results.map((r) => r.lower)),
    upper: Math.max(...results.map((r) => r.upper)),
    pValue: Math.max(...results.map((r) => r.pValue)),
    blockLength: results.reduce<number | null>((a, r) => (r.blockLength !== null ? r.blockLength : a), null),
  };
}

/** iid + stationary bootstrap (block length from selectBlockLength unless given), combined conservatively. */
export function conservativeExpectancyCI(
  pnls: readonly number[],
  opts: BootstrapOptions & { blockLength?: number },
): { combined: BootstrapResult | null; iid: BootstrapResult | null; block: BootstrapResult | null } {
  const iid = bootstrapExpectancy(pnls, opts);
  const block = bootstrapStationary(pnls, {
    ...opts,
    seed: (opts.seed ^ 0x9e3779b9) >>> 0,
    blockLength: opts.blockLength ?? selectBlockLength(pnls),
  });
  return { combined: conservativeInterval([iid, block].filter((r): r is BootstrapResult => r !== null)), iid, block };
}
