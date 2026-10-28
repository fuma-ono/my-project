import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ECB_ATTRIBUTION, FRB_ATTRIBUTION } from '../../src/domain/attribution.js';
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

// Seed FX pairs (supabase/seed.sql).
const USDJPY = '20000000-0000-0000-0000-000000000001';
const EURUSD = '20000000-0000-0000-0000-000000000002';
const AUDUSD = '20000000-0000-0000-0000-000000000005';
const GBPUSD = '20000000-0000-0000-0000-000000000006';

// Test-only rows (removed in afterAll). August 2026: no seed price data there.
const SPEAKER_ID = '4a000000-0000-0000-0000-000000000001'; // USD
const DELIVERED_ID = '5a000000-0000-0000-0000-000000000001'; // 2026-08-03T14:00Z, has candles
const SCHEDULED_ID = '5a000000-0000-0000-0000-000000000002'; // future
const OLDER_DELIVERED_IDS = [2, 3, 4, 5, 6].map((n) => `5a000000-0000-0000-0000-00000000001${n}`);
const UNKNOWN_ID = '00000000-0000-0000-0000-000000000000';
const STATEMENT = '2026-08-03T14:00:00Z';
const PRICE_SOURCE = 'integration-test-speech';

const candle = (fxPairId: string, minute: number, close: number, high = close, low = close) => ({
  fx_pair_id: fxPairId,
  timestamp: new Date(Date.parse(STATEMENT) + minute * 60_000).toISOString(),
  timeframe: '1m',
  open: close,
  high,
  low,
  close,
  source: PRICE_SOURCE,
});

/** 要人発言の値動き (api-design.md §14.5/§14.8〜§14.10, v1.28). */
describe.skipIf(!integration)('Speech reactions / speaker comparison', () => {
  let ctx: IntegrationContext;
  const users: TestUser[] = [];

  /** `revoked`: explicit disabled rows — the FREE features are defaults
   * (default_entitlements, HQ 2026-10-16), so a missing row means granted. */
  async function newUser(features: string[], revoked: string[] = []): Promise<{ authorization: string }> {
    const user = await createTestUser(ctx);
    users.push(user);
    for (const feature of features) await grantEntitlement(ctx, user.id, feature);
    for (const feature of revoked) await grantEntitlement(ctx, user.id, feature, { enabled: false });
    return { authorization: `Bearer ${user.accessToken}` };
  }
  const ALL = [
    FEATURE_CODES.VIEW_BASIC_EVENT,
    FEATURE_CODES.VIEW_HISTORICAL,
    FEATURE_CODES.VIEW_MARKET_REACTION,
    FEATURE_CODES.VIEW_ADVANCED_STATS,
  ];
  const FREE = [FEATURE_CODES.VIEW_BASIC_EVENT, FEATURE_CODES.VIEW_HISTORICAL, FEATURE_CODES.VIEW_MARKET_REACTION];

  async function get(url: string, headers: { authorization: string }) {
    const response = await ctx.app.inject({ method: 'GET', url: `/api/v1${url}`, headers });
    return { status: response.statusCode, body: JSON.parse(response.body) };
  }

  beforeAll(async () => {
    ctx = buildIntegrationContext(integration!);
    const speaker = await ctx.serviceClient.from('speakers').insert({
      id: SPEAKER_ID,
      name: 'テスト・スピーカー',
      title: 'FRB理事',
      organization: 'FRB',
      country_code: 'US',
      currency_code: 'USD',
    });
    if (speaker.error) throw new Error(`Failed to insert speaker: ${speaker.error.message}`);

    const speech = (id: string, providerId: string, at: string, status: string) => ({
      id,
      speaker_id: SPEAKER_ID,
      provider: 'integration-test',
      provider_event_id: providerId,
      title: `test ${providerId}`,
      statement_datetime: at,
      importance: 'HIGH',
      status,
    });
    const speeches = await ctx.serviceClient
      .from('speech_events')
      .insert([
        speech(DELIVERED_ID, 'reaction-delivered', STATEMENT, 'DELIVERED'),
        speech(SCHEDULED_ID, 'reaction-scheduled', '2099-01-01T00:00:00Z', 'SCHEDULED'),
        ...OLDER_DELIVERED_IDS.map((id, index) =>
          speech(id, `reaction-older-${index}`, `2026-07-0${index + 1}T14:00:00Z`, 'DELIVERED'),
        ),
      ]);
    if (speeches.error) throw new Error(`Failed to insert speeches: ${speeches.error.message}`);

    const prices = await ctx.serviceClient.from('fx_prices').insert([
      // USDJPY: pre (13:59 candle) 147.20, 1m 147.48, 5m 147.30, 15m 147.05
      candle(USDJPY, -1, 147.2),
      candle(USDJPY, 0, 147.48, 147.5, 147.19),
      candle(USDJPY, 1, 147.6, 147.62, 147.45),
      candle(USDJPY, 4, 147.3, 147.35, 147.1),
      candle(USDJPY, 14, 147.05, 147.08, 147.0),
      // EURUSD: pre + 1m only — 5m / 15m have no candle → null
      candle(EURUSD, -1, 1.0852),
      candle(EURUSD, 0, 1.08477),
      // GBPUSD / AUDUSD: no data at all
    ]);
    if (prices.error) throw new Error(`Failed to insert fx_prices: ${prices.error.message}`);
  });

  afterAll(async () => {
    await ctx.serviceClient.from('fx_prices').delete().eq('source', PRICE_SOURCE);
    await ctx.serviceClient.from('speech_events').delete().eq('speaker_id', SPEAKER_ID);
    await ctx.serviceClient.from('speakers').delete().eq('id', SPEAKER_ID);
    for (const user of users) await deleteTestUser(ctx, user.id);
    await ctx.app.close();
  });

  describe('GET /speeches/{id} reactions', () => {
    it('DELIVERED: the USD major pairs with real pips, missing prices → null', async () => {
      const { status, body } = await get(`/speeches/${DELIVERED_ID}`, await newUser(ALL));
      expect(status).toBe(200);
      expect(body.speech_id).toBe(DELIVERED_ID);
      expect(body.reactions).toEqual([
        { fx_pair_id: USDJPY, symbol: 'USDJPY', pre_statement_price: 147.2, pips: { '1m': 28, '5m': 10, '15m': -15 } },
        {
          fx_pair_id: EURUSD,
          symbol: 'EURUSD',
          pre_statement_price: 1.0852,
          pips: { '1m': -4.3, '5m': null, '15m': null },
        },
        {
          fx_pair_id: GBPUSD,
          symbol: 'GBPUSD',
          pre_statement_price: null,
          pips: { '1m': null, '5m': null, '15m': null },
        },
        {
          fx_pair_id: AUDUSD,
          symbol: 'AUDUSD',
          pre_statement_price: null,
          pips: { '1m': null, '5m': null, '15m': null },
        },
      ]);
    });

    it('SCHEDULED: reactions is []', async () => {
      const { status, body } = await get(`/speeches/${SCHEDULED_ID}`, await newUser(ALL));
      expect(status).toBe(200);
      expect(body.reactions).toEqual([]);
    });
  });

  describe('GET /speeches/{id}/reaction', () => {
    it('same shape as the event reaction (timeframe=all, 1m..60m)', async () => {
      const { status, body } = await get(`/speeches/${DELIVERED_ID}/reaction?fx_pair_id=${USDJPY}`, await newUser(ALL));
      expect(status).toBe(200);
      expect(body.event_id).toBe(DELIVERED_ID);
      expect(body.fx_pair_id).toBe(USDJPY);
      expect(body.pre_release_price).toBe(147.2);
      expect(body.reactions.map((row: { timeframe: string }) => row.timeframe)).toEqual([
        '1m',
        '5m',
        '15m',
        '30m',
        '60m',
      ]);
      expect(body.reactions[0]).toEqual({
        timeframe: '1m',
        post_release_price: 147.48,
        movement: 0.28,
        pips: 28,
        change_percent: 0.1902,
        max_upward: 0.3,
        max_downward: -0.01,
        max_upward_pips: 30,
        max_downward_pips: -1,
        analysis_status: 'READY',
      });
      expect(body.reactions[3]).toMatchObject({ timeframe: '30m', pips: null, analysis_status: 'DATA_UNAVAILABLE' });
    });

    it('single timeframe returns one object; SCHEDULED → nulls / DATA_PENDING', async () => {
      const headers = await newUser(ALL);
      const single = await get(`/speeches/${DELIVERED_ID}/reaction?fx_pair_id=${USDJPY}&timeframe=5m`, headers);
      expect(single.body).toMatchObject({
        event_id: DELIVERED_ID,
        timeframe: '5m',
        pre_release_price: 147.2,
        post_release_price: 147.3,
        pips: 10,
        analysis_status: 'READY',
      });

      const scheduled = await get(`/speeches/${SCHEDULED_ID}/reaction?fx_pair_id=${USDJPY}`, headers);
      expect(scheduled.body.pre_release_price).toBeNull();
      expect(
        scheduled.body.reactions.every(
          (row: { pips: unknown; analysis_status: string }) =>
            row.pips === null && row.analysis_status === 'DATA_PENDING',
        ),
      ).toBe(true);
    });

    it('a pair without prices → DATA_UNAVAILABLE; 404 / 422 / 403', async () => {
      const headers = await newUser(ALL);
      const noData = await get(`/speeches/${DELIVERED_ID}/reaction?fx_pair_id=${GBPUSD}`, headers);
      expect(noData.body.pre_release_price).toBeNull();
      expect(noData.body.reactions[0]).toMatchObject({ pips: null, analysis_status: 'DATA_UNAVAILABLE' });

      expect((await get(`/speeches/${UNKNOWN_ID}/reaction?fx_pair_id=${USDJPY}`, headers)).body.error.code).toBe(
        'SPEECH_NOT_FOUND',
      );
      expect((await get(`/speeches/${DELIVERED_ID}/reaction?fx_pair_id=${UNKNOWN_ID}`, headers)).body.error.code).toBe(
        'FX_PAIR_NOT_FOUND',
      );
      expect((await get(`/speeches/${DELIVERED_ID}/reaction`, headers)).status).toBe(422);

      const noReaction = await newUser([FEATURE_CODES.VIEW_BASIC_EVENT], [FEATURE_CODES.VIEW_MARKET_REACTION]);
      const forbidden = await get(`/speeches/${DELIVERED_ID}/reaction?fx_pair_id=${USDJPY}`, noReaction);
      expect(forbidden.status).toBe(403);
      expect(forbidden.body.error.code).toBe('FEATURE_NOT_ENTITLED');
    });
  });

  describe('GET /speeches/{id}/reaction/chart', () => {
    it('same shape and window as the event chart (1m: ±15 min)', async () => {
      const { status, body } = await get(
        `/speeches/${DELIVERED_ID}/reaction/chart?fx_pair_id=${USDJPY}&timeframe=1m`,
        await newUser(ALL),
      );
      expect(status).toBe(200);
      expect(body).toMatchObject({
        event_id: DELIVERED_ID,
        fx_pair_id: USDJPY,
        timeframe: '1m',
        window_from: '2026-08-03T13:45:00.000Z',
        window_to: '2026-08-03T14:15:00.000Z',
      });
      expect(Date.parse(body.release_datetime)).toBe(Date.parse(STATEMENT));
      expect(body.prices).toHaveLength(5);
      expect(body.prices[0]).toMatchObject({ open: 147.2, close: 147.2 });
    });

    it('403 without VIEW_MARKET_REACTION, 422 without a valid timeframe', async () => {
      const forbidden = await get(
        `/speeches/${DELIVERED_ID}/reaction/chart?fx_pair_id=${USDJPY}&timeframe=1m`,
        await newUser([FEATURE_CODES.VIEW_BASIC_EVENT], [FEATURE_CODES.VIEW_MARKET_REACTION]),
      );
      expect(forbidden.status).toBe(403);
      const invalid = await get(
        `/speeches/${DELIVERED_ID}/reaction/chart?fx_pair_id=${USDJPY}&timeframe=2m`,
        await newUser(ALL),
      );
      expect(invalid.status).toBe(422);
    });
  });

  describe('GET /speakers/{id}/comparison', () => {
    it('PRO: every DELIVERED speech, newest first, with 1m/5m/15m pips', async () => {
      const { status, body } = await get(`/speakers/${SPEAKER_ID}/comparison?fx_pair_id=${USDJPY}`, await newUser(ALL));
      expect(status).toBe(200);
      expect(body.speaker).toMatchObject({ speaker_id: SPEAKER_ID, currency_code: 'USD', photo_url: null });
      expect(body.fx_pair_id).toBe(USDJPY);
      expect(body.symbol).toBe('USDJPY');
      expect(body.attribution).toEqual(FRB_ATTRIBUTION); // api-design v1.39: 要人の機関(FRB)から
      expect(body.events.map((row: { speech_id: string }) => row.speech_id)).toEqual([
        DELIVERED_ID,
        ...[...OLDER_DELIVERED_IDS].reverse(),
      ]);
      expect(body.events[0]).toMatchObject({
        importance: 'HIGH',
        pips_by_timeframe: { '1m': 28, '5m': 10, '15m': -15 },
      });
      expect(body.events[1].pips_by_timeframe).toEqual({ '1m': null, '5m': null, '15m': null });
      expect(body.history_limit).toEqual({ applied: 6, max_for_plan: 20, pro_max: 20 });
    });

    it('an ECB speaker: attribution with the ECB notice (api-design v1.39)', async () => {
      const LAGARDE_SPEAKER_ID = '40000000-0000-0000-0000-000000000003'; // seed.sql: ECB総裁
      const { status, body } = await get(`/speakers/${LAGARDE_SPEAKER_ID}/comparison`, await newUser(ALL));
      expect(status).toBe(200);
      expect(body.attribution).toEqual(ECB_ATTRIBUTION);
      expect(body.attribution.notice).toBe('この情報は ECB のウェブサイト（www.ecb.europa.eu）で無料で入手できます。');
    });

    it('FREE: capped at history_events_max (3, v1.37); fx_pair_id omitted = USDJPY', async () => {
      const { body } = await get(`/speakers/${SPEAKER_ID}/comparison`, await newUser(FREE));
      expect(body.fx_pair_id).toBe(USDJPY);
      expect(body.events).toHaveLength(3);
      expect(body.history_limit).toEqual({ applied: 3, max_for_plan: 3, pro_max: 20 });
    });

    it('403 without VIEW_HISTORICAL, 404 SPEAKER_NOT_FOUND / FX_PAIR_NOT_FOUND', async () => {
      const forbidden = await get(
        `/speakers/${SPEAKER_ID}/comparison`,
        await newUser([FEATURE_CODES.VIEW_BASIC_EVENT], [FEATURE_CODES.VIEW_HISTORICAL]),
      );
      expect(forbidden.status).toBe(403);
      const headers = await newUser(ALL);
      expect((await get(`/speakers/${UNKNOWN_ID}/comparison`, headers)).body.error.code).toBe('SPEAKER_NOT_FOUND');
      expect((await get(`/speakers/${SPEAKER_ID}/comparison?fx_pair_id=${UNKNOWN_ID}`, headers)).body.error.code).toBe(
        'FX_PAIR_NOT_FOUND',
      );
    });
  });
});
