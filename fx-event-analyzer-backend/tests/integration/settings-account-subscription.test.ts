import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FEATURE_CODES } from '../../src/authorization/entitlements.js';
import {
  createTestSignedDataVerifier,
  renewalInfoPayload,
  signAppStorePayload,
  transactionPayload,
} from '../helpers/storekitFixtures.js';
import {
  buildIntegrationContext,
  createTestUser,
  deleteTestUser,
  loadIntegrationEnv,
  type IntegrationContext,
  type TestUser,
} from './setup.js';

const integration = loadIntegrationEnv();

/** A new user's display / chart settings (DB column defaults). */
const DEFAULT_DISPLAY = {
  language: 'ja',
  region: 'JP',
  timezone: 'Asia/Tokyo',
  theme: 'SYSTEM',
  text_size: 'STANDARD',
  date_format: 'YYYY/MM/DD',
  time_format: '24H',
  currency: 'JPY',
  week_start: 'MONDAY',
};
const DEFAULT_CHART = {
  default_fx_pair_symbol: null,
  default_timeframe: '5m',
  chart_type: 'CANDLE',
  show_indicators: true,
  indicator_ma: true,
  indicator_bollinger: false,
  indicator_macd: true,
  indicator_rsi: false,
  indicator_stochastic: false,
  crosshair: true,
  price_line: true,
};

/** SCR-018〜026 Backend (HQ確定 2026-10-02): /settings, GET/PATCH/DELETE /account,
 * POST /subscription/verify. StoreKit data is signed by
 * the throwaway chain from tests/helpers/storekitFixtures.ts, which this
 * app instance is told to trust. */
describe.skipIf(!integration)('Settings / account deletion / App Store subscription', () => {
  let ctx: IntegrationContext;
  const users: TestUser[] = [];

  async function newUser(): Promise<{ user: TestUser; headers: { authorization: string } }> {
    const user = await createTestUser(ctx);
    users.push(user);
    return { user, headers: { authorization: `Bearer ${user.accessToken}` } };
  }

  beforeAll(() => {
    ctx = buildIntegrationContext(integration!, { signedDataVerifier: createTestSignedDataVerifier() });
  });

  afterAll(async () => {
    for (const user of users) {
      await deleteTestUser(ctx, user.id);
    }
    await ctx.app.close();
  });

  function originalTransactionId(): string {
    return `${Date.now()}${Math.floor(Math.random() * 1_000_000)}`;
  }

  async function verify(
    headers: { authorization: string },
    tx: Record<string, unknown>,
    renewal: Record<string, unknown> | null,
  ) {
    return ctx.app.inject({
      method: 'POST',
      url: '/api/v1/subscription/verify',
      headers,
      payload: {
        signed_transaction: await signAppStorePayload(tx),
        ...(renewal ? { signed_renewal_info: await signAppStorePayload(renewal) } : {}),
      },
    });
  }

  async function advancedStatsEntitlement(userId: string) {
    const { data } = await ctx.serviceClient
      .from('entitlements')
      .select('enabled')
      .eq('user_id', userId)
      .eq('feature_code', FEATURE_CODES.VIEW_ADVANCED_STATS)
      .maybeSingle();
    return data;
  }

  describe('GET/PATCH /settings (api-design.md §24.4/§24.5)', () => {
    it('returns the column defaults on first access', async () => {
      const { headers } = await newUser();
      const response = await ctx.app.inject({ method: 'GET', url: '/api/v1/settings', headers });
      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toMatchObject({
        notifications: {
          push: true,
          indicators: true,
          speeches: true,
          fx_pairs: null,
          importances: ['HIGH', 'MEDIUM'],
          lead_minutes: 5,
          quiet_hours_enabled: false,
          quiet_start: '23:00',
          quiet_end: '07:00',
        },
      });
      // SCR-018 / SCR-019 (20261006000002_display_chart_settings_v2.sql).
      expect(JSON.parse(response.body).display).toEqual(DEFAULT_DISPLAY);
      expect(JSON.parse(response.body).chart).toEqual(DEFAULT_CHART);
    });

    it('updates only the fields sent and persists them', async () => {
      const { headers } = await newUser();
      const patch = await ctx.app.inject({
        method: 'PATCH',
        url: '/api/v1/settings',
        headers,
        payload: {
          notifications: { speeches: false, importances: ['LOW', 'HIGH'], lead_minutes: 30, fx_pairs: ['USDJPY'] },
          chart: { default_fx_pair_symbol: 'USDJPY' },
        },
      });
      expect(patch.statusCode).toBe(200);

      const body = JSON.parse((await ctx.app.inject({ method: 'GET', url: '/api/v1/settings', headers })).body);
      expect(body.notifications).toEqual({
        push: true,
        indicators: true,
        speeches: false,
        fx_pairs: ['USDJPY'],
        importances: ['HIGH', 'LOW'],
        lead_minutes: 30,
        quiet_hours_enabled: false,
        quiet_start: '23:00',
        quiet_end: '07:00',
      });
      expect(body.chart.default_fx_pair_symbol).toBe('USDJPY');
      expect(body.display.timezone).toBe('Asia/Tokyo');
    });

    it('saves quiet hours and returns them as HH:MM', async () => {
      const { headers } = await newUser();
      const patch = await ctx.app.inject({
        method: 'PATCH',
        url: '/api/v1/settings',
        headers,
        payload: { notifications: { quiet_hours_enabled: true, quiet_start: '22:30', quiet_end: '06:00' } },
      });
      expect(patch.statusCode).toBe(200);
      expect(JSON.parse(patch.body).notifications).toMatchObject({
        quiet_hours_enabled: true,
        quiet_start: '22:30',
        quiet_end: '06:00',
      });

      // Partial update: only quiet_end changes, the rest is kept.
      await ctx.app.inject({
        method: 'PATCH',
        url: '/api/v1/settings',
        headers,
        payload: { notifications: { quiet_end: '07:15' } },
      });
      const body = JSON.parse((await ctx.app.inject({ method: 'GET', url: '/api/v1/settings', headers })).body);
      expect(body.notifications).toMatchObject({ quiet_hours_enabled: true, quiet_start: '22:30', quiet_end: '07:15' });
    });

    it('saves the SCR-018 display / SCR-019 chart fields and keeps the rest on a partial PATCH', async () => {
      const { headers } = await newUser();
      const display = {
        theme: 'DARK',
        text_size: 'LARGE',
        date_format: 'YYYY年M月D日',
        time_format: '12H',
        currency: 'USD',
        week_start: 'SUNDAY',
      };
      const chart = {
        chart_type: 'LINE',
        show_indicators: false,
        indicator_ma: false,
        indicator_bollinger: true,
        indicator_macd: false,
        indicator_rsi: true,
        indicator_stochastic: true,
        crosshair: false,
        price_line: false,
      };
      const patch = await ctx.app.inject({
        method: 'PATCH',
        url: '/api/v1/settings',
        headers,
        payload: { display, chart },
      });
      expect(patch.statusCode).toBe(200);
      expect(JSON.parse(patch.body).display).toEqual({ ...DEFAULT_DISPLAY, ...display });
      expect(JSON.parse(patch.body).chart).toEqual({ ...DEFAULT_CHART, ...chart });

      // Partial update: only theme and indicator_ma change, the rest is kept.
      const partial = await ctx.app.inject({
        method: 'PATCH',
        url: '/api/v1/settings',
        headers,
        payload: { display: { theme: 'LIGHT' }, chart: { indicator_ma: true } },
      });
      expect(partial.statusCode).toBe(200);
      const body = JSON.parse((await ctx.app.inject({ method: 'GET', url: '/api/v1/settings', headers })).body);
      expect(body.display).toEqual({ ...DEFAULT_DISPLAY, ...display, theme: 'LIGHT' });
      expect(body.chart).toEqual({ ...DEFAULT_CHART, ...chart, indicator_ma: true });
      expect(body.notifications.quiet_hours_enabled).toBe(false);
    });

    it('rejects invalid display / chart values with 422 and saves nothing', async () => {
      const { headers } = await newUser();
      for (const payload of [
        { display: { theme: 'dark' } },
        { display: { text_size: 'MEDIUM' } },
        { display: { date_format: 'DD/MM/YYYY' } },
        { display: { time_format: '24h' } },
        { display: { currency: 'CNY' } },
        { display: { week_start: 'SATURDAY' } },
        { chart: { chart_type: 'AREA' } },
        { chart: { show_indicators: 'true' } },
        { chart: { indicator_rsi: 1 } },
        { chart: { price_line: null } },
        { display: { theme: 'DARK', currency: 'CNY' } },
      ]) {
        const response = await ctx.app.inject({ method: 'PATCH', url: '/api/v1/settings', headers, payload });
        expect(response.statusCode).toBe(422);
        expect(JSON.parse(response.body).error.code).toBe('VALIDATION_ERROR');
      }

      const body = JSON.parse((await ctx.app.inject({ method: 'GET', url: '/api/v1/settings', headers })).body);
      expect(body.display).toEqual(DEFAULT_DISPLAY);
      expect(body.chart).toEqual(DEFAULT_CHART);
    });

    it('rejects a quiet_start / quiet_end that is not HH:MM with 422', async () => {
      const { headers } = await newUser();
      for (const notifications of [{ quiet_start: '24:00' }, { quiet_end: '7:00' }, { quiet_start: '23:00:00' }]) {
        const response = await ctx.app.inject({
          method: 'PATCH',
          url: '/api/v1/settings',
          headers,
          payload: { notifications },
        });
        expect(response.statusCode).toBe(422);
        expect(JSON.parse(response.body).error.code).toBe('VALIDATION_ERROR');
      }
    });

    it('rejects an unknown FX pair symbol with 422', async () => {
      const { headers } = await newUser();
      const response = await ctx.app.inject({
        method: 'PATCH',
        url: '/api/v1/settings',
        headers,
        payload: { chart: { default_fx_pair_symbol: 'XXXYYY' } },
      });
      expect(response.statusCode).toBe(422);
      expect(JSON.parse(response.body).error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects an unsupported lead_minutes or empty importances with 422', async () => {
      const { headers } = await newUser();
      for (const notifications of [{ lead_minutes: 7 }, { importances: [] }, { fx_pairs: ['USDJPY', 'USDJPY'] }]) {
        const response = await ctx.app.inject({
          method: 'PATCH',
          url: '/api/v1/settings',
          headers,
          payload: { notifications },
        });
        expect(response.statusCode).toBe(422);
      }
    });

    it('rejects an unknown notification FX pair symbol with 422 and saves nothing', async () => {
      const { headers } = await newUser();
      const response = await ctx.app.inject({
        method: 'PATCH',
        url: '/api/v1/settings',
        headers,
        payload: { notifications: { fx_pairs: ['USDJPY', 'XXXYYY'], speeches: false } },
      });
      expect(response.statusCode).toBe(422);
      expect(JSON.parse(response.body).error.code).toBe('VALIDATION_ERROR');

      const body = JSON.parse((await ctx.app.inject({ method: 'GET', url: '/api/v1/settings', headers })).body);
      expect(body.notifications).toMatchObject({ fx_pairs: null, speeches: true });
    });

    it('resets fx_pairs to null (= all pairs)', async () => {
      const { headers } = await newUser();
      await ctx.app.inject({
        method: 'PATCH',
        url: '/api/v1/settings',
        headers,
        payload: { notifications: { fx_pairs: ['EURUSD'] } },
      });
      const response = await ctx.app.inject({
        method: 'PATCH',
        url: '/api/v1/settings',
        headers,
        payload: { notifications: { fx_pairs: null } },
      });
      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body).notifications.fx_pairs).toBeNull();
    });

    it('requires authentication', async () => {
      const response = await ctx.app.inject({ method: 'GET', url: '/api/v1/settings' });
      expect(response.statusCode).toBe(401);
    });
  });

  describe('GET/PATCH /account (api-design.md §24.1/§24.2)', () => {
    it('returns an empty profile for a brand-new user instead of 404', async () => {
      const { user, headers } = await newUser();
      const response = await ctx.app.inject({ method: 'GET', url: '/api/v1/account', headers });
      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toMatchObject({ user_id: user.id, display_name: null, birth_date: null });
    });

    it('saves display_name and birth_date', async () => {
      const { headers } = await newUser();
      const patch = await ctx.app.inject({
        method: 'PATCH',
        url: '/api/v1/account',
        headers,
        payload: { display_name: '山田 太郎', birth_date: '1990-01-01' },
      });
      expect(patch.statusCode).toBe(200);
      const get = await ctx.app.inject({ method: 'GET', url: '/api/v1/account', headers });
      expect(JSON.parse(get.body)).toMatchObject({ display_name: '山田 太郎', birth_date: '1990-01-01' });
    });

    it('rejects an impossible birth_date with 422', async () => {
      const { headers } = await newUser();
      const response = await ctx.app.inject({
        method: 'PATCH',
        url: '/api/v1/account',
        headers,
        payload: { birth_date: '1990-02-30' },
      });
      expect(response.statusCode).toBe(422);
    });
  });

  describe('DELETE /account (api-design.md §24.3, physical deletion)', () => {
    it('deletes the auth user and everything that cascades from it', async () => {
      const { user, headers } = await newUser();
      await ctx.app.inject({ method: 'GET', url: '/api/v1/settings', headers }); // creates user_settings
      const id = originalTransactionId();
      expect((await verify(headers, transactionPayload(user.id, { originalTransactionId: id }), null)).statusCode).toBe(
        200,
      );
      expect(await advancedStatsEntitlement(user.id)).toEqual({ enabled: true }); // subscriptions + entitlements rows exist

      const response = await ctx.app.inject({ method: 'DELETE', url: '/api/v1/account', headers });
      expect(response.statusCode).toBe(204);

      const { data: authUser } = await ctx.serviceClient.auth.admin.getUserById(user.id);
      expect(authUser.user).toBeNull();
      const { data: profiles } = await ctx.serviceClient.from('profiles').select('id').eq('id', user.id);
      expect(profiles).toEqual([]);
      const { data: settings } = await ctx.serviceClient.from('user_settings').select('user_id').eq('user_id', user.id);
      expect(settings).toEqual([]);
      const { data: subscriptions } = await ctx.serviceClient.from('subscriptions').select('id').eq('user_id', user.id);
      expect(subscriptions).toEqual([]);
      const { data: entitlements } = await ctx.serviceClient.from('entitlements').select('id').eq('user_id', user.id);
      expect(entitlements).toEqual([]);
    });
  });

  describe('POST /subscription/verify (api-design.md §25.1)', () => {
    it('stores an active Pro subscription and grants VIEW_ADVANCED_STATS', async () => {
      const { user, headers } = await newUser();
      const id = originalTransactionId();
      const response = await verify(
        headers,
        transactionPayload(user.id, { originalTransactionId: id }),
        renewalInfoPayload({ originalTransactionId: id }),
      );
      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toMatchObject({ plan: 'PRO', status: 'ACTIVE' });

      const current = JSON.parse((await ctx.app.inject({ method: 'GET', url: '/api/v1/subscription', headers })).body);
      expect(current).toMatchObject({ plan: 'PRO', status: 'ACTIVE' });
      expect(await advancedStatsEntitlement(user.id)).toEqual({ enabled: true });
    });

    it('treats a free trial as current and grants VIEW_ADVANCED_STATS', async () => {
      const { user, headers } = await newUser();
      const id = originalTransactionId();
      const response = await verify(
        headers,
        transactionPayload(user.id, { originalTransactionId: id, offerType: 1, offerDiscountType: 'FREE_TRIAL' }),
        renewalInfoPayload({ originalTransactionId: id }),
      );
      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toMatchObject({ plan: 'PRO', status: 'TRIAL' });

      const current = JSON.parse((await ctx.app.inject({ method: 'GET', url: '/api/v1/subscription', headers })).body);
      expect(current).toMatchObject({ plan: 'PRO', status: 'TRIAL' });
      expect(await advancedStatsEntitlement(user.id)).toEqual({ enabled: true });
    });

    it('is idempotent for the same subscription and keeps PRO while CANCELED', async () => {
      const { user, headers } = await newUser();
      const id = originalTransactionId();
      const tx = transactionPayload(user.id, { originalTransactionId: id });
      expect((await verify(headers, tx, renewalInfoPayload({ originalTransactionId: id }))).statusCode).toBe(200);

      const canceled = await verify(headers, tx, renewalInfoPayload({ originalTransactionId: id, autoRenewStatus: 0 }));
      expect(canceled.statusCode).toBe(200);
      expect(JSON.parse(canceled.body).status).toBe('CANCELED');

      const current = JSON.parse((await ctx.app.inject({ method: 'GET', url: '/api/v1/subscription', headers })).body);
      expect(current).toMatchObject({ plan: 'PRO', status: 'CANCELED' });
      expect(await advancedStatsEntitlement(user.id)).toEqual({ enabled: true });

      const { count } = await ctx.serviceClient
        .from('subscriptions')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id);
      expect(count).toBe(1);
    });

    it('revokes PRO when the subscription has expired', async () => {
      const { user, headers } = await newUser();
      const id = originalTransactionId();
      await verify(headers, transactionPayload(user.id, { originalTransactionId: id }), null);

      const expired = await verify(
        headers,
        transactionPayload(user.id, { originalTransactionId: id, expiresDate: Date.now() - 1000 }),
        null,
      );
      expect(expired.statusCode).toBe(200);
      expect(JSON.parse(expired.body).status).toBe('EXPIRED');

      const current = JSON.parse((await ctx.app.inject({ method: 'GET', url: '/api/v1/subscription', headers })).body);
      expect(current.plan).toBe('FREE');
      expect(await advancedStatsEntitlement(user.id)).toEqual({ enabled: false });
    });

    it('rejects a transaction bought by another account with 403', async () => {
      const { headers } = await newUser();
      const { user: other } = await newUser();
      const response = await verify(
        headers,
        transactionPayload(other.id, { originalTransactionId: originalTransactionId() }),
        null,
      );
      expect(response.statusCode).toBe(403);
    });

    it('rejects a subscription already linked to another account with 409', async () => {
      const { user: first, headers: firstHeaders } = await newUser();
      const { user: second, headers: secondHeaders } = await newUser();
      const id = originalTransactionId();
      expect(
        (await verify(firstHeaders, transactionPayload(first.id, { originalTransactionId: id }), null)).statusCode,
      ).toBe(200);

      const response = await verify(secondHeaders, transactionPayload(second.id, { originalTransactionId: id }), null);
      expect(response.statusCode).toBe(409);
      expect(JSON.parse(response.body).error.code).toBe('CONFLICT');
    });

    it('rejects data not signed by the trusted chain with 422', async () => {
      const { headers } = await newUser();
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/subscription/verify',
        headers,
        payload: { signed_transaction: 'not-a-jws' },
      });
      expect(response.statusCode).toBe(422);
    });
  });
});
