/**
 * Walk-forward splitter (index based, chronological only; random splits are forbidden).
 *
 * A window is [train][purge][valid][embargo][test]. Segments are half-open index ranges.
 *  - purge: bars removed between the end of train and the start of valid (and between valid and
 *    test), so labels/holding periods of the earlier segment cannot overlap the later one.
 *  - embargo: extra bars skipped after valid before test (serial-correlation buffer).
 *  - eventGuardBars: if an event (index in `eventIndices`) lies within the last `eventGuardBars`
 *    bars before a segment boundary, the earlier segment is truncated to end at that event, because
 *    its reaction would otherwise straddle the boundary.
 *  - mode 'rolling' keeps train length fixed; 'expanding' always starts train at `startIndex`.
 *  - Successive windows advance by `step` (default = testSize, so test segments do not overlap).
 */
export interface WalkForwardOptions {
  totalBars: number;
  trainSize: number;
  validSize: number;
  testSize: number;
  step?: number;
  purge?: number;
  embargo?: number;
  mode?: 'rolling' | 'expanding';
  startIndex?: number;
  eventIndices?: readonly number[];
  eventGuardBars?: number;
}

export interface Segment {
  start: number;
  /** Exclusive. */
  end: number;
}

export interface WalkForwardWindow {
  index: number;
  train: Segment;
  valid: Segment;
  test: Segment;
}

export function walkForwardWindows(o: WalkForwardOptions): WalkForwardWindow[] {
  const { totalBars, trainSize, validSize, testSize } = o;
  const purge = o.purge ?? 0;
  const embargo = o.embargo ?? 0;
  const step = o.step ?? testSize;
  const base = o.startIndex ?? 0;
  const guard = o.eventGuardBars ?? 0;
  const events = [...(o.eventIndices ?? [])].sort((a, b) => a - b);
  for (const [k, v] of Object.entries({ trainSize, validSize, testSize, step })) {
    if (!Number.isInteger(v) || v < 1) throw new RangeError(`${k} must be a positive integer`);
  }
  if (purge < 0 || embargo < 0) throw new RangeError('purge/embargo must be >= 0');

  /** Truncate `seg` (ending at `boundary`) so a straddling event reaction cannot cross the boundary. */
  const trimEnd = (seg: Segment, boundary: number): Segment => {
    if (guard <= 0) return seg;
    const e = events.find((x) => x >= boundary - guard && x < boundary && x > seg.start);
    return e === undefined ? seg : { start: seg.start, end: Math.min(seg.end, e) };
  };

  const out: WalkForwardWindow[] = [];
  for (let k = 0; ; k++) {
    const shift = k * step;
    const trainStart = o.mode === 'expanding' ? base : base + shift;
    const trainEnd = base + shift + trainSize;
    const validStart = trainEnd + purge;
    const validEnd = validStart + validSize;
    const testStart = validEnd + purge + embargo;
    const testEnd = testStart + testSize;
    if (testEnd > totalBars) break;
    out.push({
      index: k,
      train: trimEnd({ start: trainStart, end: trainEnd }, validStart),
      valid: trimEnd({ start: validStart, end: validEnd }, testStart),
      test: { start: testStart, end: testEnd },
    });
  }
  return out;
}
