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

// Seed fixtures (supabase/seed.sql).
const US_NFP_INDICATOR_ID = '10000000-0000-0000-0000-000000000002'; // no RELEASED event in seed.sql
const USDJPY_FX_PAIR_ID = '20000000-0000-0000-0000-000000000001';
const POWELL_SCHEDULED_SPEECH_ID = '50000000-0000-0000-0000-000000000004'; // 2026-10-14T16:00Z, HIGH, USD
const UEDA_SCHEDULED_SPEECH_ID = '50000000-0000-0000-0000-000000000005'; // 2026-10-16T01:00Z, MEDIUM, JPY

// Test-only RELEASED US NFP events, 2015-01 … 2015-07 (one per month).
// RELEASE snapshots are immutable (DB trigger), so these rows are never
// deleted — upserted with ignoreDuplicates so a rerun against the same
// local DB still works. CI starts from a fresh `supabase db reset`.
const HISTORY_EVENTS = Array.from({ length: 7 }, (_, index) => ({
  id: `3d000000-0000-0000-0000-00000000000${index + 1}`,
  release_datetime: `2015-0${index + 1}-09T13:30:00Z`,
}));
const MOST_RECENT_FIRST = [...HISTORY_EVENTS].reverse().map((event) => event.id);

const WINDOW = 'from=2026-10-13T00:00:00Z&to=2026-10-20T00:00:00Z';

/** FREE / PRO usage limits (HQ決定 2026-10-08, api-design.md §28.1). */
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

  beforeAll(async () => {
    ctx = buildIntegrationContext(integration!);
    const events = await ctx.serviceClient.from('economic_events').upsert(
      HISTORY_EVENTS.map((event, index) => ({
        id: event.id,
        indicator_id: US_NFP_INDICATOR_ID,
        provider: 'integration-test',
        provider_event_id: `plan-limits-history-${index + 1}`,
        release_datetime: event.release_datetime,
        release_datetime_precision: 'EXACT',
        importance: 'HIGH',
        status: 'RELEASED',
        data_status: 'AVAILABLE',
      })),
      { onConflict: 'id', ignoreDuplicates: true },
    );
    if (events.error) throw new Error(`Failed to insert history events: ${events.error.message}`);

    const snapshots = await ctx.serviceClient.from('event_snapshots').upsert(
      HISTORY_EVENTS.map((event, index) => ({
        event_id: event.id,
        snapshot_type: 'RELEASE',
        forecast: 200 + index,
        actual: 210 + index,
        previous: 190 + index,
        unit: 'K',
        source: 'integration-test',
        captured_at: event.release_datetime,
        surprise: 10,
        surprise_direction: 'POSITIVE',
      })),
      { onConflict: 'event_id,snapshot_type', ignoreDuplicates: true },
    );
    if (snapshots.error) throw new Error(`Failed to insert history snapshots: ${snapshots.error.message}`);

    const reactions = await ctx.serviceClient.from('event_price_reactions').upsert(
      HISTORY_EVENTS.map((event, index) => ({
        event_id: event.id,
        fx_pair_id: USDJPY_FX_PAIR_ID,
        timeframe: '5m',
        pre_release_price: 120,
        post_release_price: 120.1 + index * 0.01,
        movement: 0.1 + index * 0.01,
        pips: 10 + index,
        change_percent: 0.08,
        data_status: 'AVAILABLE',
        calculated_at: event.release_datetime,
      })),
      { onConflict: 'event_id,fx_pair_id,timeframe', ignoreDuplicates: true },
    );
    if (reactions.error) throw new Error(`Failed to insert history reactions: ${reactions.error.message}`);
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

  describe('GET /notifications/upcoming', () => {
    type Item = { id: string; importance: string; related_fx_pairs: string[] };
    const ids = (items: Item[]) => items.map((item) => item.id);

    it('FREE with the default settings: HIGH only, USDJPY only', async () => {
      const { headers } = await newUser('FREE');
      const { status, body } = await request('GET', `/notifications/upcoming?${WINDOW}`, headers);
      expect(status).toBe(200);
      const items: Item[] = body.items;
      expect(ids(items)).toContain(POWELL_SCHEDULED_SPEECH_ID);
      expect(ids(items)).not.toContain(UEDA_SCHEDULED_SPEECH_ID);
      expect(items.every((item) => item.importance === 'HIGH' && item.related_fx_pairs.includes('USDJPY'))).toBe(true);
    });

    it('PRO with the default settings also gets MEDIUM', async () => {
      const { headers } = await newUser('PRO');
      const { body } = await request('GET', `/notifications/upcoming?${WINDOW}`, headers);
      expect(ids(body.items)).toEqual(expect.arrayContaining([POWELL_SCHEDULED_SPEECH_ID, UEDA_SCHEDULED_SPEECH_ID]));
    });

    it('a lapsed PRO user is evaluated with the FREE limits, whatever is stored', async () => {
      const { user, headers } = await newUser('PRO');
      const saved = await request('PATCH', '/settings', headers, {
        notifications: { importances: ['MEDIUM'], fx_pairs: ['EURJPY', 'USDJPY'] },
      });
      expect(saved.status).toBe(200);
      await ctx.serviceClient
        .from('entitlements')
        .update({ enabled: false })
        .eq('user_id', user.id)
        .eq('feature_code', FEATURE_CODES.VIEW_ADVANCED_STATS);

      const { body } = await request('GET', `/notifications/upcoming?${WINDOW}`, headers);
      const items: Item[] = body.items;
      // MEDIUM → HIGH; only the first stored pair (EURJPY) — Powell's USD pairs don't include it.
      expect(ids(items)).not.toContain(UEDA_SCHEDULED_SPEECH_ID);
      expect(ids(items)).not.toContain(POWELL_SCHEDULED_SPEECH_ID);
      expect(items.every((item) => item.importance === 'HIGH' && item.related_fx_pairs.includes('EURJPY'))).toBe(true);
      // The stored settings themselves are untouched.
      expect((await request('GET', '/settings', headers)).body.notifications).toMatchObject({
        importances: ['MEDIUM'],
        fx_pairs: ['EURJPY', 'USDJPY'],
      });
    });
  });

  describe('GET /indicators/{id}/comparison history_limit', () => {
    const url = (query: string) =>
      `/indicators/${US_NFP_INDICATOR_ID}/comparison?fx_pair_id=${USDJPY_FX_PAIR_ID}&${query}`;
    const historyFeatures = [FEATURE_CODES.VIEW_HISTORICAL];

    it('FREE uses only the 5 most recent releases, for stats and events alike', async () => {
      const { headers } = await newUser('FREE', historyFeatures);
      const { status, body } = await request('GET', url('timeframe=5m'), headers);
      expect(status).toBe(200);
      expect(body.total_events).toBe(5);
      expect(body.analyzable_events).toBe(5);
      expect(body.stats.upward_count).toBe(5);
      expect(body.events.map((event: { event_id: string }) => event.event_id)).toEqual(MOST_RECENT_FIRST.slice(0, 5));
      expect(body.meta).toEqual({ page: 1, limit: 20, total: 5, has_next: false });
      expect(body.history_limit).toEqual({ applied: 5, max_for_plan: 5, pro_max: 20 });
    });

    it('FREE pagination stops at the cap', async () => {
      const { headers } = await newUser('FREE', historyFeatures);
      const second = await request('GET', url('timeframe=5m&page=2&limit=3'), headers);
      expect(second.body.events.map((event: { event_id: string }) => event.event_id)).toEqual(
        MOST_RECENT_FIRST.slice(3, 5),
      );
      expect(second.body.meta).toEqual({ page: 2, limit: 3, total: 5, has_next: false });

      const third = await request('GET', url('timeframe=5m&page=3&limit=3'), headers);
      expect(third.body.events).toEqual([]);
      expect(third.body.meta.total).toBe(5);
    });

    it('PRO uses every release up to 20 (timeframe=all too)', async () => {
      const { headers } = await newUser('PRO', historyFeatures);
      const single = await request('GET', url('timeframe=5m'), headers);
      expect(single.body.total_events).toBe(7);
      expect(single.body.events).toHaveLength(7);
      expect(single.body.history_limit).toEqual({ applied: 7, max_for_plan: 20, pro_max: 20 });

      const all = await request('GET', url('timeframe=all'), headers);
      expect(all.status).toBe(200);
      expect(all.body.history_limit).toEqual({ applied: 7, max_for_plan: 20, pro_max: 20 });
    });
  });
});
