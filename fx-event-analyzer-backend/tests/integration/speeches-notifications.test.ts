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
const POWELL_SCHEDULED_SPEECH_ID = '50000000-0000-0000-0000-000000000004'; // 2026-10-14T16:00Z, HIGH, USD
const UEDA_SCHEDULED_SPEECH_ID = '50000000-0000-0000-0000-000000000005'; // 2026-10-16T01:00Z, MEDIUM, JPY
const POWELL_DELIVERED_SPEECH_ID = '50000000-0000-0000-0000-000000000001';
const JP_CPI_INDICATOR_ID = '10000000-0000-0000-0000-000000000004'; // related: USDJPY, EURJPY
const FOMC_INDICATOR_ID = '10000000-0000-0000-0000-000000000003'; // related: USDJPY

// Test-only events inserted below (removed in afterAll). Not on US_CPI —
// api.test.ts asserts that indicator's exact event count.
const EXACT_EVENT_ID = '3a000000-0000-0000-0000-000000000001';
const DATE_ONLY_EVENT_ID = '3a000000-0000-0000-0000-000000000002';

const WINDOW = 'from=2026-10-13T00:00:00Z&to=2026-10-20T00:00:00Z';

/** 要人発言 / FX pair master / SCR-016 通知 (HQ指示 2026-10-05). */
describe.skipIf(!integration)('Speeches / FX pairs / upcoming notifications', () => {
  let ctx: IntegrationContext;
  const users: TestUser[] = [];

  // PRO (VIEW_ADVANCED_STATS) so the saved settings apply as stored — FREE's
  // limits on /notifications/upcoming are covered in plan-limits.test.ts.
  async function newUser(entitled = true): Promise<{ authorization: string }> {
    const user = await createTestUser(ctx);
    users.push(user);
    if (entitled) {
      await grantEntitlement(ctx, user.id, FEATURE_CODES.VIEW_BASIC_EVENT);
      await grantEntitlement(ctx, user.id, FEATURE_CODES.VIEW_ADVANCED_STATS);
    }
    return { authorization: `Bearer ${user.accessToken}` };
  }

  beforeAll(async () => {
    ctx = buildIntegrationContext(integration!);
    const { error } = await ctx.serviceClient.from('economic_events').insert([
      {
        id: EXACT_EVENT_ID,
        indicator_id: JP_CPI_INDICATOR_ID,
        provider: 'integration-test',
        provider_event_id: 'notify-exact',
        release_datetime: '2026-10-15T23:30:00Z',
        release_datetime_precision: 'EXACT',
        importance: 'HIGH',
        status: 'SCHEDULED',
      },
      {
        id: DATE_ONLY_EVENT_ID,
        indicator_id: FOMC_INDICATOR_ID,
        provider: 'integration-test',
        provider_event_id: 'notify-date-only',
        release_datetime: '2026-10-15T00:00:00Z',
        release_datetime_precision: 'DATE_ONLY',
        importance: 'HIGH',
        status: 'SCHEDULED',
      },
    ]);
    if (error) throw new Error(`Failed to insert test events: ${error.message}`);
  });

  afterAll(async () => {
    await ctx.serviceClient.from('economic_events').delete().in('id', [EXACT_EVENT_ID, DATE_ONLY_EVENT_ID]);
    for (const user of users) {
      await deleteTestUser(ctx, user.id);
    }
    await ctx.app.close();
  });

  describe('GET /speeches', () => {
    it('lists speeches newest first with the speaker folded in', async () => {
      const headers = await newUser();
      const response = await ctx.app.inject({ method: 'GET', url: '/api/v1/speeches', headers });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.meta.total).toBeGreaterThanOrEqual(5);
      const times = body.data.map((row: { statement_datetime: string }) => new Date(row.statement_datetime).getTime());
      expect(times).toEqual([...times].sort((a, b) => b - a));
      expect(body.data.find((row: { speech_id: string }) => row.speech_id === UEDA_SCHEDULED_SPEECH_ID)).toMatchObject({
        title: '国会答弁',
        summary: null,
        importance: 'MEDIUM',
        status: 'SCHEDULED',
        speaker: {
          name: '植田和男',
          title: '日本銀行総裁',
          organization: '日本銀行',
          country_code: 'JP',
          currency_code: 'JPY',
        },
      });
    });

    it('filters by currency and importance', async () => {
      const headers = await newUser();
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/speeches?currency=USD&importance=HIGH',
        headers,
      });
      const body = JSON.parse(response.body);
      expect(body.data.length).toBeGreaterThanOrEqual(2);
      expect(
        body.data.every(
          (row: { importance: string; speaker: { currency_code: string } }) =>
            row.importance === 'HIGH' && row.speaker.currency_code === 'USD',
        ),
      ).toBe(true);
    });

    it('returns a single speech, 404 SPEECH_NOT_FOUND for an unknown id, 422 for a non-uuid', async () => {
      const headers = await newUser();
      const found = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/speeches/${POWELL_DELIVERED_SPEECH_ID}`,
        headers,
      });
      expect(found.statusCode).toBe(200);
      expect(JSON.parse(found.body)).toMatchObject({ speech_id: POWELL_DELIVERED_SPEECH_ID, status: 'DELIVERED' });

      const missing = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/speeches/00000000-0000-0000-0000-000000000000',
        headers,
      });
      expect(missing.statusCode).toBe(404);
      expect(JSON.parse(missing.body).error.code).toBe('SPEECH_NOT_FOUND');

      const invalid = await ctx.app.inject({ method: 'GET', url: '/api/v1/speeches/not-a-uuid', headers });
      expect(invalid.statusCode).toBe(422);
    });

    it('403s without VIEW_BASIC_EVENT', async () => {
      const headers = await newUser(false);
      const response = await ctx.app.inject({ method: 'GET', url: '/api/v1/speeches', headers });
      expect(response.statusCode).toBe(403);
    });
  });

  describe('GET /fx-pairs', () => {
    it('lists active FX pairs ordered by symbol', async () => {
      const headers = await newUser(false);
      const response = await ctx.app.inject({ method: 'GET', url: '/api/v1/fx-pairs', headers });
      expect(response.statusCode).toBe(200);
      const symbols = JSON.parse(response.body).data.map((pair: { symbol: string }) => pair.symbol);
      expect(symbols).toEqual([...symbols].sort());
      expect(JSON.parse(response.body).data).toContainEqual({
        fx_pair_id: '20000000-0000-0000-0000-000000000001',
        symbol: 'USDJPY',
        base_currency: 'USD',
        quote_currency: 'JPY',
      });
    });
  });

  describe('GET /notifications/upcoming', () => {
    async function upcoming(headers: { authorization: string }, query = WINDOW) {
      return ctx.app.inject({ method: 'GET', url: `/api/v1/notifications/upcoming?${query}`, headers });
    }

    it('applies the default settings: EXACT indicators + speeches, HIGH/MEDIUM, 5 minutes before', async () => {
      const headers = await newUser();
      const response = await upcoming(headers);
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.lead_minutes).toBe(5);
      const ids = body.items.map((item: { id: string }) => item.id);
      expect(ids).toContain(EXACT_EVENT_ID);
      expect(ids).toContain(POWELL_SCHEDULED_SPEECH_ID);
      expect(ids).toContain(UEDA_SCHEDULED_SPEECH_ID);
      expect(ids).not.toContain(DATE_ONLY_EVENT_ID);

      expect(body.items.find((item: { id: string }) => item.id === POWELL_SCHEDULED_SPEECH_ID)).toEqual({
        kind: 'SPEECH',
        id: POWELL_SCHEDULED_SPEECH_ID,
        title: '経済見通しに関する講演',
        speaker_name: 'ジェローム・パウエル',
        importance: 'HIGH',
        scheduled_at: '2026-10-14T16:00:00Z',
        notify_at: '2026-10-14T15:55:00Z',
        country_code: 'US',
        currency_code: 'USD',
        // Every active USD pair by symbol (seed.sql has 9 pairs since SCR-026).
        related_fx_pairs: ['AUDUSD', 'EURUSD', 'GBPUSD', 'USDCHF', 'USDJPY'],
      });
      expect(body.items.find((item: { id: string }) => item.id === EXACT_EVENT_ID)).toMatchObject({
        kind: 'INDICATOR',
        speaker_name: null,
        related_fx_pairs: ['USDJPY', 'EURJPY'],
      });

      const notifyTimes = body.items.map((item: { notify_at: string }) => item.notify_at);
      expect(notifyTimes).toEqual([...notifyTimes].sort());
    });

    it('follows the saved settings (kinds, importances, fx_pairs, lead_minutes)', async () => {
      const headers = await newUser();
      await ctx.app.inject({
        method: 'PATCH',
        url: '/api/v1/settings',
        headers,
        payload: {
          notifications: { indicators: false, importances: ['MEDIUM'], fx_pairs: ['EURJPY'], lead_minutes: 60 },
        },
      });
      const body = JSON.parse((await upcoming(headers)).body);
      expect(body.lead_minutes).toBe(60);
      // Only the MEDIUM JPY speech: EURJPY intersects its JPY pairs.
      expect(body.items.map((item: { id: string }) => item.id)).toEqual([UEDA_SCHEDULED_SPEECH_ID]);
      expect(body.items[0].notify_at).toBe('2026-10-16T00:00:00Z');
    });

    async function patchSettings(headers: { authorization: string }, payload: object) {
      const response = await ctx.app.inject({ method: 'PATCH', url: '/api/v1/settings', headers, payload });
      expect(response.statusCode).toBe(200);
    }

    it('drops items whose notify_at is in the quiet hours (23:00〜07:00 in Asia/Tokyo)', async () => {
      const headers = await newUser();
      await patchSettings(headers, { notifications: { quiet_hours_enabled: true } });
      const body = JSON.parse((await upcoming(headers)).body);
      const ids = body.items.map((item: { id: string }) => item.id);
      // Powell notify_at 2026-10-14T15:55Z = 00:55 JST → suppressed.
      expect(ids).not.toContain(POWELL_SCHEDULED_SPEECH_ID);
      // Ueda 00:55Z = 09:55 JST, the JP CPI event 23:25Z = 08:25 JST → kept.
      expect(ids).toContain(UEDA_SCHEDULED_SPEECH_ID);
      expect(ids).toContain(EXACT_EVENT_ID);
      for (const item of body.items as { notify_at: string }[]) {
        const jstHour = (new Date(item.notify_at).getUTCHours() + 9) % 24;
        expect(jstHour >= 7 && jstHour < 23).toBe(true);
      }
    });

    it('evaluates quiet hours in the saved display timezone', async () => {
      const headers = await newUser();
      await patchSettings(headers, {
        notifications: { quiet_hours_enabled: true, quiet_start: '19:00', quiet_end: '20:00' },
        display: { timezone: 'America/New_York' },
      });
      const ids = JSON.parse((await upcoming(headers)).body).items.map((item: { id: string }) => item.id);
      // EDT (UTC-4): JP CPI 23:25Z = 19:25 → suppressed; Powell 15:55Z = 11:55, Ueda 00:55Z = 20:55 → kept.
      expect(ids).not.toContain(EXACT_EVENT_ID);
      expect(ids).toContain(POWELL_SCHEDULED_SPEECH_ID);
      expect(ids).toContain(UEDA_SCHEDULED_SPEECH_ID);
    });

    it('suppresses nothing when quiet_start == quiet_end', async () => {
      const headers = await newUser();
      await patchSettings(headers, {
        notifications: { quiet_hours_enabled: true, quiet_start: '07:00', quiet_end: '07:00' },
      });
      const ids = JSON.parse((await upcoming(headers)).body).items.map((item: { id: string }) => item.id);
      expect(ids).toContain(POWELL_SCHEDULED_SPEECH_ID);
      expect(ids).toContain(UEDA_SCHEDULED_SPEECH_ID);
      expect(ids).toContain(EXACT_EVENT_ID);
    });

    it('returns no items when push is off', async () => {
      const headers = await newUser();
      await ctx.app.inject({
        method: 'PATCH',
        url: '/api/v1/settings',
        headers,
        payload: { notifications: { push: false } },
      });
      const body = JSON.parse((await upcoming(headers)).body);
      expect(body.items).toEqual([]);
    });

    it('rejects a range over 14 days or to <= from with 422', async () => {
      const headers = await newUser();
      expect((await upcoming(headers, 'from=2026-10-01T00:00:00Z&to=2026-10-20T00:00:00Z')).statusCode).toBe(422);
      expect((await upcoming(headers, 'from=2026-10-10T00:00:00Z&to=2026-10-10T00:00:00Z')).statusCode).toBe(422);
    });
  });
});
