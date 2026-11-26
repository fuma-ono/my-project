/**
 * Provider-agnostic input contract for the technical engine (owner decision 2026-11-25: the engine
 * must not depend on any data vendor, so the source can be swapped later).
 *
 * This file only declares types and a validator. There is intentionally NO implementation tied to
 * Twelve Data, Polygon/Massive or the database; adapters live elsewhere and implement BarSource.
 *
 * Canonical bar contract:
 *  - t = bar OPEN time, epoch milliseconds UTC; o/h/l/c finite numbers with l <= min(o,c) and
 *    h >= max(o,c); v optional (FX volume semantics are provider-dependent).
 *  - Bars are strictly ascending by t with no duplicates; gaps are allowed and are never filled.
 *  - A query range is half-open [fromMs, toMs). The source returns only completed or in-progress
 *    bars it actually has; it must not fabricate bars.
 */
import type { Timeframe } from './resample.js';

export interface CanonicalBar {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v?: number;
}

export interface BarQuery {
  /** Pair code such as 'USDJPY' (naming is the adapter's concern). */
  pair: string;
  timeframe: Timeframe;
  fromMs: number;
  toMs: number;
}

export interface BarSource {
  /** Stable id, referenced by the rights ledger (RightsLedgerEntry.sourceId). */
  readonly id: string;
  fetchBars(query: BarQuery): Promise<readonly CanonicalBar[]>;
}

/** Returns human-readable problems; an empty array means the series satisfies the contract. */
export function validateCanonicalBars(bars: readonly CanonicalBar[]): string[] {
  const problems: string[] = [];
  bars.forEach((b, i) => {
    if (![b.t, b.o, b.h, b.l, b.c].every((x) => Number.isFinite(x))) {
      problems.push(`index ${i}: non-finite value`);
      return;
    }
    if (b.h < Math.max(b.o, b.c) || b.l > Math.min(b.o, b.c) || b.h < b.l) {
      problems.push(`index ${i}: inconsistent OHLC`);
    }
    if (b.v !== undefined && !(Number.isFinite(b.v) && b.v >= 0)) {
      problems.push(`index ${i}: invalid volume`);
    }
    const prev = bars[i - 1];
    if (prev && !(b.t > prev.t)) problems.push(`index ${i}: not strictly ascending`);
  });
  return problems;
}
