import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EUROSTAT_ATTRIBUTION } from '../../src/domain/attribution.js';
import {
  buildIntegrationContext,
  createTestUser,
  deleteTestUser,
  loadIntegrationEnv,
  type IntegrationContext,
  type TestUser,
} from './setup.js';

const integration = loadIntegrationEnv();

const US_CPI_INDICATOR_ID = '10000000-0000-0000-0000-000000000001'; // seed.sql

/**
 * ユーロ圏の経済指標 第1弾(HQ承認 2026-10-30): migration 20261030000001 の行と、API の出典(attribution、
 * api-design v1.43)。読むだけ(行は migration が入れる)。
 */
describe.skipIf(!integration)('Euro-area indicators (Eurostat): master rows and attribution', () => {
  let ctx: IntegrationContext;
  let user: TestUser;
  let authHeader: { authorization: string };

  beforeAll(async () => {
    ctx = buildIntegrationContext(integration!);
    user = await createTestUser(ctx);
    authHeader = { authorization: `Bearer ${user.accessToken}` };
  });

  afterAll(async () => {
    await deleteTestUser(ctx, user.id);
    await ctx.app.close();
  });

  async function listed() {
    const response = await ctx.app.inject({ method: 'GET', url: '/api/v1/indicators?limit=100', headers: authHeader });
    expect(response.statusCode).toBe(200);
    return JSON.parse(response.body).data as Array<Record<string, unknown>>;
  }

  it('lists EU_HICP and EU_UNEMPLOYMENT_RATE as euro-area indicators with the agreed display names and Eurostat as source', async () => {
    const rows = await listed();
    const byCode = new Map(rows.map((row) => [row.code, row]));
    expect(byCode.get('EU_HICP')).toMatchObject({
      display_name: '消費者物価指数（CPI）',
      country_code: 'EU',
      currency_code: 'EUR',
      importance: 'HIGH',
      frequency: 'MONTHLY',
      unit: '%',
      source: 'Eurostat',
    });
    expect(byCode.get('EU_UNEMPLOYMENT_RATE')).toMatchObject({
      display_name: '失業率',
      country_code: 'EU',
      currency_code: 'EUR',
      importance: 'MEDIUM',
      source: 'Eurostat',
    });
  });

  it('GET /indicators/{id}: Eurostat attribution and EURUSD 1 / EURJPY 2; a US indicator has attribution null', async () => {
    const hicp = (await listed()).find((row) => row.code === 'EU_HICP') as { id: string };
    const response = await ctx.app.inject({ method: 'GET', url: `/api/v1/indicators/${hicp.id}`, headers: authHeader });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.attribution).toEqual(EUROSTAT_ATTRIBUTION);
    expect(
      body.related_fx_pairs.map((pair: { symbol: string; priority: number }) => [pair.symbol, pair.priority]),
    ).toEqual([
      ['EURUSD', 1],
      ['EURJPY', 2],
    ]);

    const us = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/indicators/${US_CPI_INDICATOR_ID}`,
      headers: authHeader,
    });
    expect(JSON.parse(us.body).attribution).toBeNull();
  });
});
