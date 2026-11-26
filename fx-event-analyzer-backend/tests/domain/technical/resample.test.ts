/**
 * Resampler tests (acceptance (c): gaps / FX week / holidays / DST).
 * Reference vectors (tests/fixtures/technical/reference.json) come from scripts/generate_technical_fixtures.py:
 *  - UTC-convention and sub-daily candles: pandas resample (origin=epoch).
 *  - NY17 FX-day 1D/4h candles: Python zoneinfo grouping (independent of the Intl-based implementation),
 *    with the daily result also cross-checked inside the generator against pandas tz-aware resample(offset=17h).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TIMEFRAME_MS, resample, type Bar, type Candle, type Timeframe } from '../../../src/domain/technical/index.js';

interface RefBar {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}
interface RefCandle extends RefBar {
  n: number;
  end?: number;
  expected?: number;
}
const ref = JSON.parse(readFileSync(new URL('../../fixtures/technical/reference.json', import.meta.url), 'utf8')) as {
  resample_input: RefBar[];
  resample_5m_to: Record<string, RefCandle[]>;
  ny17_input_1h: RefBar[];
  ny17_1h_to: Record<'1D' | '4h', RefCandle[]>;
  ny17_input_continuous: RefBar[];
  ny17_continuous_to: Record<'1D' | '4h', RefCandle[]>;
};

function expectMatches(out: Candle[], exp: RefCandle[]): void {
  expect(out.length).toBe(exp.length);
  out.forEach((c, i) => {
    const e = exp[i]!;
    expect([c.t, c.o, c.h, c.l, c.c, c.v, c.barCount]).toEqual([e.t, e.o, e.h, e.l, e.c, e.v, e.n]);
    if (e.end !== undefined) expect([c.end, c.expectedBars]).toEqual([e.end, e.expected]);
  });
}

const iso = (s: string): number => Date.parse(s);

describe('resample vs reference', () => {
  for (const tf of ['15m', '1h'] as const) {
    it(`5m -> ${tf} (pandas)`, () => {
      expectMatches(resample(ref.resample_input, '5m', tf), ref.resample_5m_to[tf]!);
    });
  }
  for (const tf of ['4h', '1D'] as const) {
    it(`5m -> ${tf} UTC convention (pandas)`, () => {
      expectMatches(resample(ref.resample_input, '5m', tf, { convention: 'utc' }), ref.resample_5m_to[tf]!);
    });
  }
  it('5m -> 1D NY17 (zoneinfo + pandas tz-aware)', () => {
    expectMatches(resample(ref.resample_input, '5m', '1D'), ref.resample_5m_to['1D_ny17']!);
  });
  it('5m -> 4h NY17 (zoneinfo)', () => {
    expectMatches(resample(ref.resample_input, '5m', '4h'), ref.resample_5m_to['4h_ny17']!);
  });
  for (const tf of ['1D', '4h'] as const) {
    it(`1h -> ${tf} NY17 around DST changes and holidays`, () => {
      expectMatches(resample(ref.ny17_input_1h, '1h', tf), ref.ny17_1h_to[tf]);
    });
    it(`1h -> ${tf} NY17, 24/7 series across both DST changes (23h/25h days)`, () => {
      expectMatches(resample(ref.ny17_input_continuous, '1h', tf), ref.ny17_continuous_to[tf]);
    });
  }
});

describe('NY17 convention', () => {
  const day = resample(ref.ny17_input_continuous, '1h', '1D');
  const h4 = resample(ref.ny17_input_continuous, '1h', '4h');

  it('DST days have 23h / 25h daily bars', () => {
    const spring = day.find((c) => c.t === iso('2024-03-09T22:00:00Z'))!; // Sat 17:00 EST -> Sun 17:00 EDT
    expect([spring.end - spring.t, spring.expectedBars, spring.barCount]).toEqual([23 * 3_600_000, 23, 23]);
    const fall = day.find((c) => c.t === iso('2024-11-02T21:00:00Z'))!; // Sat 17:00 EDT -> Sun 17:00 EST
    expect([fall.end - fall.t, fall.expectedBars, fall.barCount]).toEqual([25 * 3_600_000, 25, 25]);
    const normal = day.find((c) => c.t === iso('2024-03-11T21:00:00Z'))!;
    expect(normal.end - normal.t).toBe(24 * 3_600_000);
  });

  it('4h bars: six per FX day, the DST bar is 3h (spring) / 5h (fall)', () => {
    const springBar = h4.find((c) => c.t === iso('2024-03-10T06:00:00Z'))!;
    expect([springBar.end - springBar.t, springBar.expectedBars]).toEqual([3 * 3_600_000, 3]);
    const fallBar = h4.find((c) => c.t === iso('2024-11-03T05:00:00Z'))!;
    expect([fallBar.end - fallBar.t, fallBar.expectedBars]).toEqual([5 * 3_600_000, 5]);
  });

  it('invariant: 6 x 4h tile every daily bar exactly and aggregate to the same OHLCV', () => {
    const fullDays = day.filter((d) => !d.hasGaps);
    expect(fullDays.length).toBeGreaterThan(5);
    for (const d of fullDays) {
      const inside = h4.filter((c) => c.t >= d.t && c.end <= d.end);
      expect(inside).toHaveLength(6);
      expect(inside[0]!.t).toBe(d.t);
      expect(inside[5]!.end).toBe(d.end);
      for (let i = 1; i < 6; i++) expect(inside[i]!.t).toBe(inside[i - 1]!.end);
      expect(inside[0]!.o).toBe(d.o);
      expect(inside[5]!.c).toBe(d.c);
      expect(Math.max(...inside.map((c) => c.h))).toBe(d.h);
      expect(Math.min(...inside.map((c) => c.l))).toBe(d.l);
      expect(inside.reduce((a, c) => a + (c.v ?? 0), 0)).toBe(d.v);
      expect(inside.reduce((a, c) => a + c.barCount, 0)).toBe(d.barCount);
    }
  });

  it('4h source can be rolled up into 1D with the same OHLCV as from 1h', () => {
    const viaH4 = resample(
      h4.map((c) => ({ t: c.t, o: c.o, h: c.h, l: c.l, c: c.c, ...(c.v !== undefined ? { v: c.v } : {}) })),
      '4h',
      '1D',
    );
    expect(viaH4.map((c) => [c.t, c.end, c.o, c.h, c.l, c.c, c.v, c.expectedBars])).toEqual(
      day.map((c) => [c.t, c.end, c.o, c.h, c.l, c.c, c.v, 6]),
    );
    expect(viaH4.filter((c) => !c.hasGaps).length).toBeGreaterThan(5);
  });

  it('weekend: no Saturday bar; Sunday 17:00 NY starts the Monday daily bar', () => {
    const days = resample(ref.ny17_input_1h, '1h', '1D');
    const sunOpen = days.find((c) => c.t === iso('2024-03-10T21:00:00Z'))!; // Sun 17:00 EDT
    expect(new Date(sunOpen.end).toISOString()).toBe('2024-03-11T21:00:00.000Z');
    // The FX day that would start Fri 17:00 NY (closed market) must not exist.
    expect(days.some((c) => c.t === iso('2024-03-08T22:00:00Z'))).toBe(false);
    expect(days.every((c) => c.end - c.t >= 23 * 3_600_000)).toBe(true);
  });

  it('holidays: nothing is synthesised; thin days show barCount < expectedBars and hasGaps', () => {
    const days = resample(ref.ny17_input_1h, '1h', '1D');
    // Whole of 25 Dec NY local date is missing: the FX day Dec 24 17:00 NY -> Dec 25 17:00 NY has no candle.
    expect(days.some((c) => c.t === iso('2024-12-24T22:00:00Z'))).toBe(false);
    const thin = days.find((c) => c.t === iso('2024-12-25T22:00:00Z'))!; // Dec 25 17:00 NY start; only 17h of data
    expect(thin.expectedBars).toBe(24);
    expect(thin.barCount).toBeLessThan(24);
    expect(thin.hasGaps).toBe(true);
    expect(days.some((c) => !c.hasGaps)).toBe(true);
    for (const c of days) expect(c.hasGaps).toBe(c.barCount < c.expectedBars);
  });

  it('missing data inside a day is flagged, never filled', () => {
    const start = iso('2024-01-03T22:00:00Z'); // Wed 17:00 NY (EST)
    const mk = (h: number): Bar => ({ t: start + h * 3_600_000, o: 1, h: 2, l: 0.5, c: 1.5, v: 1 });
    const out = resample([mk(0), mk(1), mk(5), mk(23)], '1h', '1D');
    expect(out).toHaveLength(1);
    expect([out[0]!.barCount, out[0]!.expectedBars, out[0]!.hasGaps, out[0]!.v]).toEqual([4, 24, true, 4]);
    const four = resample([mk(0), mk(1), mk(5), mk(23)], '1h', '4h');
    expect(four.map((c) => [c.t - start, c.barCount, c.expectedBars])).toEqual([
      [0, 2, 4],
      [4 * 3_600_000, 1, 4],
      [20 * 3_600_000, 1, 4],
    ]);
  });

  it('rejects unsupported NY17 source/target combinations', () => {
    expect(() => resample([], '4h', '4h')).toThrow(RangeError);
    expect(() => resample([{ t: iso('2024-01-03T23:00:00Z'), o: 1, h: 1, l: 1, c: 1 }], '4h', '1D')).toThrow(/aligned/);
  });
});

describe('resample invariants', () => {
  const tfs: Timeframe[] = ['15m', '30m', '1h', '4h', '1D'];
  for (const tf of tfs) {
    it(`5m -> ${tf}: volume sum, OHLC consistency, bar counts, ordering`, () => {
      const src = ref.resample_input;
      const out = resample(src, '5m', tf);
      expect(out.reduce((a, c) => a + c.barCount, 0)).toBe(src.length);
      expect(out.reduce((a, c) => a + (c.v ?? 0), 0)).toBe(src.reduce((a, b) => a + b.v, 0));
      expect(Math.max(...out.map((c) => c.h))).toBe(Math.max(...src.map((b) => b.h)));
      expect(Math.min(...out.map((c) => c.l))).toBe(Math.min(...src.map((b) => b.l)));
      out.forEach((c, i) => {
        expect(c.end).toBeGreaterThan(c.t);
        expect(c.h).toBeGreaterThanOrEqual(Math.max(c.o, c.c));
        expect(c.l).toBeLessThanOrEqual(Math.min(c.o, c.c));
        expect(c.barCount).toBeLessThanOrEqual(c.expectedBars);
        if (i > 0) expect(c.t).toBeGreaterThanOrEqual(out[i - 1]!.end);
      });
    });
  }

  const bar = (t: number, o: number, h: number, l: number, c: number, v?: number): Bar =>
    v === undefined ? { t, o, h, l, c } : { t, o, h, l, c, v };

  it('accepts ISO strings; absent volume stays absent; empty input gives empty output', () => {
    const out = resample(
      [
        bar(Date.parse('2024-01-03T00:00:00Z'), 1, 2, 0.5, 1.5),
        { t: '2024-01-03T00:01:00Z', o: 1.5, h: 3, l: 1, c: 2 },
      ],
      '1m',
      '15m',
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ o: 1, h: 3, l: 0.5, c: 2, barCount: 2, expectedBars: 15 });
    expect('v' in out[0]!).toBe(false);
    expect(resample([], '1m', '1h')).toEqual([]);
  });

  it('partial flag: only the last candle, only when the source does not reach the bucket end', () => {
    const t0 = Date.parse('2024-01-03T00:00:00Z');
    const mk = (n: number): Bar[] => Array.from({ length: n }, (_, i) => bar(t0 + i * 300_000, 1, 1, 1, 1, 1));
    expect(resample(mk(3), '5m', '15m').map((c) => c.partial)).toEqual([false]);
    expect(resample(mk(4), '5m', '15m').map((c) => c.partial)).toEqual([false, true]);
    expect(resample(mk(5), '5m', '15m').map((c) => c.partial)).toEqual([false, true]);
    expect(resample(mk(6), '5m', '15m').map((c) => c.partial)).toEqual([false, false]);
    // NY17 daily: data ends before the FX day ends
    const start = iso('2024-01-03T22:00:00Z');
    const hrs = (n: number): Bar[] => Array.from({ length: n }, (_, i) => bar(start + i * 3_600_000, 1, 1, 1, 1));
    expect(resample(hrs(24), '1h', '1D').map((c) => c.partial)).toEqual([false]);
    expect(resample(hrs(23), '1h', '1D').map((c) => c.partial)).toEqual([true]);
  });

  it('gaps: missing buckets are skipped, missing bars show in barCount', () => {
    const t0 = Date.parse('2024-01-03T00:00:00Z');
    const out = resample(
      [bar(t0, 1, 1, 1, 1), bar(t0 + 900_000, 2, 2, 2, 2), bar(t0 + 3 * 3_600_000, 3, 3, 3, 3)],
      '15m',
      '1h',
    );
    expect(out.map((c) => [c.t - t0, c.barCount, c.expectedBars])).toEqual([
      [0, 2, 4],
      [3 * 3_600_000, 1, 4],
    ]);
  });

  it('UTC convention: Sunday 22:00Z open forms a Sunday candle; Saturday has none', () => {
    const fri = Date.parse('2024-01-05T21:00:00Z');
    const sun = Date.parse('2024-01-07T22:00:00Z');
    const out = resample(
      [bar(fri, 1, 1, 1, 1), bar(fri + 3_600_000, 2, 2, 2, 2), bar(sun, 3, 3, 3, 3), bar(sun + 3_600_000, 4, 4, 4, 4)],
      '1h',
      '1D',
      { convention: 'utc' },
    );
    expect(out.map((c) => new Date(c.t).toISOString().slice(0, 10))).toEqual(['2024-01-05', '2024-01-07']);
  });

  it('NY17: Friday 16:00 NY stays in the Friday FX day; Sunday 17:00 NY opens the Monday daily bar', () => {
    const fri = Date.parse('2024-01-05T21:00:00Z'); // Fri 16:00 EST
    const sun = Date.parse('2024-01-07T22:00:00Z'); // Sun 17:00 EST
    const out = resample([bar(fri, 1, 1, 1, 1), bar(sun, 3, 3, 3, 3), bar(sun + 3_600_000, 4, 4, 4, 4)], '1h', '1D');
    expect(out.map((c) => [new Date(c.t).toISOString(), c.barCount])).toEqual([
      ['2024-01-04T22:00:00.000Z', 1],
      ['2024-01-07T22:00:00.000Z', 2],
    ]);
  });

  it('UTC convention anchorOffsetMs shifts the day boundary', () => {
    const h = 3_600_000;
    const day = Date.parse('2024-01-03T00:00:00Z');
    const out = resample(
      [bar(day + 21 * h, 1, 1, 1, 1), bar(day + 22 * h, 2, 2, 2, 2), bar(day + 23 * h, 3, 3, 3, 3)],
      '1h',
      '1D',
      { convention: 'utc', anchorOffsetMs: 22 * h },
    );
    expect(out.map((c) => [c.t - day, c.barCount])).toEqual([
      [-2 * h, 1],
      [22 * h, 2],
    ]);
  });

  it('rejects bad input', () => {
    expect(() => resample([], '1h', '15m')).toThrow(RangeError);
    expect(() => resample([], '15m', '1h')).not.toThrow();
    expect(() => resample([bar(1, 1, 1, 1, 1)], '1m', '5m')).toThrow(/aligned/);
    expect(() => resample([bar(0, 1, 1, 1, 1), bar(0, 1, 1, 1, 1)], '1m', '5m')).toThrow(/increasing/);
    expect(() => resample([{ t: 'nope', o: 1, h: 1, l: 1, c: 1 }], '1m', '5m')).toThrow(RangeError);
    expect(TIMEFRAME_MS['4h']).toBe(14_400_000);
  });
});
