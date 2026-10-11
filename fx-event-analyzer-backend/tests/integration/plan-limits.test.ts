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

/**
 * FREE / PRO usage limits (HQ決定 2026-10-08, api-design.md §28.1).
 *
 * HQ指示 (Calendar/Settings/Accountのみ移植): 元ファイルにあった
 * `GET /notifications/upcoming`(端末内ローカル通知の予約基盤、対象外)と
 * `GET /indicators/{id}/comparison history_limit`(SCR-009 過去イベント比較、
 * Home/指標詳細側、今回のポート対象外でroutes/historical.ts等は未変更)の
 * 2ブロックは移植しない。history_limit用の履歴イベントseed(beforeAll)も
 * それ専用だったため合わせて削除した。GET /entitlements と
 * PATCH /settings notifications の2ブロックは対象 (Settings/Account)。
 */
describe.skipIf(!integration)('Plan limits (FREE / PRO)', () => {
  let ctx: IntegrationContext;
  const users: TestUser[] = [];

  async function newUser(
    plan: 'FREE' | 'PRO',
    features: string[] = [FEATURE_CODES.VIEW_BASIC_EVENT],
  ): Promise<{ user: TestUser; headers: { authorization: string } }> {
    const user = await createTestUser(ctx);
    users.push(user);
    for (const feature of features) await grantEntitlement(ctx, user.id, feature);
    if (plan === 'PRO') await grantEntitlement(ctx, user.id, FEATURE_CODES.VIEW_ADVANCED_STATS);
    return { user, headers: { authorization: `Bearer ${user.accessToken}` } };
  }

  async function request(method: 'GET' | 'PATCH', url: string, headers: { authorization: string }, payload?: object) {
    const response = await ctx.app.inject({ method, url: `/api/v1${url}`, headers, ...(payload ? { payload } : {}) });
    return { status: response.statusCode, body: JSON.parse(response.body) };
  }

  beforeAll(() => {
    ctx = buildIntegrationContext(integration!);
  });

  afterAll(async () => {
    for (const user of users) {
      await deleteTestUser(ctx, user.id);
    }
    await ctx.app.close();
  });

  describe('GET /entitlements', () => {
    it('reports plan FREE and the FREE limits, computed in the timezone query', async () => {
      const { headers } = await newUser('FREE');
      const { status, body } = await request('GET', '/entitlements?timezone=Asia/Tokyo', headers);
      expect(status).toBe(200);
      expect(body.features).toEqual([FEATURE_CODES.VIEW_BASIC_EVENT]);
      expect(body.plan).toBe('FREE');
      expect(body.limits).toMatchObject({
        favorites_max: 3,
        notification_importances: ['HIGH'],
        notification_fx_pairs_max: 1,
        history_events_max: 5,
      });
      // 00:00 JST on the 1st of last month = 15:00 UTC on the day before.
      expect(body.limits.calendar_earliest_from).toMatch(/^\d{4}-\d{2}-\d{2}T15:00:00Z$/);
      expect(body.limits.calendar_latest_to).toMatch(/^\d{4}-12-31T15:00:00Z$/);
    });

    it('reports plan PRO with an active VIEW_ADVANCED_STATS (default timezone UTC)', async () => {
      const { headers } = await newUser('PRO');
      const { status, body } = await request('GET', '/entitlements', headers);
      expect(status).toBe(200);
      expect(body.plan).toBe('PRO');
      const year = new Date().getUTCFullYear();
      expect(body.limits).toEqual({
        calendar_earliest_from: `${year - 5}-01-01T00:00:00Z`,
        calendar_latest_to: `${year + 2}-01-01T00:00:00Z`,
        favorites_max: null,
        notification_importances: ['HIGH', 'MEDIUM', 'LOW'],
        notification_fx_pairs_max: null,
        history_events_max: 20,
      });
    });

    it('is FREE again once VIEW_ADVANCED_STATS has expired', async () => {
      const { user, headers } = await newUser('FREE');
      await grantEntitlement(ctx, user.id, FEATURE_CODES.VIEW_ADVANCED_STATS, { expiresAt: '2020-01-01T00:00:00Z' });
      const { body } = await request('GET', '/entitlements', headers);
      expect(body.plan).toBe('FREE');
      expect(body.features).not.toContain(FEATURE_CODES.VIEW_ADVANCED_STATS);
    });

    it('422s an unknown timezone', async () => {
      const { headers } = await newUser('FREE');
      expect((await request('GET', '/entitlements?timezone=Mars%2FOlympus', headers)).status).toBe(422);
    });
  });

  describe('PATCH /settings notifications', () => {
    it('FREE: 403 PLAN_LIMIT_EXCEEDED for MEDIUM/LOW, all pairs (null) or 2+ pairs — and saves nothing', async () => {
      const { headers } = await newUser('FREE');
      for (const notifications of [
        { importances: ['HIGH', 'MEDIUM'], speeches: false },
        { importances: ['LOW'], speeches: false },
        { fx_pairs: null, speeches: false },
        { fx_pairs: ['USDJPY', 'EURUSD'], speeches: false },
      ]) {
        const { status, body } = await request('PATCH', '/settings', headers, { notifications });
        expect(status).toBe(403);
        expect(body.error).toMatchObject({ code: 'PLAN_LIMIT_EXCEEDED', required_plan: 'PRO' });
      }
      const { body } = await request('GET', '/settings', headers);
      expect(body.notifications).toMatchObject({ speeches: true, fx_pairs: null, importances: ['HIGH', 'MEDIUM'] });
    });

    it('FREE: HIGH only and one pair are saved; unrelated fields are not checked', async () => {
      const { headers } = await newUser('FREE');
      const saved = await request('PATCH', '/settings', headers, {
        notifications: { importances: ['HIGH'], fx_pairs: ['EURUSD'] },
      });
      expect(saved.status).toBe(200);
      expect(saved.body.notifications).toMatchObject({ importances: ['HIGH'], fx_pairs: ['EURUSD'] });

      // The stored defaults (HIGH+MEDIUM, all pairs) are wider than FREE, but
      // only the fields sent are validated.
      const { headers: other } = await newUser('FREE');
      expect((await request('PATCH', '/settings', other, { notifications: { lead_minutes: 10 } })).status).toBe(200);
    });

    it('PRO: every importance and all pairs are allowed', async () => {
      const { headers } = await newUser('PRO');
      const { status, body } = await request('PATCH', '/settings', headers, {
        notifications: { importances: ['HIGH', 'MEDIUM', 'LOW'], fx_pairs: ['USDJPY', 'EURUSD'] },
      });
      expect(status).toBe(200);
      expect(body.notifications.importances).toEqual(['HIGH', 'MEDIUM', 'LOW']);
      expect((await request('PATCH', '/settings', headers, { notifications: { fx_pairs: null } })).status).toBe(200);
    });
  });
});
