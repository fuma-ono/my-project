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
  /** pips of B_RELEASED[index] (every timeframe): 10.37, 20.37, … 70.37. */
  const B_PIPS = (index: number) => (index + 1) * 10 + 0.37;

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
    check(
      'reactions B',
      await ctx.serviceClient.from('event_price_reactions').insert(
        B_RELEASED.flatMap((e, index) =>
          ['1m', '5m', '15m'].map((timeframe) => ({
            event_id: e.id,
            fx_pair_id: USDJPY_FX_PAIR_ID,
            timeframe,
            pre_release_price: 80,
            post_release_price: 80 + B_PIPS(index) / 100,
            movement: B_PIPS(index) / 100,
            pips: B_PIPS(index),
            change_percent: 0.1,
            data_status: 'AVAILABLE',
            calculated_at: e.at,
          })),
        ),
      ),
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
        // 古いアプリ(非 optional の enum)が読める固定値。A4 には改定があるが REVISED にはしない。
        revision_status: 'NONE',
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
        expect(pair.reaction).toEqual({
          timeframe: '5m',
          pips: null,
          change_percent: null,
          analysis_status: 'NOT_ANALYZABLE',
        });
      }
      for (const pair of body.major_fx_reactions) {
        for (const reaction of pair.reactions) {
          expect(reaction).toMatchObject({ pips: null, change_percent: null, analysis_status: 'NOT_ANALYZABLE' });
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

  describe('Historical comparison: FREE 5 / PRO 20 rows, FREE values and stats only from unlocked rows', () => {
    const url = (query = '') =>
      `/indicators/${indicatorB}/comparison?fx_pair_id=${USDJPY_FX_PAIR_ID}&timeframe=5m${query}`;
    const ids = (events: { event_id: string }[]) => events.map((event) => event.event_id);
    // FREE lock for indicator B: the 3 newest RELEASED are B_NO_SNAPSHOT (no
    // snapshot, so not a comparison row), B7 and B6. Comparison rows B7…B3:
    // B7 / B6 unlocked, B5 / B4 / B3 locked.
    const [B7, B6, B5, B4, B3] = B_MOST_RECENT_FIRST;
    const ROW_KEYS = [
      'actual',
      'event_id',
      'forecast',
      'locked',
      'pips_by_timeframe',
      'previous',
      'release_datetime',
      'required_plan',
      'surprise',
      'surprise_direction',
    ];
    // Values only the locked rows B5 / B4 / B3 have (actual / forecast and pips).
    // B5's actual (204) is not listed: it is also B6's published `previous`
    // (the known residual, api-design.md 21章).
    const LOCKED_ONLY_VALUES = ['203.5', '202.5', '201.5', '50.37', '40.37', '30.37'];

    type ComparisonRow = {
      event_id: string;
      actual: number | string | null;
      locked: boolean;
      required_plan: string | null;
      pips_by_timeframe: Record<string, number | string | null>;
    };

    it('FREE: 5 rows (the setting), the 3 locked ones without values, stats from the 2 unlocked ones', async () => {
      const { headers } = await newUser('FREE');
      const { status, body } = await get(url(), headers);
      expect(status).toBe(200);
      const rows: ComparisonRow[] = body.events;
      expect(ids(rows)).toEqual([B7, B6, B5, B4, B3]);
      expect(ids(rows)).not.toContain(B_NO_SNAPSHOT.id);
      expect(body.meta).toEqual({ page: 1, limit: 20, total: 5, has_next: false });
      expect(body.history_limit).toEqual({ applied: 5, max_for_plan: 5, pro_max: 20 });
      expect(body.past_release_limit).toEqual({ applied: true, max_for_plan: 3, pro_max: null });

      // Each row carries only what the comparison table needs: no explanation,
      // revision or full reaction of the release (api-design.md §21).
      for (const row of rows) {
        expect(Object.keys(row).sort()).toEqual(ROW_KEYS);
        expect(Object.keys(row.pips_by_timeframe).sort()).toEqual(['15m', '1m', '5m']);
      }
      expect(rows[0]).toMatchObject({ locked: false, required_plan: null });
      expect(Number(rows[0]!.actual)).toBeCloseTo(206);
      expect(Number(rows[0]!.pips_by_timeframe['5m'])).toBeCloseTo(70.37);
      expect(rows[1]).toMatchObject({ locked: false, required_plan: null });
      for (const row of rows.slice(2)) {
        expect(row).toMatchObject({
          locked: true,
          required_plan: 'PRO',
          forecast: null,
          actual: null,
          previous: null,
          surprise: null,
          surprise_direction: null,
          pips_by_timeframe: { '1m': null, '5m': null, '15m': null },
        });
      }

      // Every statistic comes from B7 / B6 only (pips 70.37 / 60.37).
      expect(body.total_events).toBe(2);
      expect(body.analyzable_events).toBe(2);
      expect(Number(body.stats.average_pips)).toBeCloseTo(65.37);
      expect(Number(body.stats.average_movement)).toBeCloseTo(0.6537);
      expect(Number(body.stats.max_movement)).toBeCloseTo(0.7037);
      expect(Number(body.stats.min_movement)).toBeCloseTo(0.6037);
      expect(body.stats).toMatchObject({ upward_count: 2, downward_count: 0, no_change_count: 0 });
      expect(body.advanced_statistics).toMatchObject({ available: false, data: null });

      const text = JSON.stringify(body);
      for (const value of LOCKED_ONLY_VALUES) expect(text, value).not.toContain(value);
    });

    it('FREE timeframe=all: stats_by_timeframe also from the unlocked rows only', async () => {
      const { headers } = await newUser('FREE');
      const { status, body } = await get(
        `/indicators/${indicatorB}/comparison?fx_pair_id=${USDJPY_FX_PAIR_ID}&timeframe=all`,
        headers,
      );
      expect(status).toBe(200);
      expect(body.total_events).toBe(2);
      expect(body.analyzable_events).toBe(2);
      expect(body.past_release_limit).toEqual({ applied: true, max_for_plan: 3, pro_max: null });
      for (const timeframe of ['1m', '5m', '15m']) {
        const entry = body.stats_by_timeframe.find((item: { timeframe: string }) => item.timeframe === timeframe);
        expect(Number(entry.stats.average_pips), timeframe).toBeCloseTo(65.37);
        expect(entry.stats.upward_count, timeframe).toBe(2);
      }
      expect((body.events as ComparisonRow[]).map((row) => row.locked)).toEqual([false, false, true, true, true]);
      const text = JSON.stringify(body);
      for (const value of LOCKED_ONLY_VALUES) expect(text, value).not.toContain(value);
    });

    it('FREE page 2: only locked rows, still no values', async () => {
      const { headers } = await newUser('FREE');
      const { body } = await get(url('&page=2&limit=3'), headers);
      expect(ids(body.events)).toEqual([B4, B3]);
      expect((body.events as ComparisonRow[]).every((row) => row.locked && row.actual === null)).toBe(true);
      expect(body.meta).toEqual({ page: 2, limit: 3, total: 5, has_next: false });
      expect(body.total_events).toBe(2);
    });

    it('PRO: every release with a snapshot (7), max 20, nothing locked, stats from all 7', async () => {
      const { headers } = await newUser('PRO');
      const { body } = await get(url(), headers);
      expect(body.total_events).toBe(7);
      expect(body.analyzable_events).toBe(7);
      expect(ids(body.events)).toEqual(B_MOST_RECENT_FIRST);
      expect((body.events as ComparisonRow[]).every((row) => !row.locked && row.required_plan === null)).toBe(true);
      expect(Number((body.events as ComparisonRow[])[2]!.pips_by_timeframe['5m'])).toBeCloseTo(50.37);
      expect(Number(body.stats.average_pips)).toBeCloseTo(40.37);
      expect(body.advanced_statistics.available).toBe(true);
      expect(body.history_limit).toEqual({ applied: 7, max_for_plan: 20, pro_max: 20 });
      expect(body.past_release_limit).toEqual({ applied: false, max_for_plan: null, pro_max: null });
    });
  });

  describe('Direct Supabase access (GRANT, migrations 20261022000001 / 20261022000003)', () => {
    /** Each locked table with one real column, for the write attempts below. */
    const MARKET_VALUE_TABLES = [
      { table: 'economic_events', column: 'provider' },
      { table: 'event_snapshots', column: 'source' },
      { table: 'event_revisions', column: 'source' },
      { table: 'event_explanations', column: 'source' },
      { table: 'event_price_reactions', column: 'data_status' },
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

    type Result = {
      data: unknown;
      error: { code?: string; message: string } | null;
      status: number;
    };

    /** Both roles an app user can reach PostgREST with. PostgREST answers a
     * privilege error (42501) with 401 for the anon role and 403 otherwise. */
    async function roles(): Promise<{ label: string; client: SupabaseClient; deniedStatus: number }[]> {
      const { user } = await newUser('FREE');
      return [
        { label: 'anon', client: anon(), deniedStatus: 401 },
        { label: 'authenticated', client: asUser(user), deniedStatus: 403 },
      ];
    }

    /**
     * A privilege error, not "0 rows" (RLS alone would answer an empty 200):
     * Postgres 42501 "permission denied for table <table>" — and not the RLS
     * error ("new row violates row-level security policy …").
     */
    function expectTableDenied(result: Result, table: string, deniedStatus: number, label: string): void {
      const detail = `${label}: ${JSON.stringify({ status: result.status, error: result.error, data: result.data })}`;
      expect(result.status, detail).toBe(deniedStatus);
      expect(result.error?.code, detail).toBe('42501');
      expect(result.error?.message, detail).toBe(`permission denied for table ${table}`);
      expect(result.data, detail).toBeNull();
    }

    it('SELECT on each of the 5 tables fails with a privilege error (anon and authenticated)', async () => {
      for (const { label, client, deniedStatus } of await roles()) {
        for (const { table } of MARKET_VALUE_TABLES) {
          const result = await client.from(table).select('*').limit(5);
          expectTableDenied(result, table, deniedStatus, `${label} select ${table}`);
        }
      }
    });

    it('a PRO user is denied the same way (the plan does not matter for direct access)', async () => {
      const { user } = await newUser('PRO');
      const client = asUser(user);
      for (const { table } of MARKET_VALUE_TABLES) {
        expectTableDenied(await client.from(table).select('*').limit(1), table, 403, `PRO select ${table}`);
      }
    });

    it('count-only requests (HEAD, count=exact) fail too — no row count leaks', async () => {
      for (const { label, client, deniedStatus } of await roles()) {
        for (const { table } of MARKET_VALUE_TABLES) {
          const result = await client.from(table).select('*', { count: 'exact', head: true });
          const detail = `${label} count ${table}: ${JSON.stringify(result)}`;
          // A HEAD response has no body, so the status is what tells the error apart.
          expect(result.status, detail).toBe(deniedStatus);
          expect(result.error, detail).not.toBeNull();
          expect(result.count, detail).toBeNull();
        }
      }
    });

    it('embedding a locked table from a still-readable table fails the whole request', async () => {
      const embeds = [
        // economic_indicators → economic_events (FK economic_events.indicator_id)
        { from: 'economic_indicators', select: 'id,economic_events(id)', locked: 'economic_events' },
        { from: 'economic_indicators', select: 'id,economic_events!inner(id)', locked: 'economic_events' },
        // fx_pairs → event_price_reactions (FK event_price_reactions.fx_pair_id)
        { from: 'fx_pairs', select: 'id,event_price_reactions(pips)', locked: 'event_price_reactions' },
      ];
      for (const { label, client, deniedStatus } of await roles()) {
        for (const embed of embeds) {
          const result = await client.from(embed.from).select(embed.select).limit(5);
          expectTableDenied(result, embed.locked, deniedStatus, `${label} ${embed.from}?select=${embed.select}`);
        }
      }
    });

    it('INSERT / UPDATE / DELETE are rejected by privilege, not only by RLS', async () => {
      for (const { label, client, deniedStatus } of await roles()) {
        for (const { table, column } of MARKET_VALUE_TABLES) {
          // The client has no generated DB types, so the row's type is not checked here.
          const row = { [column]: 'direct-write' } as never;
          const insert = await client.from(table).insert(row);
          expectTableDenied(insert, table, deniedStatus, `${label} insert ${table}`);
          const update = await client.from(table).update(row).eq(column, 'integration-test');
          expectTableDenied(update, table, deniedStatus, `${label} update ${table}`);
          const remove = await client.from(table).delete().eq(column, 'integration-test');
          expectTableDenied(remove, table, deniedStatus, `${label} delete ${table}`);
        }
      }
      // Nothing was written or removed.
      const explanation = await ctx.serviceClient.from('event_explanations').select('summary').eq('event_id', A.fourth);
      expect(explanation.data).toEqual([{ summary: 'locked-explanation-text' }]);
    });

    it('visible_released_event_ids: anon and authenticated cannot execute it', async () => {
      const args = { p_indicator_ids: [indicatorA], p_limit: 3 };
      for (const { label, client, deniedStatus } of await roles()) {
        const result = await client.rpc('visible_released_event_ids', args);
        const detail = `${label} rpc: ${JSON.stringify(result)}`;
        expect(result.status, detail).toBe(deniedStatus);
        expect(result.error?.code, detail).toBe('42501');
        expect(result.error?.message, detail).toBe('permission denied for function visible_released_event_ids');
        expect(result.data, detail).toBeNull();
      }
    });

    describe('fx_prices (migration 20261022000003)', () => {
      it('SELECT, count-only, embedding from fx_pairs and INSERT / UPDATE / DELETE all fail with 42501', async () => {
        for (const { label, client, deniedStatus } of await roles()) {
          expectTableDenied(
            await client.from('fx_prices').select('*').limit(5),
            'fx_prices',
            deniedStatus,
            `${label} select fx_prices`,
          );

          const count = await client.from('fx_prices').select('*', { count: 'exact', head: true });
          expect(count.status, `${label} count fx_prices`).toBe(deniedStatus);
          expect(count.error, `${label} count fx_prices`).not.toBeNull();
          expect(count.count, `${label} count fx_prices`).toBeNull();

          // fx_pairs stays readable, but embedding its prices fails the whole request.
          for (const select of ['id,fx_prices(close)', 'id,fx_prices!inner(timestamp,close)']) {
            expectTableDenied(
              await client.from('fx_pairs').select(select).limit(5),
              'fx_prices',
              deniedStatus,
              `${label} fx_pairs?select=${select}`,
            );
          }

          const row = { source: 'direct-write' } as never;
          expectTableDenied(
            await client.from('fx_prices').insert(row),
            'fx_prices',
            deniedStatus,
            `${label} insert fx_prices`,
          );
          expectTableDenied(
            await client.from('fx_prices').update(row).eq('fx_pair_id', USDJPY_FX_PAIR_ID),
            'fx_prices',
            deniedStatus,
            `${label} update fx_prices`,
          );
          expectTableDenied(
            await client.from('fx_prices').delete().eq('fx_pair_id', USDJPY_FX_PAIR_ID),
            'fx_prices',
            deniedStatus,
            `${label} delete fx_prices`,
          );
        }
      });

      it('service_role (the Backend and the ingestion jobs) still reads and embeds fx_prices', async () => {
        const prices = await ctx.serviceClient
          .from('fx_prices')
          .select('timestamp, close', { count: 'exact' })
          .eq('fx_pair_id', USDJPY_FX_PAIR_ID)
          .limit(1);
        expect(prices.error).toBeNull();
        expect(prices.status).toBe(200);
        const embedded = await ctx.serviceClient
          .from('fx_pairs')
          .select('id,fx_prices(close)')
          .eq('id', USDJPY_FX_PAIR_ID)
          .limit(1, { foreignTable: 'fx_prices' });
        expect(embedded.error).toBeNull();
        expect(embedded.data).toHaveLength(1);
      });
    });

    it('service_role (the Backend) still reads them, embeds them and runs the function', async () => {
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
      const embedded = await ctx.serviceClient
        .from('economic_indicators')
        .select('id,economic_events(id)')
        .eq('id', indicatorA);
      expect(embedded.error).toBeNull();
      expect((embedded.data?.[0] as { economic_events: unknown[] }).economic_events).toHaveLength(7);

      const rpc = await ctx.serviceClient.rpc('visible_released_event_ids', {
        p_indicator_ids: [indicatorA],
        p_limit: 3,
      });
      expect(rpc.error).toBeNull();
      expect(((rpc.data ?? []) as { event_id: string }[]).map((row) => row.event_id).sort()).toEqual(
        [A.first, A.second, A.third].sort(),
      );
    });

    it('economic_indicators and fx_pairs stay readable by an authenticated user', async () => {
      const { user } = await newUser('FREE');
      const client = asUser(user);
      const indicators = await client.from('economic_indicators').select('id').eq('id', indicatorA);
      expect(indicators.error).toBeNull();
      expect(indicators.data).toEqual([{ id: indicatorA }]);
      const pairs = await client.from('fx_pairs').select('id').eq('id', USDJPY_FX_PAIR_ID);
      expect(pairs.error).toBeNull();
      expect(pairs.data).toEqual([{ id: USDJPY_FX_PAIR_ID }]);
    });
  });
});
