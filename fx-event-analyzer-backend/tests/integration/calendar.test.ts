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
const US_NFP_EVENT_ID = '30000000-0000-0000-0000-000000000003'; // 2026-10-03T12:30Z, HIGH, USD, SCHEDULED
const POWELL_SCHEDULED_SPEECH_ID = '50000000-0000-0000-0000-000000000004'; // 2026-10-14T16:00Z, HIGH, USD
const UEDA_SCHEDULED_SPEECH_ID = '50000000-0000-0000-0000-000000000005'; // 2026-10-16T01:00Z, MEDIUM, JPY
const LAGARDE_SPEAKER_ID = '40000000-0000-0000-0000-000000000003';

// Test-only CANCELLED speech (removed in afterAll).
const CANCELLED_SPEECH_ID = '3c000000-0000-0000-0000-000000000001';

const OCTOBER = 'from=2026-10-01T00:00:00Z&to=2026-11-01T00:00:00Z';

interface CalendarItemBody {
  kind: string;
  id: string;
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

  async function newUser(entitled = true): Promise<{ authorization: string }> {
    const user = await createTestUser(ctx);
    users.push(user);
    if (entitled) await grantEntitlement(ctx, user.id, FEATURE_CODES.VIEW_BASIC_EVENT);
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
      speaker_name: null,
      currency_code: 'USD',
      importance: 'HIGH',
      datetime_precision: 'EXACT',
      status: 'SCHEDULED',
    });
    expect(items.find((item) => item.id === UEDA_SCHEDULED_SPEECH_ID)).toMatchObject({
      kind: 'SPEECH',
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
});
