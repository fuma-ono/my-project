/** Input candle. `t` is an ISO-8601 string or epoch milliseconds (UTC). */
export interface Bar {
  t: string | number;
  o: number;
  h: number;
  l: number;
  c: number;
  v?: number;
}

/** Series aligned 1:1 with the input; `null` marks the warm-up region. */
export type Series = (number | null)[];

export function toEpochMs(t: string | number): number {
  const ms = typeof t === 'number' ? t : Date.parse(t);
  if (!Number.isFinite(ms)) {
    throw new RangeError(`invalid timestamp: ${String(t)}`);
  }
  return ms;
}

export function assertPeriod(n: number, name = 'period'): void {
  if (!Number.isInteger(n) || n < 1) {
    throw new RangeError(`${name} must be a positive integer, got ${n}`);
  }
}
