import { classifyWindow } from './classify.js';
import type { ReactionParams } from './params.js';

/**
 * Reclassification report: how the labels move between two parameter sets over the same fixed series (the TypeScript
 * counterpart of analysis/reclass_report.py). A parameter change is adopted only as a NEW set id after reading this
 * report; rx-v1 against rx-v1 must show zero change.
 *
 * Input series are fixed closes c_0..c_60 with the baseline sigma already computed (null = missing), so only
 * parameters that do not alter sigma can be compared; two sets with different `baseline` objects are rejected
 * instead of silently reusing the old sigma.
 */
export interface ReclassSeries {
  id: string;
  closes: readonly (number | null)[];
  sigma: number | null;
  /** Defaults to true. */
  time_exact?: boolean;
}

export const REPORT_CLASSES = [
  'CONTINUATION',
  'PULLBACK',
  'FULL_RETRACE',
  'REVERSAL',
  'UNDETERMINED',
  'REFERENCE_ONLY',
] as const;
export type ReportClass = (typeof REPORT_CLASSES)[number];

export interface WindowTransitions {
  minutes: number;
  countsA: Record<ReportClass, number>;
  countsB: Record<ReportClass, number>;
  /** matrix[from][to]: rows = set A, columns = set B. */
  matrix: Record<ReportClass, Record<ReportClass, number>>;
  changed: number;
  total: number;
  changedExamples: string[];
}

export interface ReclassReport {
  a: string;
  b: string;
  series: number;
  windows: WindowTransitions[];
}

const zeroRow = (): Record<ReportClass, number> => ({
  CONTINUATION: 0,
  PULLBACK: 0,
  FULL_RETRACE: 0,
  REVERSAL: 0,
  UNDETERMINED: 0,
  REFERENCE_ONLY: 0,
});

function classOf(series: ReclassSeries, minutes: number, params: ReactionParams): ReportClass {
  if (!params.classified_windows.includes(minutes)) return 'REFERENCE_ONLY';
  return classifyWindow(series.closes, series.sigma, minutes, params, series.time_exact !== false).label;
}

const EXAMPLES = 5;

export function reclassify(series: readonly ReclassSeries[], a: ReactionParams, b: ReactionParams): ReclassReport {
  if (JSON.stringify(a.baseline) !== JSON.stringify(b.baseline)) {
    throw new RangeError(
      'baseline parameters differ: sigma must be recomputed from 1-minute bars (not supported here)',
    );
  }
  const minutesList = [...new Set([...a.windows, ...b.windows])].sort((x, y) => x - y);
  const windows = minutesList.map((minutes): WindowTransitions => {
    const countsA = zeroRow();
    const countsB = zeroRow();
    const matrix = Object.fromEntries(REPORT_CLASSES.map((c) => [c, zeroRow()])) as Record<
      ReportClass,
      Record<ReportClass, number>
    >;
    const changedExamples: string[] = [];
    let changed = 0;
    for (const s of series) {
      const from = classOf(s, minutes, a);
      const to = classOf(s, minutes, b);
      countsA[from] += 1;
      countsB[to] += 1;
      matrix[from][to] += 1;
      if (from !== to) {
        changed += 1;
        if (changedExamples.length < EXAMPLES) changedExamples.push(s.id);
      }
    }
    return { minutes, countsA, countsB, matrix, changed, total: series.length, changedExamples };
  });
  return { a: a.param_set_id, b: b.param_set_id, series: series.length, windows };
}

/** Plain-text rendering (counts per class, transition matrix, changed share). */
export function formatReclassReport(report: ReclassReport): string {
  const lines = [`A = ${report.a}   B = ${report.b}   series = ${report.series}`];
  for (const w of report.windows) {
    lines.push('', `== window ${w.minutes} min ==`);
    lines.push(`counts A: ${JSON.stringify(w.countsA)}`, `counts B: ${JSON.stringify(w.countsB)}`);
    lines.push('transition matrix (rows = A, cols = B)');
    lines.push(`${''.padEnd(16)}${REPORT_CLASSES.map((c) => c.slice(0, 14).padStart(15)).join('')}`);
    for (const from of REPORT_CLASSES) {
      lines.push(
        `${from.slice(0, 15).padEnd(16)}${REPORT_CLASSES.map((to) => String(w.matrix[from][to]).padStart(15)).join('')}`,
      );
    }
    const share = w.total === 0 ? 0 : (100 * w.changed) / w.total;
    lines.push(`changed: ${w.changed} / ${w.total} (${share.toFixed(1)}%)`);
    if (w.changedExamples.length > 0) lines.push(`examples of changed series: ${w.changedExamples.join(', ')}`);
  }
  return `${lines.join('\n')}\n`;
}
