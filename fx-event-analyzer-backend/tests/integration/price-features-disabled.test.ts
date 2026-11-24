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

const US_CPI_INDICATOR_ID = '10000000-0000-0000-0000-000000000001';
const US_CPI_EVENT_ID = '30000000-0000-0000-0000-000000000001'; // seed: RELEASED, has reactions (28 / 56 / 85 pips)
const USDJPY = '20000000-0000-0000-0000-000000000001';
const SPEAKER_ID = '4a000000-0000-0000-0000-0000000000f1';
const DELIVERED_ID = '5a000000-0000-0000-0000-0000000000f1';

/**
 * 価格由来の機能のフラグ PRICE_FEATURES_ENABLED = false(オーナー決定 2026-11-24)。シードには、フラグ true なら
 * 値のある価格反応(pips)があるのに、false では応答のどこにも出ないことを確かめる(既存の結合テストは setup.ts で true)。
 */
describe.skipIf(!integration)('Price features disabled (PRICE_FEATURES_ENABLED=false)', () => {
  let ctx: IntegrationContext;
  let user: TestUser;
  const headers = () => ({ authorization: `Bearer ${user.accessToken}` });

  async function call(method: 'GET' | 'POST' | 'DELETE', url: string, payload?: object) {
    const response = await ctx.app.inject({
      method,
      url: `/api/v1${url}`,
      headers: headers(),
      ...(payload ? { payload } : {}),
    });
    return { status: response.statusCode, body: response.body ? JSON.parse(response.body) : null };
  }

  beforeAll(async () => {
    ctx = buildIntegrationContext(integration!, { env: { PRICE_FEATURES_ENABLED: false } });
    user = await createTestUser(ctx);
    await grantEntitlement(ctx, user.id, FEATURE_CODES.VIEW_BASIC_EVENT);
    await grantEntitlement(ctx, user.id, FEATURE_CODES.VIEW_HISTORICAL);
    await grantEntitlement(ctx, user.id, FEATURE_CODES.VIEW_MARKET_REACTION);
    await grantEntitlement(ctx, user.id, FEATURE_CODES.VIEW_ADVANCED_STATS);

    const speaker = await ctx.serviceClient.from('speakers').insert({
      id: SPEAKER_ID,
      name: 'フラグ無効テスト',
      title: 'FRB理事',
      organization: 'FRB',
      country_code: 'US',
      currency_code: 'USD',
    });
    if (speaker.error) throw new Error(`Failed to insert speaker: ${speaker.error.message}`);
    const speech = await ctx.serviceClient.from('speech_events').insert({
      id: DELIVERED_ID,
      speaker_id: SPEAKER_ID,
      provider: 'integration-test',
      provider_event_id: 'price-flag-off',
      title: 'test price-flag-off',
      statement_datetime: '2026-08-03T14:00:00Z',
      importance: 'HIGH',
      status: 'DELIVERED',
    });
    if (speech.error) throw new Error(`Failed to insert speech: ${speech.error.message}`);
  });

  afterAll(async () => {
    await ctx.serviceClient.from('speech_events').delete().eq('speaker_id', SPEAKER_ID);
    await ctx.serviceClient.from('speakers').delete().eq('id', SPEAKER_ID);
    await deleteTestUser(ctx, user.id);
    await ctx.app.close();
  });

  it('GET /entitlements: price_features_enabled=false at the top level', async () => {
    const { status, body } = await call('GET', '/entitlements');
    expect(status).toBe(200);
    expect(body.price_features_enabled).toBe(false);
    expect(body).toHaveProperty('features');
    expect(body).toHaveProperty('plan');
    expect(body).toHaveProperty('limits');
  });

  it('GET /events/{id}: no reaction on related_fx_pairs, major_fx_reactions = []', async () => {
    const { status, body } = await call('GET', `/events/${US_CPI_EVENT_ID}`);
    expect(status).toBe(200);
    expect(body.related_fx_pairs.length).toBeGreaterThan(0);
    for (const pair of body.related_fx_pairs) {
      expect(Object.keys(pair).sort()).toEqual(['fx_pair_id', 'priority', 'symbol']);
    }
    expect(body.major_fx_reactions).toEqual([]);
    expect(JSON.stringify(body)).not.toContain('pips');
  });

  it.each([
    `/events/${US_CPI_EVENT_ID}/reaction?fx_pair_id=${USDJPY}`,
    `/events/${US_CPI_EVENT_ID}/reaction/chart?fx_pair_id=${USDJPY}&timeframe=1m`,
    `/events/${US_CPI_EVENT_ID}/strategy-analysis`,
    `/speeches/${DELIVERED_ID}/reaction?fx_pair_id=${USDJPY}`,
    `/speeches/${DELIVERED_ID}/reaction/chart?fx_pair_id=${USDJPY}&timeframe=1m`,
    '/rate-alerts',
  ])('GET %s is 404 NOT_FOUND', async (url) => {
    const { status, body } = await call('GET', url);
    expect(status).toBe(404);
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('POST /rate-alerts and DELETE /rate-alerts/{id} are 404', async () => {
    const created = await call('POST', '/rate-alerts', { fx_pair_id: USDJPY, direction: 'ABOVE', target_price: 150 });
    expect(created.status).toBe(404);
    const deleted = await call('DELETE', `/rate-alerts/${DELIVERED_ID}`);
    expect(deleted.status).toBe(404);
  });

  it('GET /events/{id}/history: related_fx_pairs[].reactions = []', async () => {
    const { status, body } = await call('GET', `/events/${US_CPI_EVENT_ID}/history`);
    expect(status).toBe(200);
    expect(body.related_fx_pairs.length).toBeGreaterThan(0);
    for (const pair of body.related_fx_pairs) expect(pair.reactions).toEqual([]);
  });

  it.each([`?fx_pair_id=${USDJPY}&timeframe=5m`, `?fx_pair_id=${USDJPY}&timeframe=all`, '', '?timeframe=5m'])(
    'GET /indicators/{id}/comparison%s: values only (fx_pair_id ignored / optional)',
    async (query) => {
      const { status, body } = await call('GET', `/indicators/${US_CPI_INDICATOR_ID}/comparison${query}`);
      expect(status).toBe(200);
      expect(body.indicator).toMatchObject({ code: 'US_CPI' });
      for (const key of ['stats', 'advanced_statistics', 'stats_by_timeframe', 'analyzable_events', 'fx_pair_id']) {
        expect(body, key).not.toHaveProperty(key);
      }
      expect(body.events.length).toBeGreaterThan(0);
      for (const event of body.events) expect(event).not.toHaveProperty('pips_by_timeframe');
      expect(body).toHaveProperty('history_limit');
      expect(body).toHaveProperty('meta');
    },
  );

  it('GET /speeches/{id}: reactions = []', async () => {
    const { status, body } = await call('GET', `/speeches/${DELIVERED_ID}`);
    expect(status).toBe(200);
    expect(body.reactions).toEqual([]);
  });

  it('GET /speakers/{id}/comparison: values only', async () => {
    const { status, body } = await call('GET', `/speakers/${SPEAKER_ID}/comparison?fx_pair_id=${USDJPY}`);
    expect(status).toBe(200);
    expect(body.fx_pair_id).toBeNull();
    expect(body.symbol).toBeNull();
    expect(body.events.length).toBe(1);
    expect(body.events[0]).not.toHaveProperty('pips_by_timeframe');
  });

  it('GET /home: major_fx = []', async () => {
    const { status, body } = await call('GET', '/home?date=2026-09-10&timezone=UTC');
    expect(status).toBe(200);
    expect(body.major_fx).toEqual([]);
  });

  it('GET /notifications: stored RATE_ALERT rows are hidden (not deleted) and not counted; no new ones are created', async () => {
    const now = Date.now();
    const inserted = await ctx.serviceClient
      .from('notification_inbox')
      .insert({
        user_id: user.id,
        kind: 'RATE_ALERT',
        target_id: 'flag-off',
        trigger: 'CROSSED',
        title: 'USDJPY 150.000 以上',
        body: '現在 150.123',
        notify_at: new Date(now - 60_000).toISOString(),
        expires_at: new Date(now + 3_600_000).toISOString(),
      })
      .select('id')
      .single();
    if (inserted.error) throw new Error(`Failed to insert inbox row: ${inserted.error.message}`);

    const { status, body } = await call('GET', '/notifications');
    expect(status).toBe(200);
    expect(body.items.map((item: { kind: string }) => item.kind)).not.toContain('RATE_ALERT');
    expect(body.unread_count).toBe(0);
    const stored = await ctx.serviceClient.from('notification_inbox').select('id').eq('id', inserted.data.id);
    expect(stored.data).toHaveLength(1);
  });
});
