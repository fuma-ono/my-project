import type { SupabaseClient } from '@supabase/supabase-js';
import type { BarQuery, BarSource, CanonicalBar } from '../domain/technical/barSource.js';
import type { Timeframe } from '../domain/technical/resample.js';
import { TWELVEDATA_FREE_INTERNAL_SOURCE_ID } from '../domain/technical/rightsRegistry.js';

/**
 * Engine timeframe -> fx_prices.timeframe. The engine says '1h', the DB stores '60m'. 4h / 1D are NOT
 * stored yet (the DB CHECK allows 1m/5m/15m/30m/60m only), so they are intentionally absent: callers
 * resample them from '1h' with the NY17 resampler.
 */
export const STORED_TIMEFRAME: Partial<Record<Timeframe, string>> = {
  '5m': '5m',
  '15m': '15m',
  '30m': '30m',
  '1h': '60m',
};

/** PostgREST returns at most 1000 rows per request by default; page below that. */
const PAGE_SIZE = 1000;

/**
 * Supabase-backed BarSource over fx_prices. BarQuery.pair is the fx_pairs.id (uuid) here.
 *
 * Reads the NEWEST rows in [fromMs, toMs) (newest first, then reversed), at most `maxRows` per request
 * (the technical row cap, so a request can never scan the whole table). `truncated` is true when the cap
 * stopped the read before reaching fromMs. Rows with verification_status = 'UNVERIFIED' are skipped
 * like everywhere else (treated as missing, never interpolated). Gaps are never filled.
 */
export class SupabaseBarSource implements BarSource {
  readonly id = TWELVEDATA_FREE_INTERNAL_SOURCE_ID;
  truncated = false;
  rowsRead = 0;

  constructor(
    private readonly supabase: SupabaseClient,
    private readonly maxRows: number,
  ) {}

  async fetchBars(query: BarQuery): Promise<readonly CanonicalBar[]> {
    const stored = STORED_TIMEFRAME[query.timeframe];
    if (stored === undefined) throw new RangeError(`timeframe ${query.timeframe} is not stored; resample it`);
    const rows: Record<string, unknown>[] = [];
    let offset = 0;
    this.truncated = false;
    while (offset < this.maxRows) {
      const size = Math.min(PAGE_SIZE, this.maxRows - offset);
      const { data, error } = await this.supabase
        .from('fx_prices')
        .select('timestamp, open, high, low, close')
        .eq('fx_pair_id', query.pair)
        .eq('timeframe', stored)
        .neq('verification_status', 'UNVERIFIED')
        .gte('timestamp', new Date(query.fromMs).toISOString())
        .lt('timestamp', new Date(query.toMs).toISOString())
        .order('timestamp', { ascending: false })
        .range(offset, offset + size - 1);
      if (error) throw error;
      const page = (data ?? []) as Record<string, unknown>[];
      rows.push(...page);
      offset += page.length;
      if (page.length < size) break;
      if (offset >= this.maxRows) this.truncated = true;
    }
    this.rowsRead = rows.length;
    const bars: CanonicalBar[] = [];
    for (const r of rows.reverse()) {
      const bar = {
        t: Date.parse(String(r.timestamp)),
        o: Number(r.open),
        h: Number(r.high),
        l: Number(r.low),
        c: Number(r.close),
      };
      if ([bar.t, bar.o, bar.h, bar.l, bar.c].every((x) => Number.isFinite(x))) bars.push(bar);
    }
    return bars;
  }
}
