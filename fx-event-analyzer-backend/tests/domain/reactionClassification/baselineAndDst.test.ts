import { describe, expect, it } from 'vitest';
import {
  type BarCloses,
  computeBaseline,
  minuteIndexOf,
  nySessionMinutes,
  requiredMinuteRanges,
} from '../../../src/domain/reactionClassification/baseline.js';
import { dstMismatchCaution } from '../../../src/domain/reactionClassification/dstCaution.js';
import { nyWall, nyWallToUtcMs, wallClockIn } from '../../../src/domain/reactionClassification/nyClock.js';
import { RX_V1 } from '../../../src/domain/reactionClassification/params.js';

/** NY-clock baseline sessions across DST changes, no look-ahead, and the US/EU DST-mismatch caution (synthetic only). */
const MIN = 60_000;
const utc = (iso: string) => Date.parse(iso);
const tMinOf = (iso: string) => minuteIndexOf(utc(iso));

function sessionsFor(iso: string) {
  const t = tMinOf(iso);
  const ses = nySessionMinutes(t, RX_V1);
  const clock = nyWall(t * MIN);
  return { t, ses, clock };
}

describe('nyWallToUtcMs', () => {
  it('resolves ordinary, EDT and EST wall times', () => {
    expect(nyWallToUtcMs({ y: 2026, m: 7, d: 1, h: 8, mi: 30 })).toBe(utc('2026-07-01T12:30:00Z'));
    expect(nyWallToUtcMs({ y: 2026, m: 12, d: 1, h: 8, mi: 30 })).toBe(utc('2026-12-01T13:30:00Z'));
  });
  it('skips a nonexistent (spring-forward) and an ambiguous (fall-back) local time', () => {
    expect(nyWallToUtcMs({ y: 2026, m: 3, d: 8, h: 2, mi: 30 })).toBeNull(); // 02:00-03:00 does not exist on 2026-03-08
    expect(nyWallToUtcMs({ y: 2026, m: 11, d: 1, h: 1, mi: 30 })).toBeNull(); // 01:00-02:00 happens twice on 2026-11-01
    expect(nyWallToUtcMs({ y: 2026, m: 11, d: 1, h: 3, mi: 0 })).toBe(utc('2026-11-01T08:00:00Z'));
  });
});

describe('same NY wall time, weekdays only, across DST', () => {
  const cases: [string, string][] = [
    ['2026-11-06T13:30:00Z', 'US event after US fall-back (Nov 1)'],
    ['2026-11-03T13:30:00Z', 'US event 2 days after US fall-back'],
    ['2026-03-10T12:30:00Z', 'US event after US spring-forward (Mar 8)'],
    ['2026-03-18T12:30:00Z', 'US/EU mismatch week, US event'],
    ['2026-03-18T07:00:00Z', 'UK 07:00 in the mismatch week'],
    ['2026-10-28T07:00:00Z', 'mismatch week in October'],
    ['2026-11-20T07:00:00Z', '3 weeks after both changes'],
    ['2026-03-09T07:30:00Z', 'Monday 03:30 EDT after spring-forward'],
    ['2026-11-02T06:30:00Z', 'Monday 01:30 EST after fall-back'],
    ['2027-01-04T13:30:00Z', 'across the year boundary'],
  ];
  it.each(cases)('%s (%s)', (iso) => {
    const { ses, clock } = sessionsFor(iso);
    expect(ses.length).toBeGreaterThan(0);
    for (const s of ses) {
      const w = nyWall(s * MIN);
      expect([w.h, w.mi]).toEqual([clock.h, clock.mi]);
      const weekday = new Date(Date.UTC(w.y, w.m - 1, w.d)).getUTCDay();
      expect(weekday).not.toBe(0);
      expect(weekday).not.toBe(6);
      expect(s).toBeLessThan(tMinOf(iso));
    }
    // nearest first and strictly decreasing
    expect([...ses].sort((a, b) => b - a)).toEqual(ses);
  });

  it('the UTC time of the sessions moves by one hour across the US change while the NY clock does not', () => {
    const { ses } = sessionsFor('2026-11-06T13:30:00Z');
    const utcClocks = new Set(ses.map((s) => new Date(s * MIN).toISOString().slice(11, 16)));
    expect(utcClocks).toEqual(new Set(['13:30', '12:30']));
  });

  it('a UK 07:00 release shows London-clock mismatches in the mismatch week and only a few (or none) weeks later', () => {
    const mismatches = (iso: string) => {
      const { t, ses } = sessionsFor(iso);
      const lon = wallClockIn(t * MIN, 'Europe/London');
      return ses.filter((s) => wallClockIn(s * MIN, 'Europe/London') !== lon).length;
    };
    expect(mismatches('2026-10-28T07:00:00Z')).toBeGreaterThan(0);
    // 21 days back from Nov 20 still reaches Oct 30 (US EDT, UK GMT): one session differs; well after both changes none do
    expect(mismatches('2026-11-20T07:00:00Z')).toBe(1);
    expect(mismatches('2026-12-02T07:00:00Z')).toBe(0);
  });
});

describe('computeBaseline', () => {
  /** Quiet synthetic closes for every minute of the given hours around many days (a flat 100 with +-0.01 alternation). */
  function bars(fromMs: number, toMs: number, step = 0.01): Map<number, number> {
    const m = new Map<number, number>();
    for (let t = minuteIndexOf(fromMs); t < minuteIndexOf(toMs); t++) m.set(t, 100 + (t % 2) * step);
    return m;
  }
  const T = tMinOf('2026-11-06T13:30:00Z');
  const FROM = utc('2026-10-10T00:00:00Z');
  const TO = utc('2026-11-06T16:00:00Z');

  it('uses the larger of own and typical sigma and counts the sessions', () => {
    const b = computeBaseline(bars(FROM, TO), T, RX_V1);
    expect(b.source).toBe('MAX_OWN_TYPICAL');
    expect(b.sessionsUsed).toBe(RX_V1.baseline.typical_max_sessions);
    expect(b.sigma).toBeCloseTo(0.01, 12);
    const louder = bars(FROM, TO);
    for (let t = T - 40; t < T; t++) louder.set(t, 100 + (t % 2) * 0.05); // noisier own window
    const noisy = computeBaseline(louder, T, RX_V1);
    expect(noisy.own!).toBeGreaterThan(noisy.typical!);
    expect(noisy.sigma).toBe(noisy.own);
  });

  it('does not look ahead: bars at or after T never change sigma', () => {
    const base = bars(FROM, TO);
    const altered = new Map(base);
    for (let t = T; t < T + 200; t++) altered.set(t, 500 + (t % 7));
    expect(computeBaseline(altered, T, RX_V1)).toEqual(computeBaseline(base, T, RX_V1));
  });

  it('own only when typical sessions are lacking, none when the own window is lacking', () => {
    const recentOnly = bars(utc('2026-11-05T00:00:00Z'), TO);
    expect(computeBaseline(recentOnly, T, RX_V1)).toMatchObject({ source: 'OWN_ONLY', typical: null });
    const noOwn = bars(FROM, TO);
    for (let t = T - 61; t < T; t++) noOwn.delete(t);
    expect(computeBaseline(noOwn, T, RX_V1)).toMatchObject({ source: 'NONE', sigma: null, own: null });
  });

  it('missing bars are never filled: a window with too few valid changes is unusable', () => {
    const sparse: BarCloses = (() => {
      const m = bars(FROM, TO);
      for (let t = T - 61; t < T; t += 2) m.delete(t); // every other bar missing: no consecutive pair
      return m;
    })();
    expect(computeBaseline(sparse, T, RX_V1).own).toBeNull();
  });
});

describe('requiredMinuteRanges', () => {
  it('asks for the path, the own window and every candidate session window, merged, and nothing else', () => {
    const T = tMinOf('2026-11-06T13:30:00Z');
    const ranges = requiredMinuteRanges(T, RX_V1, 60);
    const inRange = (m: number) => ranges.some((r) => m >= r.from && m < r.to);
    expect(inRange(T - 1)).toBe(true); // c_0
    expect(inRange(T + 59)).toBe(true); // the bar of c_60
    expect(inRange(T + 60)).toBe(false);
    expect(inRange(T - 61)).toBe(true); // the bar before the first change of the own window
    expect(inRange(T - 62)).toBe(false);
    for (const s of nySessionMinutes(T, RX_V1)) {
      expect(inRange(s - 1)).toBe(true);
      expect(inRange(s - 61)).toBe(true);
    }
    const total = ranges.reduce((acc, r) => acc + (r.to - r.from), 0);
    expect(total).toBeLessThan(1500); // about 700 bars per event, not 21 days of minutes
    for (let i = 1; i < ranges.length; i++) expect(ranges[i]!.from).toBeGreaterThan(ranges[i - 1]!.to);
  });
});

describe('dst_mismatch_caution', () => {
  const at = (iso: string) => dstMismatchCaution(utc(iso));
  it('2026 periods: 03-08 to 03-29 and 10-25 to 11-01', () => {
    expect(at('2026-03-18T12:30:00Z')).toEqual({
      active: true,
      reason: 'US_EU_DST_TRANSITION_DATES_DIFFER',
      from_date: '2026-03-08',
      to_date: '2026-03-29',
    });
    expect(at('2026-10-28T18:00:00Z')).toEqual({
      active: true,
      reason: 'US_EU_DST_TRANSITION_DATES_DIFFER',
      from_date: '2026-10-25',
      to_date: '2026-11-01',
    });
  });
  it('2027 periods: 03-14 to 03-28 and 10-31 to 11-07', () => {
    expect(at('2027-03-20T12:30:00Z')).toMatchObject({ active: true, from_date: '2027-03-14', to_date: '2027-03-28' });
    expect(at('2027-11-03T13:30:00Z')).toMatchObject({ active: true, from_date: '2027-10-31', to_date: '2027-11-07' });
  });
  it('from is inclusive and to is exclusive (by UTC date)', () => {
    expect(at('2026-03-08T00:00:00Z').active).toBe(true);
    expect(at('2026-03-07T23:59:59Z').active).toBe(false);
    expect(at('2026-03-28T23:59:59Z').active).toBe(true);
    expect(at('2026-03-29T00:00:00Z').active).toBe(false);
    expect(at('2026-10-24T23:59:59Z').active).toBe(false);
    expect(at('2026-10-25T00:00:00Z').active).toBe(true);
    expect(at('2026-10-31T23:59:59Z').active).toBe(true);
    expect(at('2026-11-01T00:00:00Z').active).toBe(false);
  });
  it('is inactive outside the mismatch weeks, including the new-year week, and carries no extra keys', () => {
    expect(at('2026-07-15T12:30:00Z')).toEqual({ active: false });
    expect(at('2026-12-31T23:00:00Z')).toEqual({ active: false });
    expect(at('2027-01-01T00:30:00Z')).toEqual({ active: false });
  });
});
