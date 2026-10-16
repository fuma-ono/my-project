/**
 * ③ (+ optional ⑤) 1-minute FX candles → fx_prices, upsert keyed by
 * (fx_pair_id, timeframe, timestamp = candle OPEN time). Gaps are
 * never filled; see validation/fxCandles.ts for the checks.
 *
 * 5m/15m/30m/60m are built here from the same accepted 1m candles (not
 * fetched separately): every timeframe then agrees with the 1m data the
 * reactions are computed from, and it costs no extra provider requests.
 */
import { INGESTION_SETTINGS } from '../config.js';
import { findFxPairMapping } from '../mappings/fxPairs.js';
import type { FxPriceProvider } from '../providers.js';
import type { JobCounters } from '../runner.js';
import type { IngestionStore } from '../store.js';
import type { FxPriceRow } from '../store.js';
import type { InstantRange } from '../types.js';
import { checkCandles } from '../validation/fxCandles.js';

export interface FxPipelineDeps {
  store: IngestionStore;
  primary: FxPriceProvider;
  secondary?: FxPriceProvider;
  now?: () => Date;
}

export async function ingestFxCandles(
  deps: FxPipelineDeps,
  symbols: readonly string[],
  range: InstantRange,
  counters: JobCounters,
): Promise<void> {
  const now = (deps.now ?? (() => new Date()))();
  const pairs = new Map((await deps.store.listFxPairs()).map((pair) => [pair.symbol, pair]));

  for (const symbol of symbols) {
    const mapping = findFxPairMapping(symbol);
    const pair = pairs.get(symbol);
    if (!mapping || !pair) {
      counters.skip('PAIR_NOT_MAPPED');
      continue;
    }
    if (Number(pair.pip_size) !== mapping.pipSize || Number(pair.price_precision) !== mapping.pricePrecision) {
      counters.error(`${symbol}: fx_pairs pip_size/price_precision differ from mappings/fxPairs.ts — not ingested`);
      continue;
    }
    try {
      const primary = await deps.primary.fetchOneMinuteCandles(symbol, range);
      counters.fetched += primary.length;
      let secondary;
      if (deps.secondary) {
        try {
          secondary = await deps.secondary.fetchOneMinuteCandles(symbol, range);
        } catch (error) {
          // The cross-check is optional: without it candles are SINGLE_SOURCE, not dropped.
          counters.note('secondary_errors', `${symbol}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      const checked = checkCandles(primary, {
        pipSize: mapping.pipSize,
        now,
        maxJumpPips: INGESTION_SETTINGS.fxMaxJumpPips,
        maxDiffPips: INGESTION_SETTINGS.fxCrossCheckMaxDiffPips,
        ...(secondary ? { secondary } : {}),
      });
      for (const { reason } of checked.rejected) counters.skip(`CANDLE_${reason}`);
      const unverified = checked.accepted.filter((c) => c.verificationStatus === 'UNVERIFIED');
      counters.review += unverified.length;
      for (const c of unverified.slice(0, 20)) {
        counters.note('unverified_minutes', {
          symbol,
          minute: c.candle.openTime,
          diff_pips: c.crossCheckDiffPips,
          notes: c.notes,
        });
      }
      if (checked.accepted.length === 0) continue;
      const minuteRows: FxPriceRow[] = checked.accepted.map((c) => ({
        fx_pair_id: pair.id,
        timestamp: new Date(c.candle.openTime).toISOString(),
        timeframe: '1m',
        open: c.candle.open,
        high: c.candle.high,
        low: c.candle.low,
        close: c.candle.close,
        volume: c.candle.volume,
        source: c.candle.provider,
        verification_status: c.verificationStatus,
        cross_check_source: c.crossCheckClose === null ? null : (deps.secondary?.name ?? null),
        cross_check_close: c.crossCheckClose,
        cross_check_diff_pips: c.crossCheckDiffPips,
      }));
      const aggregated = AGGREGATED_TIMEFRAMES.flatMap(({ timeframe, minutes }) =>
        aggregateMinuteRows(minuteRows, timeframe, minutes, now),
      );
      counters.note('aggregated_candles', { symbol, count: aggregated.length });
      counters.success += await deps.store.upsertFxPrices([...minuteRows, ...aggregated]);
    } catch (error) {
      counters.error(`${symbol}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

export const AGGREGATED_TIMEFRAMES = [
  { timeframe: '5m', minutes: 5 },
  { timeframe: '15m', minutes: 15 },
  { timeframe: '30m', minutes: 30 },
  { timeframe: '60m', minutes: 60 },
] as const satisfies readonly { timeframe: FxPriceRow['timeframe']; minutes: number }[];

const MINUTE_MS = 60_000;

/**
 * Builds `timeframe` candles (open time aligned to `minutes` in UTC) from
 * 1m rows of ONE pair. A bucket is written only when every one of its
 * minutes is present, none is UNVERIFIED and the bucket has fully passed —
 * a partial bucket would show a wrong high/low/close, so it is left out
 * (the next run, whose range covers it, writes it). Status: VERIFIED only
 * when every minute is VERIFIED, otherwise SINGLE_SOURCE.
 */
export function aggregateMinuteRows(
  rows: readonly FxPriceRow[],
  timeframe: Exclude<FxPriceRow['timeframe'], '1m'>,
  minutes: number,
  now: Date,
): FxPriceRow[] {
  const bucketMs = minutes * MINUTE_MS;
  const byMinute = new Map(rows.map((row) => [Date.parse(row.timestamp), row]));
  const buckets = new Set([...byMinute.keys()].map((ms) => Math.floor(ms / bucketMs) * bucketMs));
  const result: FxPriceRow[] = [];
  for (const start of [...buckets].sort((a, b) => a - b)) {
    if (start + bucketMs > now.getTime()) continue;
    const parts: FxPriceRow[] = [];
    for (let ms = start; ms < start + bucketMs; ms += MINUTE_MS) {
      const row = byMinute.get(ms);
      if (!row || row.verification_status === 'UNVERIFIED') break;
      parts.push(row);
    }
    if (parts.length !== minutes) continue;
    const first = parts[0]!;
    const last = parts[parts.length - 1]!;
    const volumes = parts.map((p) => p.volume);
    result.push({
      fx_pair_id: first.fx_pair_id,
      timestamp: new Date(start).toISOString(),
      timeframe,
      open: first.open,
      high: Math.max(...parts.map((p) => p.high)),
      low: Math.min(...parts.map((p) => p.low)),
      close: last.close,
      volume: volumes.every((v) => v !== null) ? volumes.reduce<number>((sum, v) => sum + (v ?? 0), 0) : null,
      source: first.source,
      verification_status: parts.every((p) => p.verification_status === 'VERIFIED') ? 'VERIFIED' : 'SINGLE_SOURCE',
      cross_check_source: null,
      cross_check_close: null,
      cross_check_diff_pips: null,
    });
  }
  return result;
}
