import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { deriveParams, RX_V1 } from '../../../src/domain/reactionClassification/params.js';
import {
  formatReclassReport,
  reclassify,
  type ReclassSeries,
} from '../../../src/domain/reactionClassification/reclassify.js';

const series = (
  JSON.parse(readFileSync(new URL('../../fixtures/reaction-analysis/cross_impl.json', import.meta.url), 'utf8')) as {
    classify_cases: ReclassSeries[];
  }
).classify_cases;

describe('reclassification report (synthetic series)', () => {
  it('rx-v1 against rx-v1: no label changes in any window', () => {
    const report = reclassify(series, RX_V1, RX_V1);
    expect(report.series).toBe(series.length);
    expect(report.windows.map((w) => w.minutes)).toEqual([1, 5, 15, 30, 60]);
    for (const w of report.windows) {
      expect(w.changed, `window ${w.minutes}`).toBe(0);
      expect(w.countsA).toEqual(w.countsB);
      for (const from of Object.keys(w.matrix) as (keyof typeof w.matrix)[]) {
        for (const to of Object.keys(w.matrix[from]) as (keyof typeof w.matrix)[]) {
          if (from !== to) expect(w.matrix[from][to]).toBe(0);
        }
      }
    }
  });

  it('1- and 5-minute windows are REFERENCE_ONLY under rx-v1 (no label counted)', () => {
    const report = reclassify(series, RX_V1, RX_V1);
    for (const w of report.windows.filter((x) => x.minutes <= 5)) {
      expect(w.countsA.REFERENCE_ONLY).toBe(series.length);
    }
    for (const w of report.windows.filter((x) => x.minutes > 5)) expect(w.countsA.REFERENCE_ONLY).toBe(0);
  });

  it('a set that also classifies the 5-minute window shows REFERENCE_ONLY -> label transitions only in that window', () => {
    const rx5 = deriveParams(RX_V1, { param_set_id: 'rx-draft-5', classified_windows: [5, 15, 30, 60] });
    const report = reclassify(series, RX_V1, rx5);
    const w5 = report.windows.find((w) => w.minutes === 5)!;
    expect(w5.changed).toBe(series.length);
    expect(w5.matrix.REFERENCE_ONLY.REFERENCE_ONLY).toBe(0);
    expect(w5.countsB.REFERENCE_ONLY).toBe(0);
    for (const w of report.windows.filter((x) => x.minutes !== 5)) expect(w.changed).toBe(0);
  });

  it('a changed parameter (w0 = 3) produces a transition matrix whose rows and columns add up', () => {
    const draft = deriveParams(RX_V1, { param_set_id: 'rx-draft-w0', w0: 3 });
    const report = reclassify(series, RX_V1, draft);
    const w60 = report.windows.find((w) => w.minutes === 60)!;
    expect(w60.changed).toBeGreaterThan(0);
    const total = Object.values(w60.matrix).reduce(
      (acc, row) => acc + Object.values(row).reduce((a, b) => a + b, 0),
      0,
    );
    expect(total).toBe(series.length);
    expect(w60.changedExamples.length).toBeGreaterThan(0);
    const text = formatReclassReport(report);
    expect(text).toContain('A = rx-v1   B = rx-draft-w0');
    expect(text).toContain('transition matrix (rows = A, cols = B)');
    expect(text).toMatch(/changed: \d+ \/ \d+ \(\d+\.\d%\)/);
  });

  it('refuses sets with a different baseline (sigma would have to be recomputed from bars)', () => {
    const other = deriveParams(RX_V1, { param_set_id: 'rx-draft-bl', baseline: { lookback_minutes: 30 } });
    expect(() => reclassify(series, RX_V1, other)).toThrow(RangeError);
  });
});
