/**
 * Deterministic support/resistance "key price zone" detector.
 *
 * Algorithm (no randomness, no look-ahead):
 *  1. Swing points: Williams-style fractals. Bar i is a swing high if high[i] is strictly greater
 *     than the highs of the `fractalSpan` bars on each side (swing low symmetric with lows).
 *     A swing at i is only CONFIRMED at i + fractalSpan, so only i <= last - fractalSpan are used.
 *  2. Tolerance = toleranceAtrMult * ATR(atrPeriod) evaluated at the last bar (a single zone width
 *     for the whole result so zones are comparable). If ATR is unavailable, no zones.
 *  3. Clustering: swing prices (highs and lows together) sorted ascending (ties by index); a swing
 *     joins the current cluster while |price - running cluster mean| <= tolerance, otherwise it
 *     starts a new cluster. Sorting + greedy makes the result deterministic.
 *  4. Zone = [min, max] of its swings, center = mean; touches = number of swings in the cluster.
 *     Clusters with touches < minTouches are dropped.
 *  5. Output order: touches desc, lastIndex desc (more recent first), center asc.
 *
 * Defaults: fractalSpan 2 (5-bar fractal), atrPeriod 14, toleranceAtrMult 0.5, minTouches 2.
 * These are tunable starting values, not yet validated on real data (owner review pending).
 * Note: because the tolerance uses the latest ATR, zones can change when bars are appended
 * (new swings and a new tolerance); the swing set of earlier bars never changes.
 * Volume is intentionally not used (FX volume semantics are provider-dependent).
 */
import { atr } from './indicators.js';
import { assertPeriod, type Bar } from './types.js';

export interface KeyZoneOptions {
  fractalSpan?: number;
  atrPeriod?: number;
  toleranceAtrMult?: number;
  minTouches?: number;
}

export interface SwingPoint {
  index: number;
  price: number;
  kind: 'high' | 'low';
}

export interface KeyZone {
  lower: number;
  upper: number;
  center: number;
  touches: number;
  highTouches: number;
  lowTouches: number;
  firstIndex: number;
  lastIndex: number;
}

export function findSwings(bars: readonly Bar[], fractalSpan = 2): SwingPoint[] {
  assertPeriod(fractalSpan, 'fractalSpan');
  const swings: SwingPoint[] = [];
  for (let i = fractalSpan; i < bars.length - fractalSpan; i++) {
    const cur = bars[i]!;
    let isHigh = true;
    let isLow = true;
    for (let k = 1; k <= fractalSpan; k++) {
      const a = bars[i - k]!;
      const b = bars[i + k]!;
      if (!(cur.h > a.h && cur.h > b.h)) isHigh = false;
      if (!(cur.l < a.l && cur.l < b.l)) isLow = false;
    }
    if (isHigh) swings.push({ index: i, price: cur.h, kind: 'high' });
    if (isLow) swings.push({ index: i, price: cur.l, kind: 'low' });
  }
  return swings;
}

export function detectKeyZones(bars: readonly Bar[], options: KeyZoneOptions = {}): KeyZone[] {
  const { fractalSpan = 2, atrPeriod = 14, toleranceAtrMult = 0.5, minTouches = 2 } = options;
  if (bars.length === 0) return [];
  const lastAtr = atr(bars, atrPeriod)[bars.length - 1];
  if (lastAtr == null || !(lastAtr > 0)) return [];
  const tol = toleranceAtrMult * lastAtr;

  const sorted = findSwings(bars, fractalSpan).sort((a, b) => a.price - b.price || a.index - b.index);
  const clusters: SwingPoint[][] = [];
  let sum = 0;
  for (const s of sorted) {
    const cur = clusters[clusters.length - 1];
    if (cur && Math.abs(s.price - sum / cur.length) <= tol) {
      cur.push(s);
      sum += s.price;
    } else {
      clusters.push([s]);
      sum = s.price;
    }
  }

  const zones: KeyZone[] = [];
  for (const c of clusters) {
    if (c.length < minTouches) continue;
    const prices = c.map((s) => s.price);
    const indices = c.map((s) => s.index);
    zones.push({
      lower: Math.min(...prices),
      upper: Math.max(...prices),
      center: prices.reduce((x, y) => x + y, 0) / prices.length,
      touches: c.length,
      highTouches: c.filter((s) => s.kind === 'high').length,
      lowTouches: c.filter((s) => s.kind === 'low').length,
      firstIndex: Math.min(...indices),
      lastIndex: Math.max(...indices),
    });
  }
  return zones.sort((a, b) => b.touches - a.touches || b.lastIndex - a.lastIndex || a.center - b.center);
}
