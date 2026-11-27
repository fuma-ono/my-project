import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { analyzeEvent } from '../../../src/domain/reactionClassification/analyze.js';
import {
  type BarCloses,
  computeBaseline,
  nySessionMinutes,
} from '../../../src/domain/reactionClassification/baseline.js';
import { classifyWindow, pathCloses } from '../../../src/domain/reactionClassification/classify.js';
import { deriveParams, type ParamOverrides, RX_V1 } from '../../../src/domain/reactionClassification/params.js';

/**
 * TypeScript vs the Python reference (scripts/reaction_reference_clf2.py, an unmodified copy of the analysis
 * reference). The vectors are SYNTHETIC and deterministic (scripts/generate_reaction_fixtures.py, fixed seeds); no real
 * market data is involved. Labels / reasons must be identical and every number must agree within 1e-9 (relative).
 */
interface WindowRecord {
  label: string;
  reason: string | null;
  z0?: number;
  M?: number;
  F?: number;
  Rmax?: number;
  Rf?: number;
  Fz?: number;
  S0?: number;
  Sn?: number;
  borderline?: boolean;
}
interface ClassifyCase {
  id: string;
  closes: (number | null)[];
  sigma: number | null;
  time_exact: boolean;
  expected: Record<string, Record<string, WindowRecord>>;
}
interface BaselineCase {
  id: string;
  release_utc: string;
  t_min: number;
  bars: [number, number][];
  sessions: number[];
  expected_baseline: {
    sigma: number | null;
    own: number | null;
    typical: number | null;
    source: string;
    sessions_used: number;
    clock_mismatch_sessions: number;
  };
  expected_windows: Record<string, WindowRecord>;
}
interface Fixture {
  param_variants: Record<string, Record<string, unknown>>;
  classify_cases: ClassifyCase[];
  baseline_cases: BaselineCase[];
}

const fixture = JSON.parse(
  readFileSync(new URL('../../fixtures/reaction-analysis/cross_impl.json', import.meta.url), 'utf8'),
) as Fixture;

const close = (actual: number | undefined, expected: number | undefined, label: string) => {
  expect(actual, label).toBeDefined();
  const tolerance = 1e-9 * Math.max(1, Math.abs(expected!));
  expect(Math.abs(actual! - expected!), `${label}: ${actual} vs ${expected}`).toBeLessThanOrEqual(tolerance);
};

function compareWindow(actual: ReturnType<typeof classifyWindow>, expected: WindowRecord, where: string) {
  expect(actual.label, `${where} label`).toBe(expected.label);
  expect(actual.reason, `${where} reason`).toBe(expected.reason);
  for (const [tsKey, pyKey] of [
    ['z0', 'z0'],
    ['M', 'M'],
    ['F', 'F'],
    ['Rmax', 'Rmax'],
    ['Rf', 'Rf'],
    ['Fz', 'Fz'],
    ['S0', 'S0'],
    ['Sn', 'Sn'],
  ] as const) {
    if (expected[pyKey] === undefined) expect(actual[tsKey], `${where} ${tsKey} absent`).toBeUndefined();
    else close(actual[tsKey], expected[pyKey], `${where} ${tsKey}`);
  }
  expect(actual.borderline, `${where} borderline`).toBe(expected.borderline);
}

function paramsFor(name: string) {
  return deriveParams(RX_V1, fixture.param_variants[name] as ParamOverrides);
}

describe('TypeScript classifier == Python reference on synthetic series', () => {
  it('the fixture covers every label and several failure reasons', () => {
    const labels = new Set<string>();
    const reasons = new Set<string>();
    for (const c of fixture.classify_cases) {
      for (const w of Object.values(c.expected['rx-v1']!)) {
        labels.add(w.label);
        if (w.reason) reasons.add(w.reason);
      }
    }
    expect([...labels].sort()).toEqual(['CONTINUATION', 'FULL_RETRACE', 'PULLBACK', 'REVERSAL', 'UNDETERMINED']);
    for (const r of [
      'MISSING_BARS',
      'NO_PRICE_DATA',
      'BASELINE_UNAVAILABLE',
      'RELEASE_TIME_NOT_EXACT',
      'NO_INITIAL_MOVE',
      'SMALL_INITIAL',
      'WINDOW_TOO_SHORT',
    ]) {
      expect(reasons.has(r), r).toBe(true);
    }
    expect(fixture.classify_cases.length).toBeGreaterThanOrEqual(100);
  });

  for (const variant of ['rx-v1', 'w0-3', 'k24-rho05']) {
    it(`every case and window agrees (parameter set ${variant})`, () => {
      const params = paramsFor(variant);
      let compared = 0;
      for (const c of fixture.classify_cases) {
        for (const [minutes, expected] of Object.entries(c.expected[variant]!)) {
          const actual = classifyWindow(c.closes, c.sigma, Number(minutes), params, c.time_exact);
          compareWindow(actual, expected, `${c.id} ${variant} window ${minutes}`);
          compared += 1;
        }
      }
      expect(compared).toBe(fixture.classify_cases.length * 5);
    });
  }

  it('changed parameters really change some labels (the variants are not vacuous)', () => {
    const changed = fixture.classify_cases.filter((c) =>
      Object.keys(c.expected['rx-v1']!).some((n) => c.expected['rx-v1']![n]!.label !== c.expected['w0-3']![n]!.label),
    );
    expect(changed.length).toBeGreaterThan(0);
  });
});

describe('TypeScript baseline (NY clock) == Python reference on synthetic 1-minute bars', () => {
  it('covers the DST scenarios', () => {
    const ids = fixture.baseline_cases.map((b) => b.id);
    for (const id of [
      'us-after-fall-back',
      'us-after-spring-forward',
      'us-mismatch-week-us-event',
      'uk-0700-mismatch-week-oct',
      'monday-after-spring-forward-0330',
      'monday-after-fall-back-0130',
      'with-3pct-missing-bars',
      'typical-sessions-unavailable',
      'own-window-unavailable',
    ]) {
      expect(ids, id).toContain(id);
    }
  });

  for (const c of fixture.baseline_cases) {
    it(`${c.id}: sessions, sigma, source, window labels`, () => {
      const bars: BarCloses = new Map(c.bars);
      expect(nySessionMinutes(c.t_min, RX_V1)).toEqual(c.sessions);
      const base = computeBaseline(bars, c.t_min, RX_V1);
      const e = c.expected_baseline;
      expect(base.source).toBe(e.source);
      expect(base.sessionsUsed).toBe(e.sessions_used);
      expect(base.clockMismatchSessions).toBe(e.clock_mismatch_sessions);
      for (const key of ['sigma', 'own', 'typical'] as const) {
        if (e[key] === null) expect(base[key], key).toBeNull();
        else close(base[key] ?? undefined, e[key], key);
      }
      const path = pathCloses(bars, c.t_min, 60);
      for (const [minutes, expected] of Object.entries(c.expected_windows)) {
        compareWindow(classifyWindow(path, base.sigma, Number(minutes), RX_V1, true), expected, `${c.id} ${minutes}`);
      }
      // The orchestrated analysis (statuses) agrees with the direct classification for the classified windows.
      const analysis = analyzeEvent({
        releaseMs: c.t_min * 60_000,
        timeExact: true,
        bars,
        params: RX_V1,
        pipSize: 0.01,
      });
      for (const w of analysis.windows) {
        const expected = c.expected_windows[String(w.minutes)]!;
        if (RX_V1.classified_windows.includes(w.minutes)) {
          expect(w.label, `${c.id} analysis ${w.minutes}`).toBe(expected.label);
        } else {
          expect(w.classification_status).toBe('REFERENCE_ONLY');
          expect(w.label).toBeNull();
        }
      }
    });
  }
});
