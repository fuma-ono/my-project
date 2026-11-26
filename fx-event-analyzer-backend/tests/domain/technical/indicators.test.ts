/**
 * Indicator tests. Definition of done: see header of src/domain/technical/indicators.ts
 *  (a) golden values: textbook data + independent pandas fixture (reference.json, 1e-9 relative)
 *  (b) pivots / key zones: see also keyZones.test.ts
 *  (c) property tests: length alignment, warm-up nulls, no look-ahead.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  atr,
  bollinger,
  classicPivots,
  ema,
  macd,
  pivotSeries,
  rsi,
  sma,
  stochastic,
  trueRange,
  wma,
  type Bar,
  type Series,
} from '../../../src/domain/technical/index.js';

interface RefBar {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}
type NS = (number | null)[];
interface Ref {
  input: RefBar[];
  true_range: NS;
  atr_14: NS;
  atr_5: NS;
  rsi_14: NS;
  rsi_7: NS;
  macd_12_26_9: { macd: NS; signal: NS; histogram: NS };
  bollinger_20_2: { middle: NS; upper: NS; lower: NS };
  stoch_14_3_3: { k: NS; d: NS };
}
const ref = JSON.parse(
  readFileSync(new URL('../../fixtures/technical/reference.json', import.meta.url), 'utf8'),
) as Ref;
const flat = ref as unknown as Record<string, NS>;
const bars = ref.input;
const closes = bars.map((b) => b.c);

function expectSeriesClose(actual: Series, expected: (number | null)[], rel = 1e-9): void {
  expect(actual.length).toBe(expected.length);
  for (let i = 0; i < expected.length; i++) {
    const e = expected[i];
    const a = actual[i];
    if (e === null || e === undefined) {
      expect(a, `index ${i} should be null`).toBeNull();
    } else {
      expect(a, `index ${i} should be a number`).not.toBeNull();
      expect(Math.abs(a! - e), `index ${i}: ${a} vs ${e}`).toBeLessThanOrEqual(rel * Math.max(1, Math.abs(e)));
    }
  }
}

describe('textbook values', () => {
  // Wilder's RSI example data as published by StockCharts ("RSI" ChartSchool worked example,
  // 14-period). Published RSI values (rounded to 2 dp) for the first 14 results.
  const wilderCloses = [
    44.3389, 44.0902, 44.1497, 43.6124, 44.3278, 44.8264, 45.0955, 45.4245, 45.8433, 46.0826, 45.8931, 46.0328, 45.614,
    46.282, 46.282, 46.0028, 46.0328, 46.4116, 46.2222, 45.6439, 46.2122, 46.2521, 45.7137, 46.4515, 45.7835, 45.3548,
    44.0288, 44.1783,
  ];
  const published = [70.53, 66.32, 66.55, 69.41, 66.36, 57.97, 62.93, 63.26, 56.06, 62.38, 54.71, 50.42, 39.99, 41.46];

  it('Wilder RSI(14) matches the published StockCharts values', () => {
    const out = rsi(wilderCloses, 14);
    expect(out.slice(0, 14).every((x) => x === null)).toBe(true);
    published.forEach((p, k) => expect(out[14 + k]!).toBeCloseTo(p, 2));
  });

  it('Bollinger uses population sd: [2,4,4,4,5,5,7,9] has mean 5 and sd 2', () => {
    const b = bollinger([2, 4, 4, 4, 5, 5, 7, 9], 8, 2);
    expect(b.middle[7]).toBe(5);
    expect(b.upper[7]).toBeCloseTo(9, 12);
    expect(b.lower[7]).toBeCloseTo(1, 12);
    expect(b.upper[6]).toBeNull();
  });

  it('SMA / WMA / EMA on small hand-computed inputs', () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
    // WMA(3) of [1,2,3,4]: (1*1+2*2+3*3)/6 = 14/6 ; (2+6+12)/6 = 20/6
    const w = wma([1, 2, 3, 4], 3);
    expect(w[2]).toBeCloseTo(14 / 6, 12);
    expect(w[3]).toBeCloseTo(20 / 6, 12);
    // EMA(3): seed = mean(1,2,3)=2, alpha=0.5 -> 2 + .5*(4-2) = 3 ; 3 + .5*(5-3) = 4
    expect(ema([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
  });

  it('ATR hand example (period 2) and true range with gaps', () => {
    const mk = (h: number, l: number, c: number): Bar => ({ t: 0, o: c, h, l, c });
    const b = [mk(10, 8, 9), mk(11, 9, 10), mk(14, 12, 13), mk(13, 11, 12)];
    // TR[1]=2, TR[2]=max(2,|14-10|,|12-10|)=4, TR[3]=max(2,|13-13|,|11-13|)=2
    expect(trueRange(b)).toEqual([null, 2, 4, 2]);
    // ATR(2): [2]=(2+4)/2=3 ; [3]=(3*1+2)/2=2.5
    expect(atr(b, 2)).toEqual([null, null, 3, 2.5]);
  });

  it('classic pivots H=1.2 L=1.0 C=1.1', () => {
    const p = classicPivots(1.2, 1.0, 1.1);
    expect(p.pivot).toBeCloseTo(1.1, 12);
    expect(p.r1).toBeCloseTo(1.2, 12);
    expect(p.s1).toBeCloseTo(1.0, 12);
    expect(p.r2).toBeCloseTo(1.3, 12);
    expect(p.s2).toBeCloseTo(0.9, 12);
    expect(p.r3).toBeCloseTo(1.4, 12);
    expect(p.s3).toBeCloseTo(0.8, 12);
  });

  it('stochastic extremes: close at the window high gives 100, at the low gives 0', () => {
    const mk = (h: number, l: number, c: number): Bar => ({ t: 0, o: c, h, l, c });
    const up = [mk(1, 0, 0.5), mk(2, 1, 2), mk(3, 2, 3)];
    expect(stochastic(up, 3, 1, 1).k[2]).toBe(100);
    const down = [mk(3, 2, 2.5), mk(2, 1, 1), mk(1, 0, 0)];
    expect(stochastic(down, 3, 1, 1).k[2]).toBe(0);
  });

  it('RSI edge cases: monotone up = 100, flat = 50', () => {
    expect(rsi([1, 2, 3, 4], 3)[3]).toBe(100);
    expect(rsi([1, 1, 1, 1], 3)[3]).toBe(50);
  });

  it('rejects invalid periods', () => {
    expect(() => sma([1], 0)).toThrow(RangeError);
    expect(() => macd([1], 26, 12)).toThrow(RangeError);
  });
});

describe('independent pandas reference (reference.json)', () => {
  it('SMA / WMA / EMA', () => {
    for (const n of [5, 20]) expectSeriesClose(sma(closes, n), flat[`sma_${n}`]!);
    for (const n of [5, 14]) expectSeriesClose(wma(closes, n), flat[`wma_${n}`]!);
    for (const n of [9, 21]) expectSeriesClose(ema(closes, n), flat[`ema_${n}`]!);
  });
  it('RSI', () => {
    expectSeriesClose(rsi(closes, 14), ref.rsi_14);
    expectSeriesClose(rsi(closes, 7), ref.rsi_7);
  });
  it('MACD 12,26,9', () => {
    const m = macd(closes, 12, 26, 9);
    expectSeriesClose(m.macd, ref.macd_12_26_9.macd);
    expectSeriesClose(m.signal, ref.macd_12_26_9.signal);
    expectSeriesClose(m.histogram, ref.macd_12_26_9.histogram);
  });
  it('Bollinger 20,2', () => {
    const b = bollinger(closes, 20, 2);
    expectSeriesClose(b.middle, ref.bollinger_20_2.middle);
    expectSeriesClose(b.upper, ref.bollinger_20_2.upper);
    expectSeriesClose(b.lower, ref.bollinger_20_2.lower);
  });
  it('True range / ATR', () => {
    expectSeriesClose(trueRange(bars), ref.true_range);
    expectSeriesClose(atr(bars, 14), ref.atr_14);
    expectSeriesClose(atr(bars, 5), ref.atr_5);
  });
  it('Stochastic 14,3,3', () => {
    const s = stochastic(bars, 14, 3, 3);
    expectSeriesClose(s.k, ref.stoch_14_3_3.k);
    expectSeriesClose(s.d, ref.stoch_14_3_3.d);
  });
});

describe('properties', () => {
  const all = (b: readonly Bar[]): Record<string, Series> => {
    const c = b.map((x) => x.c);
    const m = macd(c);
    const bb = bollinger(c);
    const st = stochastic(b);
    return {
      sma: sma(c, 20),
      wma: wma(c, 14),
      ema: ema(c, 21),
      rsi: rsi(c),
      macd: m.macd,
      signal: m.signal,
      hist: m.histogram,
      bbU: bb.upper,
      bbL: bb.lower,
      atr: atr(b),
      k: st.k,
      d: st.d,
    };
  };

  it('output length equals input length for every length, incl. shorter than warm-up', () => {
    for (const n of [0, 1, 5, 14, 15, 26, 34, 100]) {
      for (const s of Object.values(all(bars.slice(0, n)))) expect(s.length).toBe(n);
    }
  });

  it('warm-up is null and the first value appears at the expected index', () => {
    const r = all(bars);
    const firstIdx = (s: Series): number => s.findIndex((x) => x !== null);
    expect(firstIdx(r.sma!)).toBe(19);
    expect(firstIdx(r.wma!)).toBe(13);
    expect(firstIdx(r.ema!)).toBe(20);
    expect(firstIdx(r.rsi!)).toBe(14);
    expect(firstIdx(r.macd!)).toBe(25);
    expect(firstIdx(r.signal!)).toBe(33);
    expect(firstIdx(r.bbU!)).toBe(19);
    expect(firstIdx(r.atr!)).toBe(14);
    expect(firstIdx(r.k!)).toBe(15);
    expect(firstIdx(r.d!)).toBe(17);
    for (const s of Object.values(r)) {
      const f = firstIdx(s);
      expect(s.slice(f).every((x) => x !== null && Number.isFinite(x))).toBe(true);
    }
  });

  it('no look-ahead: appending future bars never changes earlier values', () => {
    const full = all(bars);
    for (const cut of [60, 150, 301]) {
      const part = all(bars.slice(0, cut));
      for (const [name, s] of Object.entries(part)) {
        for (let i = 0; i < cut; i++) {
          expect(s[i], `${name}[${i}] cut=${cut}`).toBe(full[name]![i]);
        }
      }
    }
  });

  it('pivotSeries uses only the previous completed candle', () => {
    const p = pivotSeries(bars.slice(0, 5));
    expect(p[0]).toBeNull();
    expect(p[3]).toEqual(classicPivots(bars[2]!.h, bars[2]!.l, bars[2]!.c));
    expect(pivotSeries(bars.slice(0, 3))[2]).toEqual(p[2]);
  });
});
