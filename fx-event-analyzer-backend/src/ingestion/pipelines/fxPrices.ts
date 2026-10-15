/**
 * ③ (+ optional ⑤) 1-minute FX candles → fx_prices, upsert keyed by
 * (fx_pair_id, timeframe '1m', timestamp = candle OPEN time). Gaps are
 * never filled; see validation/fxCandles.ts for the checks.
 */
import { INGESTION_SETTINGS } from '../config.js';
import { findFxPairMapping } from '../mappings/fxPairs.js';
import type { FxPriceProvider } from '../providers.js';
import type { JobCounters } from '../runner.js';
import type { IngestionStore } from '../store.js';
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
      counters.success += await deps.store.upsertFxPrices(
        checked.accepted.map((c) => ({
          fx_pair_id: pair.id,
          timestamp: new Date(c.candle.openTime).toISOString(),
          timeframe: '1m' as const,
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
        })),
      );
    } catch (error) {
      counters.error(`${symbol}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
