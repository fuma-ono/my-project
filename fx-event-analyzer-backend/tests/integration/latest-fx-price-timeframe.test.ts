import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listLatestFxPrices } from '../../src/repositories/fxPairsRepository.js';
import { listMajorFx } from '../../src/repositories/homeRepository.js';
import { buildIntegrationContext, loadIntegrationEnv, type IntegrationContext } from './setup.js';

const integration = loadIntegrationEnv();

// seed.sql: CADJPY has no prices, so no other suite reads these rows. 2031 timestamps, own source tag.
const CADJPY_ID = '20000000-0000-0000-0000-000000000009';
const SOURCE = `it-latest-tf-${Date.now()}`;

/** 最新価格は1分足だけから取る(HQ承認 2026-10-21): 本物の Postgres で、同じ時刻の5分足・15分足が混ざらないこと。 */
describe.skipIf(!integration)('Latest FX price uses 1m candles only (GET /home major_fx, rate alerts)', () => {
  let ctx: IntegrationContext;
  const row = (timeframe: string, timestamp: string, close: number, verification_status = 'SINGLE_SOURCE') => ({
    fx_pair_id: CADJPY_ID,
    timeframe,
    timestamp,
    open: close,
    high: close,
    low: close,
    close,
    source: SOURCE,
    verification_status,
  });

  beforeAll(async () => {
    ctx = buildIntegrationContext(integration!);
    const { error } = await ctx.serviceClient
      .from('fx_prices')
      .insert([
        row('1m', '2031-01-15T10:44:00Z', 110.0),
        row('1m', '2031-01-15T10:45:00Z', 110.1),
        row('5m', '2031-01-15T10:45:00Z', 110.5),
        row('15m', '2031-01-15T10:45:00Z', 110.9),
        row('1m', '2031-01-15T10:46:00Z', 110.2, 'UNVERIFIED'),
      ]);
    if (error) throw error;
  });

  afterAll(async () => {
    if (!ctx) return;
    await ctx.serviceClient.from('fx_prices').delete().eq('source', SOURCE);
  });

  it('GET /home major_fx: latest and previous are 1m candles', async () => {
    const [cad] = await listMajorFx(ctx.serviceClient, ['CADJPY']);
    expect(cad).toMatchObject({
      symbol: 'CADJPY',
      price: 110.1,
      timestamp: expect.stringContaining('2031-01-15T10:45:00'),
    });
    expect(cad?.change).toBeCloseTo(0.1, 6);
  });

  it('rate alerts: the latest price is the 1m close', async () => {
    expect(await listLatestFxPrices(ctx.serviceClient, [CADJPY_ID])).toEqual(new Map([[CADJPY_ID, 110.1]]));
  });
});
