import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FEATURE_CODES } from '../../src/authorization/entitlements.js';
import { calendarEarliestFrom, calendarLatestTo } from '../../src/domain/planLimits.js';
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
const US_NFP_EVENT_ID = '30000000-0000-0000-0000-000000000003'; // 2026-10-03T12:30Z, HIGH, USD, SCHEDULED
const US_NFP_INDICATOR_ID = '10000000-0000-0000-0000-000000000002';
const POWELL_SCHEDULED_SPEECH_ID = '50000000-0000-0000-0000-000000000004'; // 2026-10-14T16:00Z, HIGH, USD
const UEDA_SCHEDULED_SPEECH_ID = '50000000-0000-0000-0000-000000000005'; // 2026-10-16T01:00Z, MEDIUM, JPY
const LAGARDE_SPEAKER_ID = '40000000-0000-0000-0000-000000000003';

// Test-only CANCELLED speech (removed in afterAll).
const CANCELLED_SPEECH_ID = '3c000000-0000-0000-0000-000000000001';

const OCTOBER = 'from=2026-10-01T00:00:00Z&to=2026-11-01T00:00:00Z';

interface CalendarItemBody {
  kind: string;
  id: string;
  indicator_id: string | null;
  title: string;
  speaker_name: string | null;
  currency_code: string;
  importance: string;
  datetime: string;
  datetime_precision: string;
  status: string;
}

/** SCR-010 経済カレンダー — GET /calendar (api-design.md §14.6). */
describe.skipIf(!integration)('GET /calendar', () => {
  let ctx: IntegrationContext;
  const users: TestUser[] = [];

  // PRO by default so the fixed October 2026 ranges below stay inside the
  // plan's past limit whatever day CI runs on (FREE only reaches back to the
  // 1st of last month — see 'plan limits' below).
  async function newUser(entitled = true, plan: 'FREE' | 'PRO' = 'PRO'): Promise<{ authorization: string }> {
    const user = await createTestUser(ctx);
    users.push(user);
    if (entitled) await grantEntitlement(ctx, user.id, FEATURE_CODES.VIEW_BASIC_EVENT);
    if (plan === 'PRO') await grantEntitlement(ctx, user.id, FEATURE_CODES.VIEW_ADVANCED_STATS);
    return { authorization: `Bearer ${user.accessToken}` };
  }

  async function getItems(query: string): Promise<CalendarItemBody[]> {
    const headers = await newUser();
    const response = await ctx.app.inject({ method: 'GET', url: `/api/v1/calendar?${query}`, headers });
    expect(response.statusCode).toBe(200);
    return JSON.parse(response.body).items;
  }

  beforeAll(async () => {
    ctx = buildIntegrationContext(integration!);
    const { error } = await ctx.serviceClient.from('speech_events').insert({
      id: CANCELLED_SPEECH_ID,
      speaker_id: LAGARDE_SPEAKER_ID,
      provider: 'integration-test',
      provider_event_id: 'calendar-cancelled',
      title: '中止された講演',
      statement_datetime: '2026-10-15T09:00:00Z',
      importance: 'HIGH',
      status: 'CANCELLED',
    });
    if (error) throw new Error(`Failed to insert test speech: ${error.message}`);
  });

  afterAll(async () => {
    await ctx.serviceClient.from('speech_events').delete().eq('id', CANCELLED_SPEECH_ID);
    for (const user of users) {
      await deleteTestUser(ctx, user.id);
    }
    await ctx.app.close();
  });

  it('401s without a token and 403s without VIEW_BASIC_EVENT', async () => {
    const anonymous = await ctx.app.inject({ method: 'GET', url: `/api/v1/calendar?${OCTOBER}` });
    expect(anonymous.statusCode).toBe(401);

    const headers = await newUser(false);
    const response = await ctx.app.inject({ method: 'GET', url: `/api/v1/calendar?${OCTOBER}`, headers });
    expect(response.statusCode).toBe(403);
    expect(JSON.parse(response.body).error.code).toBe('FEATURE_NOT_ENTITLED');
  });

  it('mixes indicator events and speeches in datetime order, without CANCELLED speeches', async () => {
    const headers = await newUser();
    const response = await ctx.app.inject({ method: 'GET', url: `/api/v1/calendar?${OCTOBER}`, headers });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.from).toBe('2026-10-01T00:00:00Z');
    expect(body.to).toBe('2026-11-01T00:00:00Z');

    const items: CalendarItemBody[] = body.items;
    const times = items.map((item) => new Date(item.datetime).getTime());
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(items.some((item) => item.id === CANCELLED_SPEECH_ID)).toBe(false);

    expect(items.find((item) => item.id === US_NFP_EVENT_ID)).toMatchObject({
      kind: 'INDICATOR',
      indicator_id: US_NFP_INDICATOR_ID,
      speaker_name: null,
      currency_code: 'USD',
      importance: 'HIGH',
      datetime_precision: 'EXACT',
      status: 'SCHEDULED',
    });
    expect(items.find((item) => item.id === UEDA_SCHEDULED_SPEECH_ID)).toMatchObject({
      kind: 'SPEECH',
      indicator_id: null,
      title: '国会答弁',
      speaker_name: '植田和男',
      currency_code: 'JPY',
      importance: 'MEDIUM',
      datetime_precision: 'EXACT',
      status: 'SCHEDULED',
    });
  });

  it('treats from as inclusive and to as exclusive', async () => {
    const items = await getItems('from=2026-10-14T16:00:00Z&to=2026-10-16T01:00:00Z');
    const ids = items.map((item) => item.id);
    expect(ids).toContain(POWELL_SCHEDULED_SPEECH_ID);
    expect(ids).not.toContain(UEDA_SCHEDULED_SPEECH_ID);
  });

  it('filters by importance and currency', async () => {
    const items = await getItems(`${OCTOBER}&importance=HIGH&currency=USD`);
    expect(items.length).toBeGreaterThanOrEqual(2);
    expect(items.every((item) => item.importance === 'HIGH' && item.currency_code === 'USD')).toBe(true);
    expect(items.map((item) => item.id)).toEqual(expect.arrayContaining([US_NFP_EVENT_ID, POWELL_SCHEDULED_SPEECH_ID]));
  });

  it('422s for a missing, reversed or too long range', async () => {
    const headers = await newUser();
    for (const query of [
      'from=2026-10-01T00:00:00Z',
      'from=2026-10-10T00:00:00Z&to=2026-10-01T00:00:00Z',
      'from=2026-10-01T00:00:00Z&to=2026-12-31T00:00:00Z',
      `${OCTOBER}&importance=high`,
    ]) {
      const response = await ctx.app.inject({ method: 'GET', url: `/api/v1/calendar?${query}`, headers });
      expect(response.statusCode).toBe(422);
      expect(JSON.parse(response.body).error.code).toBe('VALIDATION_ERROR');
    }
  });

  describe('plan limits (api-design.md §14.6 / §28.1)', () => {
    const DAY_MS = 86_400_000;
    const iso = (date: Date) => date.toISOString().replace(/\.\d{3}Z$/, 'Z');
    const rangeQuery = (from: Date, to: Date, timeZone?: string) =>
      `from=${encodeURIComponent(iso(from))}&to=${encodeURIComponent(iso(to))}${timeZone ? `&timezone=${encodeURIComponent(timeZone)}` : ''}`;

    async function get(headers: { authorization: string }, query: string) {
      const response = await ctx.app.inject({ method: 'GET', url: `/api/v1/calendar?${query}`, headers });
      return { status: response.statusCode, body: JSON.parse(response.body) };
    }

    it('FREE reaches back to the 1st of last month (inclusive); one second earlier is 403 with required_plan PRO', async () => {
      const headers = await newUser(true, 'FREE');
      const earliest = calendarEarliestFrom('FREE', new Date(), 'UTC');
      expect((await get(headers, rangeQuery(earliest, new Date(earliest.getTime() + 30 * DAY_MS)))).status).toBe(200);

      const tooEarly = new Date(earliest.getTime() - 1000);
      const denied = await get(headers, rangeQuery(tooEarly, new Date(earliest.getTime() + 30 * DAY_MS)));
      expect(denied.status).toBe(403);
      expect(denied.body.error).toMatchObject({ code: 'PLAN_LIMIT_EXCEEDED', required_plan: 'PRO' });
    });

    it('computes the FREE bound in the timezone query parameter (default UTC)', async () => {
      const headers = await newUser(true, 'FREE');
      const tokyoEarliest = calendarEarliestFrom('FREE', new Date(), 'Asia/Tokyo');
      const to = new Date(tokyoEarliest.getTime() + 30 * DAY_MS);
      // 00:00 JST on the 1st is 15:00 UTC the day before — earlier than the UTC bound.
      expect((await get(headers, rangeQuery(tokyoEarliest, to, 'Asia/Tokyo'))).status).toBe(200);
      expect((await get(headers, rangeQuery(tokyoEarliest, to))).status).toBe(403);
    });

    it('PRO reaches back to Jan 1st of (current year - 5); earlier is 422 for every plan', async () => {
      const headers = await newUser();
      const earliest = calendarEarliestFrom('PRO', new Date(), 'UTC');
      expect((await get(headers, rangeQuery(earliest, new Date(earliest.getTime() + 31 * DAY_MS)))).status).toBe(200);

      const tooEarly = new Date(earliest.getTime() - 1000);
      for (const user of [headers, await newUser(true, 'FREE')]) {
        const response = await get(user, rangeQuery(tooEarly, new Date(earliest.getTime() + 31 * DAY_MS)));
        expect(response.status).toBe(422);
        expect(response.body.error.code).toBe('VALIDATION_ERROR');
      }
    });

    it('to may reach Jan 1st of (current year + 2) on both plans, not beyond (422)', async () => {
      const latest = calendarLatestTo('FREE', new Date(), 'UTC');
      for (const headers of [await newUser(), await newUser(true, 'FREE')]) {
        expect((await get(headers, rangeQuery(new Date(latest.getTime() - 31 * DAY_MS), latest))).status).toBe(200);
        const response = await get(
          headers,
          rangeQuery(new Date(latest.getTime() - 31 * DAY_MS), new Date(latest.getTime() + 1000)),
        );
        expect(response.status).toBe(422);
        expect(response.body.error.code).toBe('VALIDATION_ERROR');
      }
    });

    it('422s an unknown timezone', async () => {
      const headers = await newUser();
      expect((await get(headers, `${OCTOBER}&timezone=Mars%2FOlympus`)).status).toBe(422);
    });
  });
});
