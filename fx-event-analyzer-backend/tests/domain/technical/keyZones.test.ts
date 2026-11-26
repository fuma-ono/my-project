/**
 * Key price zone tests (acceptance (b)): hand-built swings with known answers, determinism,
 * and append-stability of confirmed swings.
 */
import { describe, expect, it } from 'vitest';
import { detectKeyZones, findSwings, type Bar } from '../../../src/domain/technical/index.js';

const mk = (i: number, h: number, l: number): Bar => ({ t: i * 60_000, o: (h + l) / 2, h, l, c: (h + l) / 2 });

/** Range-bound market: peaks near 10 (10.0, 10.1) and troughs near 5 (5.0, 4.9), a lone peak at 20. */
function synthetic(): Bar[] {
  // each leg is a triangle so every extreme is a strict 5-bar fractal; range per bar = 1
  const peaks = [10.0, 5.0, 10.1, 4.9, 20, 5.0, 10.0];
  const bars: Bar[] = [];
  let prev = 7;
  let i = 0;
  const push = (mid: number): void => {
    bars.push(mk(i++, mid + 0.5, mid - 0.5));
  };
  for (const target of peaks) {
    for (let k = 1; k <= 5; k++) push(prev + ((target - prev) * k) / 5);
    prev = target;
  }
  // tail to confirm the last swing
  for (let k = 1; k <= 3; k++) push(prev - k * 0.5);
  return bars;
}

describe('findSwings', () => {
  it('finds strict fractals only and never within the unconfirmed tail', () => {
    const bars = [mk(0, 1, 0), mk(1, 2, 1), mk(2, 5, 4), mk(3, 2, 1), mk(4, 1, 0), mk(5, 9, 8)];
    const sw = findSwings(bars, 2);
    expect(sw).toEqual([{ index: 2, price: 5, kind: 'high' }]);
  });
  it('flat plateaus are not swings (strictness)', () => {
    const bars = [mk(0, 1, 0), mk(1, 1, 0), mk(2, 1, 0), mk(3, 1, 0), mk(4, 1, 0)];
    expect(findSwings(bars, 2)).toEqual([]);
  });
});

describe('detectKeyZones', () => {
  const bars = synthetic();

  it('clusters nearby swing highs / lows into zones with touch counts', () => {
    const zones = detectKeyZones(bars, { atrPeriod: 5, toleranceAtrMult: 0.5, minTouches: 2 });
    // tolerance = 0.5 * ATR, ATR ~ 1-2 => ~0.5-1: peaks 10.5/10.6 cluster; lone 20.5 dropped
    expect(zones.length).toBeGreaterThan(0);
    const top = zones.find((z) => z.center > 10 && z.center < 11)!;
    expect(top.touches).toBeGreaterThanOrEqual(2);
    expect(top.highTouches).toBe(top.touches);
    expect(zones.every((z) => z.touches >= 2)).toBe(true);
    expect(zones.some((z) => z.center > 15)).toBe(false);
    for (const z of zones) {
      expect(z.lower).toBeLessThanOrEqual(z.center);
      expect(z.upper).toBeGreaterThanOrEqual(z.center);
    }
  });

  it('minTouches = 1 keeps the isolated swing', () => {
    const zones = detectKeyZones(bars, { atrPeriod: 5, minTouches: 1 });
    expect(zones.some((z) => z.center > 15 && z.touches === 1)).toBe(true);
  });

  it('is deterministic and sorted (touches desc, recency desc)', () => {
    const a = detectKeyZones(bars, { atrPeriod: 5 });
    const b = detectKeyZones(structuredClone(bars), { atrPeriod: 5 });
    expect(b).toEqual(a);
    for (let i = 1; i < a.length; i++) {
      const p = a[i - 1]!;
      const q = a[i]!;
      expect(p.touches > q.touches || (p.touches === q.touches && p.lastIndex >= q.lastIndex)).toBe(true);
    }
  });

  it('returns [] for empty / too-short / zero-range input', () => {
    expect(detectKeyZones([])).toEqual([]);
    expect(detectKeyZones(bars.slice(0, 10))).toEqual([]);
    expect(detectKeyZones(Array.from({ length: 40 }, (_, i) => mk(i, 1, 1)))).toEqual([]);
  });

  it('confirmed swings are append-stable (earlier swings never change when bars are appended)', () => {
    const cut = 20;
    const early = findSwings(bars.slice(0, cut), 2);
    const later = findSwings(bars, 2);
    // every swing with index <= cut-1-span is confirmed within the prefix and must persist unchanged
    expect(later.filter((s) => s.index <= cut - 3)).toEqual(early.filter((s) => s.index <= cut - 3));
    expect(early.length).toBeGreaterThan(0);
  });
});
