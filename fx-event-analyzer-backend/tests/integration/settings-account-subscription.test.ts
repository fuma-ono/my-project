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

/** SCR-018〜026 Backend (HQ確定 2026-10-02): /settings, DELETE /account,
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

  describe('GET/PATCH /settings (api-design.md §24.4/§24.5)', () => {
    it('returns the column defaults on first access', async () => {
      const { headers } = await newUser();
      const response = await ctx.app.inject({ method: 'GET', url: '/api/v1/settings', headers });
      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toMatchObject({
        notifications: { pre_release: true, result: true, favorites: true, min_importance: 3 },
        display: { language: 'ja', region: 'JP', timezone: 'Asia/Tokyo' },
        chart: { default_fx_pair_symbol: null, default_timeframe: '5m' },
      });
    });

    it('updates only the fields sent and persists them', async () => {
      const { headers } = await newUser();
      const patch = await ctx.app.inject({
        method: 'PATCH',
        url: '/api/v1/settings',
        headers,
        payload: { notifications: { result: false, min_importance: 5 }, chart: { default_fx_pair_symbol: 'USDJPY' } },
      });
      expect(patch.statusCode).toBe(200);

      const body = JSON.parse((await ctx.app.inject({ method: 'GET', url: '/api/v1/settings', headers })).body);
      expect(body.notifications).toEqual({ pre_release: true, result: false, favorites: true, min_importance: 5 });
      expect(body.chart.default_fx_pair_symbol).toBe('USDJPY');
      expect(body.display.timezone).toBe('Asia/Tokyo');
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

    it('rejects an out-of-range min_importance with 422', async () => {
      const { headers } = await newUser();
      const response = await ctx.app.inject({
        method: 'PATCH',
        url: '/api/v1/settings',
        headers,
        payload: { notifications: { min_importance: 6 } },
      });
      expect(response.statusCode).toBe(422);
    });

    it('requires authentication', async () => {
      const response = await ctx.app.inject({ method: 'GET', url: '/api/v1/settings' });
      expect(response.statusCode).toBe(401);
    });
  });

  describe('DELETE /account (api-design.md §24.3, physical deletion)', () => {
    it('deletes the auth user and everything that cascades from it', async () => {
      const { user, headers } = await newUser();
      await ctx.app.inject({ method: 'GET', url: '/api/v1/settings', headers }); // creates user_settings

      const response = await ctx.app.inject({ method: 'DELETE', url: '/api/v1/account', headers });
      expect(response.statusCode).toBe(204);

      const { data: authUser } = await ctx.serviceClient.auth.admin.getUserById(user.id);
      expect(authUser.user).toBeNull();
      const { data: profiles } = await ctx.serviceClient.from('profiles').select('id').eq('id', user.id);
      expect(profiles).toEqual([]);
      const { data: settings } = await ctx.serviceClient.from('user_settings').select('user_id').eq('user_id', user.id);
      expect(settings).toEqual([]);
    });
  });

  describe('POST /subscription/verify (api-design.md §25.1)', () => {
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
