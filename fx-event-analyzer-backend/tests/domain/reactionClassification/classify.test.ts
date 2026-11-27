import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { analyzeEvent } from '../../../src/domain/reactionClassification/analyze.js';
import { classifyWindow, type ClassLabel } from '../../../src/domain/reactionClassification/classify.js';
import { deriveParams, RX_V1 } from '../../../src/domain/reactionClassification/params.js';

/** Golden paths, symmetry / scale / shift invariance, causality, boundaries and failure reasons (synthetic data only). */
function lin(points: [number, number][], n = 60): number[] {
  const out: number[] = [];
  for (let m = 0; m <= n; m++) {
    for (let i = 0; i + 1 < points.length; i++) {
      const [a, va] = points[i]!;
      const [b, vb] = points[i + 1]!;
      if (m >= a && m <= b) {
        out.push(va + ((vb - va) * (m - a)) / (b - a));
        break;
      }
    }
  }
  return out;
}

const GOLDEN: [ClassLabel | 'UNDETERMINED', [number, number][]][] = [
  [
    'CONTINUATION',
    [
      [0, 0],
      [2, 4],
      [10, 12],
      [60, 25],
    ],
  ],
  [
    'PULLBACK',
    [
      [0, 0],
      [2, 4],
      [5, 10],
      [20, 4],
      [60, 12],
    ],
  ],
  [
    'FULL_RETRACE',
    [
      [0, 0],
      [2, 4],
      [5, 10],
      [40, -3],
      [60, 0.5],
    ],
  ],
  [
    'FULL_RETRACE',
    [
      [0, 0],
      [2, 4],
      [5, 10],
      [60, -5],
    ],
  ], // ends beyond P0 but inside the noise band
  [
    'REVERSAL',
    [
      [0, 0],
      [2, 4],
      [5, 10],
      [40, -4],
      [60, -12],
    ],
  ],
  [
    'UNDETERMINED',
    [
      [0, 0],
      [2, 1],
      [10, 2],
      [60, -3],
    ],
  ],
];

const label = (path: (number | null)[], sigma: number | null, n: number, exact = true) =>
  classifyWindow(path, sigma, n, RX_V1, exact);

describe('golden paths (sigma = 1, windows 60)', () => {
  it.each(GOLDEN.map((g, i) => [i, g[0], g[1]] as const))('path %i is %s', (_i, expected, points) => {
    const path = lin(points).map((v) => 100 + v);
    const r = label(path, 1.0, 60);
    expect(r.label).toBe(expected);
    if (expected === 'UNDETERMINED') expect(r.reason).toBe('SMALL_INITIAL');
    else expect(r.reason).toBeNull();
    // mirror image
    expect(
      label(
        lin(points).map((v) => 100 - v),
        1.0,
        60,
      ).label,
    ).toBe(expected);
    // scale (price and sigma together) and level shift
    expect(
      label(
        path.map((v) => v * 7.3),
        7.3,
        60,
      ).label,
    ).toBe(expected);
    expect(
      label(
        path.map((v) => v + 1234.5),
        1.0,
        60,
      ).label,
    ).toBe(expected);
  });

  it('the evidence of the pull-back path is internally consistent', () => {
    const r = label(
      lin(GOLDEN[1]![1]).map((v) => 100 + v),
      1.0,
      60,
    );
    expect(r.sign).toBe(1);
    expect(r.M).toBeCloseTo(12, 9); // the last close is the highest
    expect(r.worstPullback).toBeCloseTo(6, 9);
    expect(r.Rmax).toBeCloseTo(0.6, 9);
    expect(r.F).toBeCloseTo(11.8, 9); // median of the last three closes
    expect(r.Rf).toBe(0);
    expect(r.z0).toBeCloseTo(4 / Math.sqrt(2), 9);
  });
});

describe('window handling', () => {
  const p = lin(GOLDEN[0]![1]).map((v) => 100 + v);
  it('a window not longer than w0 is WINDOW_TOO_SHORT', () => {
    expect(label(p, 1.0, 1)).toMatchObject({ label: 'UNDETERMINED', reason: 'WINDOW_TOO_SHORT' });
    expect(label(p, 1.0, 2)).toMatchObject({ label: 'UNDETERMINED', reason: 'WINDOW_TOO_SHORT' });
  });
  it('the 5-minute window can be labelled when the parameter set classifies it', () => {
    expect(label(p, 1.0, 5).label).not.toBe('UNDETERMINED');
  });
  it('the label of window n never depends on closes after n (causality, 3 x 300 random paths)', () => {
    let seed = 3;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    const gauss = () => Math.sqrt(-2 * Math.log(rnd() || 1e-12)) * Math.cos(2 * Math.PI * rnd());
    for (let t = 0; t < 300; t++) {
      const path = [100];
      for (let i = 0; i < 60; i++) path.push(path[path.length - 1]! + gauss());
      for (const n of [5, 15, 30]) {
        const altered = [...path.slice(0, n + 1), ...Array.from({ length: 60 - n }, () => 100 + 50 * gauss())];
        expect(label(altered, 1.0, n)).toEqual(label(path, 1.0, n));
      }
    }
  });
});

describe('boundaries and failure reasons', () => {
  it('z0 exactly k_small is determined, 1.999 is SMALL_INITIAL', () => {
    const edge = (z: number) =>
      lin([
        [0, 0],
        [2, z * Math.SQRT2],
        [60, z * Math.SQRT2],
      ]).map((v) => 100 + v);
    expect(label(edge(2.0), 1.0, 60).label).not.toBe('UNDETERMINED');
    expect(label(edge(1.999), 1.0, 60)).toMatchObject({ label: 'UNDETERMINED', reason: 'SMALL_INITIAL' });
  });
  const base = lin(GOLDEN[1]![1]).map((v) => 100 + v);
  it('one missing close makes only the windows that contain it MISSING_BARS', () => {
    const q: (number | null)[] = [...base];
    q[40] = null;
    expect(label(q, 1.0, 60).reason).toBe('MISSING_BARS');
    expect(label(q, 1.0, 30).label).not.toBe('UNDETERMINED');
  });
  it('a missing P0 close is MISSING_BARS for every window; no bars at all is NO_PRICE_DATA', () => {
    const q: (number | null)[] = [...base];
    q[0] = null;
    for (const n of [5, 15, 30, 60]) expect(label(q, 1.0, n).reason).toBe('MISSING_BARS');
    expect(label(Array<number | null>(61).fill(null), 1.0, 60).reason).toBe('NO_PRICE_DATA');
  });
  it('no sigma, an inexact release time and a flat path', () => {
    expect(label(base, null, 60).reason).toBe('BASELINE_UNAVAILABLE');
    expect(label(base, 0, 60).reason).toBe('BASELINE_UNAVAILABLE');
    expect(label(base, 1.0, 60, false).reason).toBe('RELEASE_TIME_NOT_EXACT');
    expect(label(Array<number>(61).fill(100), 1.0, 60).reason).toBe('NO_INITIAL_MOVE');
  });
  it('missing_bars_tolerated_in_window other than 0 is rejected (bars are never interpolated)', () => {
    expect(() => deriveParams(RX_V1, { missing_bars_tolerated_in_window: 1 })).toThrow(RangeError);
  });
});

describe('classified windows (owner decision E)', () => {
  const bars = new Map<number, number>();
  const T = 30_000_000; // minute index of the release (synthetic)
  const path = lin(GOLDEN[1]![1]).map((v) => 100 + v * 0.1);
  bars.set(T - 1, path[0]!);
  for (let k = 1; k <= 60; k++) bars.set(T + k - 1, path[k]!);
  // a quiet pre-release hour so sigma_own exists (alternating 0.01 steps)
  for (let k = 2; k <= 61; k++) bars.set(T - k, 100 + (k % 2) * 0.01);
  const input = { releaseMs: T * 60_000, timeExact: true, bars, pipSize: 0.01 };

  it('1- and 5-minute windows are REFERENCE_ONLY with no label and the right reason', () => {
    const a = analyzeEvent({ ...input, params: RX_V1 });
    const [m1, m5, ...rest] = a.windows;
    expect(m1).toMatchObject({
      minutes: 1,
      classification_status: 'REFERENCE_ONLY',
      label: null,
      reason: 'WINDOW_TOO_SHORT',
    });
    expect(m5).toMatchObject({
      minutes: 5,
      classification_status: 'REFERENCE_ONLY',
      label: null,
      reason: 'WINDOW_EXCLUDED_BY_PARAMS',
      evidence: null,
    });
    expect(rest.map((w) => w.minutes)).toEqual([15, 30, 60]);
    expect(
      rest.every((w) => w.classification_status === 'CLASSIFIED' || w.classification_status === 'UNDETERMINED'),
    ).toBe(true);
  });

  it('a parameter set that includes 5 classifies the 5-minute window', () => {
    const rx5 = deriveParams(RX_V1, { param_set_id: 'rx-test-5', classified_windows: [5, 15, 30, 60] });
    const w5 = analyzeEvent({ ...input, params: rx5 }).windows.find((w) => w.minutes === 5)!;
    expect(w5.classification_status).not.toBe('REFERENCE_ONLY');
    expect(w5.label).not.toBeNull();
  });

  it('windows that have not closed (end + finality > now) are PENDING with no label', () => {
    const now = (T + 20) * 60_000; // 20 minutes after the release
    const a = analyzeEvent({ ...input, params: RX_V1, nowMs: now, finalityMs: 120_000 });
    const byMinutes = Object.fromEntries(a.windows.map((w) => [w.minutes, w.classification_status]));
    expect(byMinutes).toMatchObject({
      1: 'REFERENCE_ONLY',
      5: 'REFERENCE_ONLY',
      15: 'CLASSIFIED',
      30: 'PENDING',
      60: 'PENDING',
    });
    // finality: 15 minutes closed 5 minutes ago is still inside a 10-minute finality lag
    const lagged = analyzeEvent({ ...input, params: RX_V1, nowMs: now, finalityMs: 10 * 60_000 });
    expect(lagged.windows.find((w) => w.minutes === 15)!.classification_status).toBe('PENDING');
  });

  it('an inexact release time classifies nothing and reads no bars', () => {
    const a = analyzeEvent({ ...input, timeExact: false, params: RX_V1 });
    expect(a.windows.filter((w) => w.reason === 'RELEASE_TIME_NOT_EXACT').map((w) => w.minutes)).toEqual([15, 30, 60]);
    expect(a.baseline.source).toBe('NONE');
    expect(a.preReleasePrice).toBeNull();
  });

  it('evidence is reported in pips and carries no peak / trough time', () => {
    const a = analyzeEvent({ ...input, params: RX_V1 });
    const w = a.windows.find((x) => x.minutes === 60)!;
    if (w.evidence) {
      expect(Object.keys(w.evidence).sort()).toEqual([
        'borderline',
        'final_offset_in_noise_units',
        'final_offset_pips',
        'final_retracement_ratio',
        'initial_z',
        'peak_offset_pips',
        'worst_pullback_pips',
        'worst_pullback_ratio',
      ]);
    }
  });
});

describe('no magic numbers in the classifier modules', () => {
  it.each(['classify.ts', 'baseline.ts'])('%s has no numeric literal other than 0 and 1', (file) => {
    const source = readFileSync(new URL(`../../../src/domain/reactionClassification/${file}`, import.meta.url), 'utf8');
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '')
      .replace(/'[^'\n]*'/g, "''");
    const literals = [...code.matchAll(/(?<![\w.])\d+(?:\.\d+)?(?:e[+-]?\d+)?(?![\w])/gi)].map((m) => m[0]);
    expect(literals.filter((l) => l !== '0' && l !== '1')).toEqual([]);
  });
});
