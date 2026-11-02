import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FEATURE_CODES } from '../../src/authorization/entitlements.js';
import {
  buildIntegrationContext,
  createTestUser,
  deleteTestUser,
  grantEntitlement,
  loadIntegrationEnv,
  type IntegrationContext,
  type TestUser,
} from './setup.js';

const integration = loadIntegrationEnv();

// seed.sql の行(読むだけ)。US_CPI は BLS の%の指標 → 1。BOJ_RATE は BLS ではない → null。
const US_CPI_INDICATOR_ID = '10000000-0000-0000-0000-000000000001';
const BOJ_INDICATOR_ID = '10000000-0000-0000-0000-000000000005';
const US_CPI_EVENT_ID = '30000000-0000-0000-0000-000000000001'; // RELEASED、改定1件
const BOJ_EVENT_ID = '30000000-0000-0000-0000-000000000002';
const USDJPY_FX_PAIR_ID = '20000000-0000-0000-0000-000000000001';

/**
 * value_decimals(HQ指示 2026-11-02「表示桁数」、api-design v1.46): 指標の値を返す6つの経路で、BLS の%の指標は 1、
 * それ以外は null。保存値は丸めない(actual などはそのまま)。
 */
describe.skipIf(!integration)('value_decimals on every response that carries indicator values (v1.46)', () => {
  let ctx: IntegrationContext;
  let user: TestUser;
  let headers: { authorization: string };

  beforeAll(async () => {
    ctx = buildIntegrationContext(integration!);
    user = await createTestUser(ctx);
    headers = { authorization: `Bearer ${user.accessToken}` };
    await grantEntitlement(ctx, user.id, FEATURE_CODES.VIEW_BASIC_EVENT);
    await grantEntitlement(ctx, user.id, FEATURE_CODES.VIEW_HISTORICAL);
  });

  afterAll(async () => {
    await deleteTestUser(ctx, user.id);
    await ctx.app.close();
  });

  const get = async (url: string) => {
    const response = await ctx.app.inject({ method: 'GET', url: `/api/v1${url}`, headers });
    expect(response.statusCode, url).toBe(200);
    return JSON.parse(response.body);
  };

  it('GET /home: 1 for US_CPI, null for the other indicators', async () => {
    const body = await get('/home?date=2026-09-10&timezone=UTC');
    const events = body.events as Array<{ indicator_id: string; value_decimals: unknown }>;
    expect(events.some((e) => e.indicator_id === US_CPI_INDICATOR_ID)).toBe(true);
    for (const event of events) {
      expect(event.value_decimals).toBe(event.indicator_id === US_CPI_INDICATOR_ID ? 1 : null);
    }
  });

  it('GET /events/{id}: on event, 1 for US_CPI and null for BOJ_RATE', async () => {
    expect((await get(`/events/${US_CPI_EVENT_ID}`)).event.value_decimals).toBe(1);
    expect((await get(`/events/${BOJ_EVENT_ID}`)).event.value_decimals).toBeNull();
  });

  it('GET /events/{id}/history: on event', async () => {
    expect((await get(`/events/${US_CPI_EVENT_ID}/history`)).event.value_decimals).toBe(1);
  });

  it('GET /events/{id}/revisions: on every row', async () => {
    const body = await get(`/events/${US_CPI_EVENT_ID}/revisions`);
    expect(body.data.length).toBeGreaterThan(0);
    for (const row of body.data) expect(row.value_decimals).toBe(1);
  });

  it('GET /indicators/{id}/events: on every row, 1 for US_CPI and null for BOJ_RATE', async () => {
    const cpi = await get(`/indicators/${US_CPI_INDICATOR_ID}/events`);
    expect(cpi.data.length).toBeGreaterThan(0);
    for (const row of cpi.data) expect(row.value_decimals).toBe(1);
    const boj = await get(`/indicators/${BOJ_INDICATOR_ID}/events`);
    for (const row of boj.data) expect(row.value_decimals).toBeNull();
  });

  it.each(['5m', 'all'])('GET /indicators/{id}/comparison (timeframe=%s): on indicator', async (timeframe) => {
    const body = await get(
      `/indicators/${US_CPI_INDICATOR_ID}/comparison?fx_pair_id=${USDJPY_FX_PAIR_ID}&timeframe=${timeframe}`,
    );
    expect(body.indicator.value_decimals).toBe(1);
  });

  it('does not round the stored values (value_decimals is display-only)', async () => {
    const { data } = await ctx.serviceClient
      .from('event_snapshots')
      .select('actual')
      .eq('event_id', US_CPI_EVENT_ID)
      .eq('snapshot_type', 'RELEASE')
      .single();
    const body = await get(`/events/${US_CPI_EVENT_ID}`);
    expect(Number(body.snapshot.actual)).toBe(Number(data!.actual));
  });
});
