import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
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

const USDJPY_FX_PAIR_ID = '20000000-0000-0000-0000-000000000001'; // seed.sql

/**
 * 無料プランの「過去の発表」制限 (HQ判断 2026-10-22, api-design.md §28.1)
 * と、市場の値を持つ5テーブルへの直接アクセス禁止 (migration
 * 20261022000001_past_release_access.sql).
 *
 * Own indicators (unique code per run) and events dated 2011/2012 (RELEASED)
 * and 2098 (SCHEDULED), so no other suite's day/range-based assertions see
 * them. RELEASE snapshots are immutable (DB trigger), so RELEASED events and
 * their snapshots cannot be deleted afterwards — the rest is cleaned up and
 * the indicators are deactivated. CI recreates the database every run.
 */
describe.skipIf(!integration)('Past release limit (FREE: 3 most recent releases per indicator)', () => {
  let ctx: IntegrationContext;
  const users: TestUser[] = [];
  const runId = `${Date.now()}`;

  let indicatorA = '';
  let indicatorB = '';

  // Indicator A: 5 RELEASED + 2 SCHEDULED. Two releases share a datetime —
  // the lower id is the 3rd (visible), the higher one the 4th (locked).
  const tieIds = [randomUUID(), randomUUID()].sort();
  const A = {
    first: randomUUID(),
    second: randomUUID(),
    third: tieIds[0]!,
    fourth: tieIds[1]!,
    fifth: randomUUID(),
    scheduled1: randomUUID(),
    scheduled2: randomUUID(),
  };
  const A_RELEASED = [
    { id: A.first, at: '2012-05-10T12:30:00Z', actual: 101.5 },
    { id: A.second, at: '2012-04-10T12:30:00Z', actual: 102.5 },
    { id: A.third, at: '2012-03-09T12:30:00Z', actual: 103.5 },
    { id: A.fourth, at: '2012-03-09T12:30:00Z', actual: 901.2345 },
    { id: A.fifth, at: '2012-02-10T12:30:00Z', actual: 902.3456 },
  ];
  const A_SCHEDULED = [
    { id: A.scheduled1, at: '2098-01-10T12:30:00Z' },
    { id: A.scheduled2, at: '2098-02-10T12:30:00Z' },
  ];
  const A_ALL_IDS = [...A_RELEASED.map((e) => e.id), ...A_SCHEDULED.map((e) => e.id)];

  // Indicator B (comparison): 7 RELEASED with a RELEASE snapshot (2011-01 … 07)
  // plus a newer RELEASED one without a snapshot, which neither comparison
  // query may count.
  const B_RELEASED = Array.from({ length: 7 }, (_, index) => ({
    id: randomUUID(),
    at: `2011-0${index + 1}-12T12:30:00Z`,
  }));
  const B_NO_SNAPSHOT = { id: randomUUID(), at: '2011-08-12T12:30:00Z' };
  const B_MOST_RECENT_FIRST = [...B_RELEASED].reverse().map((event) => event.id);

  async function newUser(plan: 'FREE' | 'PRO'): Promise<{ user: TestUser; headers: { authorization: string } }> {
    const user = await createTestUser(ctx);
    users.push(user);
    if (plan === 'PRO') await grantEntitlement(ctx, user.id, FEATURE_CODES.VIEW_ADVANCED_STATS);
    return { user, headers: { authorization: `Bearer ${user.accessToken}` } };
  }

  async function get(url: string, headers: { authorization: string }) {
    const response = await ctx.app.inject({ method: 'GET', url: `/api/v1${url}`, headers });
    return { status: response.statusCode, body: JSON.parse(response.body) };
  }

  async function insertIndicator(label: string): Promise<string> {
    const { data, error } = await ctx.serviceClient
      .from('economic_indicators')
      .insert({
        code: `IT_PAST_RELEASE_${label}_${runId}`,
        name: `結合テスト用指標(過去の発表制限 ${label}) ${runId}`,
        country_code: 'US',
        currency_code: 'USD',
        importance: 'HIGH',
        frequency: 'MONTHLY',
        unit: '%',
        favorable_direction: 'HIGHER_IS_POSITIVE',
        is_active: true,
      })
      .select('id')
      .single();
    if (error) throw new Error(`Failed to insert test indicator: ${error.message}`);
    return data.id;
  }

  function eventRow(indicatorId: string, id: string, at: string, status: 'RELEASED' | 'SCHEDULED') {
    return {
      id,
      indicator_id: indicatorId,
      provider: 'integration-test',
      provider_event_id: `past-release-${runId}-${id}`,
      release_datetime: at,
      release_datetime_precision: 'EXACT',
      importance: 'HIGH',
      status,
      data_status: status === 'RELEASED' ? 'AVAILABLE' : 'PENDING',
    };
  }

  function snapshotRow(eventId: string, at: string, actual: number) {
    return {
      event_id: eventId,
      snapshot_type: 'RELEASE',
      forecast: actual - 0.5,
      actual,
      previous: actual - 1,
      unit: '%',
      source: 'integration-test',
      captured_at: at,
      surprise: 0.5,
      surprise_direction: 'POSITIVE',
    };
  }

  function check(label: string, result: { error: { message: string } | null }): void {
    if (result.error) throw new Error(`${label}: ${result.error.message}`);
  }

  beforeAll(async () => {
    ctx = buildIntegrationContext(integration!);
    indicatorA = await insertIndicator('A');
    indicatorB = await insertIndicator('B');

    check(
      'events A',
      await ctx.serviceClient
        .from('economic_events')
        .insert([
          ...A_RELEASED.map((e) => eventRow(indicatorA, e.id, e.at, 'RELEASED')),
          ...A_SCHEDULED.map((e) => eventRow(indicatorA, e.id, e.at, 'SCHEDULED')),
        ]),
    );
    check(
      'snapshots A',
      await ctx.serviceClient.from('event_snapshots').insert(A_RELEASED.map((e) => snapshotRow(e.id, e.at, e.actual))),
    );
    check(
      'revision A4',
      await ctx.serviceClient.from('event_revisions').insert({
        event_id: A.fourth,
        field_name: 'ACTUAL',
        old_value: 901.2345,
        new_value: 903.4567,
        effective_at: '2012-04-09T12:30:00Z',
        source: 'integration-test',
      }),
    );
    check(
      'explanation A4',
      await ctx.serviceClient.from('event_explanations').insert({
        event_id: A.fourth,
        version: 1,
        explanation_type: 'FACT_SUMMARY',
        summary: 'locked-explanation-text',
        source: 'integration-test',
        published_at: '2012-03-09T12:30:00Z',
      }),
    );
    check(
      'reactions A',
      await ctx.serviceClient.from('event_price_reactions').insert(
        A_RELEASED.map((e) => ({
          event_id: e.id,
          fx_pair_id: USDJPY_FX_PAIR_ID,
          timeframe: '5m',
          pre_release_price: 80,
          post_release_price: 80.4321,
          movement: 0.4321,
          pips: 43.21,
          change_percent: 0.5401,
          data_status: 'AVAILABLE',
          calculated_at: e.at,
        })),
      ),
    );

    check(
      'events B',
      await ctx.serviceClient
        .from('economic_events')
        .insert([
          ...B_RELEASED.map((e) => eventRow(indicatorB, e.id, e.at, 'RELEASED')),
          { ...eventRow(indicatorB, B_NO_SNAPSHOT.id, B_NO_SNAPSHOT.at, 'RELEASED'), data_status: 'PENDING' },
        ]),
    );
    check(
      'snapshots B',
      await ctx.serviceClient
        .from('event_snapshots')
        .insert(B_RELEASED.map((e, index) => snapshotRow(e.id, e.at, 200 + index))),
    );
  });

  afterAll(async () => {
    if (!ctx) return;
    for (const user of users) await deleteTestUser(ctx, user.id);
    const allEventIds = [...A_ALL_IDS, ...B_RELEASED.map((e) => e.id), B_NO_SNAPSHOT.id];
    await ctx.serviceClient.from('event_revisions').delete().in('event_id', allEventIds);
    await ctx.serviceClient.from('event_explanations').delete().in('event_id', allEventIds);
    await ctx.serviceClient.from('event_price_reactions').delete().in('event_id', allEventIds);
    // Events without a (immutable) RELEASE snapshot can go.
    await ctx.serviceClient
      .from('economic_events')
      .delete()
      .in('id', [...A_SCHEDULED.map((e) => e.id), B_NO_SNAPSHOT.id]);
    const indicatorIds = [indicatorA, indicatorB].filter((id) => id !== '');
    if (indicatorIds.length > 0) {
      await ctx.serviceClient.from('economic_indicators').update({ is_active: false }).in('id', indicatorIds);
    }
    await ctx.app.close();
  });

  type ListItem = {
    event_id: string;
    status: string;
    actual: number | string | null;
    forecast: number | string | null;
    previous: number | string | null;
    surprise: number | string | null;
    surprise_direction: string | null;
    release_datetime: string;
    data_status: string;
    locked: boolean;
    required_plan: string | null;
  };

  describe('FREE', () => {
    it('GET /indicators/{id}/events: newest 3 releases unlocked with values, older 2 locked, SCHEDULED unlocked', async () => {
      const { headers } = await newUser('FREE');
      const { status, body } = await get(`/indicators/${indicatorA}/events`, headers);
      expect(status).toBe(200);
      const items: ListItem[] = body.data;
      expect(items).toHaveLength(7);
      const byId = new Map(items.map((item) => [item.event_id, item]));

      for (const id of [A.first, A.second, A.third]) {
        const item = byId.get(id)!;
        expect(item).toMatchObject({ status: 'RELEASED', locked: false, required_plan: null });
        expect(item.actual).not.toBeNull();
        expect(item.surprise_direction).toBe('POSITIVE');
      }
      expect(Number(byId.get(A.third)!.actual)).toBeCloseTo(103.5);

      for (const id of [A.fourth, A.fifth]) {
        expect(byId.get(id)).toMatchObject({
          status: 'RELEASED',
          data_status: 'READY',
          forecast: null,
          actual: null,
          previous: null,
          surprise: null,
          surprise_direction: null,
          locked: true,
          required_plan: 'PRO',
        });
        expect(byId.get(id)!.release_datetime).toBeTruthy();
      }
      for (const id of [A.scheduled1, A.scheduled2]) {
        expect(byId.get(id)).toMatchObject({ status: 'SCHEDULED', locked: false, required_plan: null });
      }
      expect(body.past_release_limit).toEqual({ applied: true, max_for_plan: 3, pro_max: null });
      expect(body.meta).toEqual({ page: 1, limit: 20, total: 7, has_next: false });
      expect(JSON.stringify(body)).not.toContain('901.2345');
      expect(JSON.stringify(body)).not.toContain('902.3456');
    });

    it('GET /events/{4th}: 200 with locked: true and every value hidden', async () => {
      const { headers } = await newUser('FREE');
      const { status, body } = await get(`/events/${A.fourth}`, headers);
      expect(status).toBe(200);
      expect(body.event).toMatchObject({
        id: A.fourth,
        indicator_id: indicatorA,
        status: 'RELEASED',
        data_status: 'READY',
        release_datetime_precision: 'EXACT',
        revision_status: null,
        locked: true,
        required_plan: 'PRO',
      });
      expect(body.event.release_datetime).toBeTruthy();
      expect(body.snapshot).toMatchObject({
        forecast: null,
        actual: null,
        previous: null,
        surprise: null,
        surprise_direction: null,
        unit: '%',
        source: 'integration-test',
      });
      expect(body.analysis).toEqual({ surprise: null, surprise_direction: null });
      expect(body.explanation).toBeNull();
      for (const pair of body.related_fx_pairs) {
        expect(pair.reaction).toMatchObject({ pips: null, change_percent: null, analysis_status: null });
      }
      for (const pair of body.major_fx_reactions) {
        for (const reaction of pair.reactions) {
          expect(reaction).toMatchObject({ pips: null, change_percent: null, analysis_status: null });
        }
      }
      const text = JSON.stringify(body);
      expect(text).not.toContain('901.2345');
      expect(text).not.toContain('903.4567');
      expect(text).not.toContain('43.21');
      expect(text).not.toContain('locked-explanation-text');
    });

    it('GET /events/{3rd} (tie, lower id) is unlocked', async () => {
      const { headers } = await newUser('FREE');
      const { status, body } = await get(`/events/${A.third}`, headers);
      expect(status).toBe(200);
      expect(body.event).toMatchObject({ locked: false, required_plan: null, revision_status: 'NONE' });
      expect(Number(body.snapshot.actual)).toBeCloseTo(103.5);
      expect((await get(`/events/${A.third}/revisions`, headers)).status).toBe(200);
    });

    it('child endpoints of a locked event: 403 PLAN_LIMIT_EXCEEDED required_plan PRO', async () => {
      const { headers } = await newUser('FREE');
      for (const url of [
        `/events/${A.fourth}/revisions`,
        `/events/${A.fourth}/history`,
        `/events/${A.fourth}/reaction?fx_pair_id=${USDJPY_FX_PAIR_ID}`,
        `/events/${A.fourth}/reaction?fx_pair_id=${USDJPY_FX_PAIR_ID}&timeframe=5m`,
        `/events/${A.fourth}/reaction/chart?fx_pair_id=${USDJPY_FX_PAIR_ID}&timeframe=1m`,
        `/events/${A.fifth}/history`,
      ]) {
        const { status, body } = await get(url, headers);
        expect(status, url).toBe(403);
        expect(body.error, url).toMatchObject({ code: 'PLAN_LIMIT_EXCEEDED', required_plan: 'PRO' });
      }
    });

    it('GET /home for the past date: the locked release is redacted, the visible one is not', async () => {
      const { headers } = await newUser('FREE');
      const { status, body } = await get('/home?date=2012-03-09&timezone=UTC', headers);
      expect(status).toBe(200);
      const items: ListItem[] = body.events;
      const third = items.find((item) => item.event_id === A.third)!;
      const fourth = items.find((item) => item.event_id === A.fourth)!;
      expect(third).toMatchObject({ locked: false, required_plan: null });
      expect(Number(third.actual)).toBeCloseTo(103.5);
      expect(fourth).toMatchObject({
        status: 'RELEASED',
        forecast: null,
        actual: null,
        previous: null,
        surprise: null,
        surprise_direction: null,
        locked: true,
        required_plan: 'PRO',
      });
      expect(body.past_release_limit).toEqual({ applied: true, max_for_plan: 3, pro_max: null });
      expect(JSON.stringify(body)).not.toContain('901.2345');
    });

    it('GET /entitlements reports past_releases_max 3', async () => {
      const { headers } = await newUser('FREE');
      const { body } = await get('/entitlements', headers);
      expect(body.limits.past_releases_max).toBe(3);
    });
  });

  describe('PRO', () => {
    it('nothing is locked anywhere', async () => {
      const { headers } = await newUser('PRO');
      const list = await get(`/indicators/${indicatorA}/events`, headers);
      expect(list.status).toBe(200);
      expect(list.body.data.every((item: ListItem) => item.locked === false && item.required_plan === null)).toBe(true);
      expect(Number(list.body.data.find((item: ListItem) => item.event_id === A.fifth).actual)).toBeCloseTo(902.3456);
      expect(list.body.past_release_limit).toEqual({ applied: false, max_for_plan: null, pro_max: null });

      const detail = await get(`/events/${A.fourth}`, headers);
      expect(detail.body.event).toMatchObject({ locked: false, required_plan: null, revision_status: 'REVISED' });
      expect(Number(detail.body.snapshot.actual)).toBeCloseTo(901.2345);
      expect(detail.body.explanation.summary).toBe('locked-explanation-text');

      expect((await get(`/events/${A.fourth}/revisions`, headers)).status).toBe(200);
      expect((await get(`/events/${A.fourth}/history`, headers)).status).toBe(200);
      expect((await get(`/events/${A.fourth}/reaction?fx_pair_id=${USDJPY_FX_PAIR_ID}`, headers)).status).toBe(200);
      expect(
        (await get(`/events/${A.fourth}/reaction/chart?fx_pair_id=${USDJPY_FX_PAIR_ID}&timeframe=1m`, headers)).status,
      ).toBe(200);

      const home = await get('/home?date=2012-03-09&timezone=UTC', headers);
      expect(home.body.events.find((item: ListItem) => item.event_id === A.fourth)).toMatchObject({ locked: false });
      expect(home.body.past_release_limit).toEqual({ applied: false, max_for_plan: null, pro_max: null });
    });

    it('GET /entitlements reports past_releases_max null', async () => {
      const { headers } = await newUser('PRO');
      const { body } = await get('/entitlements', headers);
      expect(body.plan).toBe('PRO');
      expect(body.limits.past_releases_max).toBeNull();
    });
  });

  describe('Historical comparison keeps FREE 5 / PRO 20 (only releases with a RELEASE snapshot)', () => {
    const url = (query = '') =>
      `/indicators/${indicatorB}/comparison?fx_pair_id=${USDJPY_FX_PAIR_ID}&timeframe=5m${query}`;
    const ids = (events: { event_id: string }[]) => events.map((event) => event.event_id);

    it('FREE: the 5 most recent releases with a snapshot, ids and page agree', async () => {
      const { headers } = await newUser('FREE');
      const { status, body } = await get(url(), headers);
      expect(status).toBe(200);
      expect(body.total_events).toBe(5);
      expect(ids(body.events)).toEqual(B_MOST_RECENT_FIRST.slice(0, 5));
      expect(ids(body.events)).not.toContain(B_NO_SNAPSHOT.id);
      expect(body.meta).toEqual({ page: 1, limit: 20, total: 5, has_next: false });
      expect(body.history_limit).toEqual({ applied: 5, max_for_plan: 5, pro_max: 20 });
      // The embedded RELEASE snapshot values come through.
      expect(Number(body.events[0].actual)).toBeCloseTo(206);
    });

    it('PRO: every release with a snapshot (7), max 20', async () => {
      const { headers } = await newUser('PRO');
      const { body } = await get(url(), headers);
      expect(body.total_events).toBe(7);
      expect(ids(body.events)).toEqual(B_MOST_RECENT_FIRST);
      expect(body.history_limit).toEqual({ applied: 7, max_for_plan: 20, pro_max: 20 });
    });
  });

  describe('Direct Supabase access (RLS / GRANT, migration 20261022000001)', () => {
    const MARKET_VALUE_TABLES = [
      'economic_events',
      'event_snapshots',
      'event_revisions',
      'event_explanations',
      'event_price_reactions',
    ] as const;

    function asUser(user: TestUser): SupabaseClient {
      return createClient(ctx.supabaseUrl, ctx.anonKey, {
        global: { headers: { Authorization: `Bearer ${user.accessToken}` } },
        auth: { autoRefreshToken: false, persistSession: false },
      });
    }

    function anon(): SupabaseClient {
      return createClient(ctx.supabaseUrl, ctx.anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
    }

    it('an authenticated app user (FREE or PRO) reads no rows from the 5 market-value tables', async () => {
      for (const plan of ['FREE', 'PRO'] as const) {
        const { user } = await newUser(plan);
        const client = asUser(user);
        for (const table of MARKET_VALUE_TABLES) {
          const { data, error } = await client.from(table).select('*').limit(5);
          // A permission error (SELECT revoked) or zero rows — never rows.
          expect(error !== null || (data ?? []).length === 0, `${plan} ${table}`).toBe(true);
          expect(data ?? [], `${plan} ${table}`).toEqual([]);
        }
      }
    });

    it('the anon key without a user reads no rows either', async () => {
      const client = anon();
      for (const table of MARKET_VALUE_TABLES) {
        const { data, error } = await client.from(table).select('*').limit(5);
        expect(error !== null || (data ?? []).length === 0, table).toBe(true);
        expect(data ?? [], table).toEqual([]);
      }
    });

    it('service_role (the Backend) still reads them', async () => {
      const events = await ctx.serviceClient.from('economic_events').select('id').in('id', A_ALL_IDS);
      expect(events.error).toBeNull();
      expect(events.data).toHaveLength(7);
      const snapshots = await ctx.serviceClient.from('event_snapshots').select('event_id').eq('event_id', A.fourth);
      expect(snapshots.data).toHaveLength(1);
      const revisions = await ctx.serviceClient.from('event_revisions').select('id').eq('event_id', A.fourth);
      expect(revisions.data).toHaveLength(1);
      const explanations = await ctx.serviceClient.from('event_explanations').select('id').eq('event_id', A.fourth);
      expect(explanations.data).toHaveLength(1);
      const reactions = await ctx.serviceClient.from('event_price_reactions').select('id').eq('event_id', A.fourth);
      expect(reactions.data).toHaveLength(1);
    });

    it('economic_indicators stays readable by an authenticated user', async () => {
      const { user } = await newUser('FREE');
      const { data, error } = await asUser(user).from('economic_indicators').select('id').eq('id', indicatorA);
      expect(error).toBeNull();
      expect(data).toEqual([{ id: indicatorA }]);
    });

    it('visible_released_event_ids: app users cannot call it, service_role can', async () => {
      const { user } = await newUser('FREE');
      const args = { p_indicator_ids: [indicatorA], p_limit: 3 };
      const asApp = await asUser(user).rpc('visible_released_event_ids', args);
      expect(asApp.error).not.toBeNull();
      expect(asApp.data ?? []).toEqual([]);
      const asAnon = await anon().rpc('visible_released_event_ids', args);
      expect(asAnon.error).not.toBeNull();

      const asService = await ctx.serviceClient.rpc('visible_released_event_ids', args);
      expect(asService.error).toBeNull();
      expect(((asService.data ?? []) as { event_id: string }[]).map((row) => row.event_id).sort()).toEqual(
        [A.first, A.second, A.third].sort(),
      );
    });
  });
});
