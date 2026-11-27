/** Median of a non-empty list (even length: mean of the two middle values), like Python's statistics.median. */
export function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Round half away from zero to `decimals` places (for response values only; the classifier never rounds). */
export function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  const scaled = Math.abs(value) * factor;
  const rounded = Math.round(scaled + Number.EPSILON * scaled) / factor;
  return value < 0 ? -rounded : rounded;
}
