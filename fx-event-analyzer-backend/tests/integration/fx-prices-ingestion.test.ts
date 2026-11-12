import { afterAll, describe, expect, it } from 'vitest';
import { upsertFxPrices } from '../../src/repositories/fxPricesRepository.js';
import { buildIntegrationContext, loadIntegrationEnv, type IntegrationContext } from './setup.js';

const integration = loadIntegrationEnv();

// Seed FX pairs (supabase/seed.sql).
const USDJPY = '20000000-0000-0000-0000-000000000001';
const SOURCE = 'integration-test-ingest-fx-prices';
const TIMESTAMP = new Date('2026-10-15T09:00:00Z');

/** fx_prices ingestion job (design.md §4.3のIngestion Worker、src/jobs/ingestFxPrices.ts). */
describe.skipIf(!integration)('upsertFxPrices', () => {
  let ctx: IntegrationContext;

  afterAll(async () => {
    await ctx.serviceClient.from('fx_prices').delete().eq('source', SOURCE);
    await ctx.app.close();
  });

  it('inserts a new candle and overwrites it on the next call for the same (fx_pair_id, timeframe, timestamp)', async () => {
    ctx = buildIntegrationContext(integration!);

    const inserted = await upsertFxPrices(ctx.serviceClient, [
      {
        fx_pair_id: USDJPY,
        timeframe: '1m',
        source: SOURCE,
        candle: { timestamp: TIMESTAMP, open: 154.7, high: 154.72, low: 154.69, close: 154.71, volume: 100 },
      },
    ]);
    expect(inserted).toBe(1);

    const { data: afterInsert, error: insertError } = await ctx.serviceClient
      .from('fx_prices')
      .select('open, high, low, close, volume')
      .eq('fx_pair_id', USDJPY)
      .eq('timeframe', '1m')
      .eq('timestamp', TIMESTAMP.toISOString());
    if (insertError) throw insertError;
    expect(afterInsert).toEqual([{ open: 154.7, high: 154.72, low: 154.69, close: 154.71, volume: 100 }]);

    // A later poll for the same candle (e.g. Twelve Data revises the still-forming bar) overwrites, not duplicates.
    const updated = await upsertFxPrices(ctx.serviceClient, [
      {
        fx_pair_id: USDJPY,
        timeframe: '1m',
        source: SOURCE,
        candle: { timestamp: TIMESTAMP, open: 154.7, high: 154.75, low: 154.69, close: 154.74, volume: 140 },
      },
    ]);
    expect(updated).toBe(1);

    const { data: afterUpdate, error: updateError } = await ctx.serviceClient
      .from('fx_prices')
      .select('open, high, low, close, volume')
      .eq('fx_pair_id', USDJPY)
      .eq('timeframe', '1m')
      .eq('timestamp', TIMESTAMP.toISOString());
    if (updateError) throw updateError;
    expect(afterUpdate).toEqual([{ open: 154.7, high: 154.75, low: 154.69, close: 154.74, volume: 140 }]);
  });

  it('resolves 0 and makes no call for an empty row list', async () => {
    ctx = buildIntegrationContext(integration!);
    expect(await upsertFxPrices(ctx.serviceClient, [])).toBe(0);
  });
});
