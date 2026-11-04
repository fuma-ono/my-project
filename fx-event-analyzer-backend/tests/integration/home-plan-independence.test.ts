import { randomUUID } from 'node:crypto';
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
 * 今日の GET /home は FREE と PRO で同じ(`past_release_limit` を除く)ことを見張る
 * (HQ承認 2026-11-04「Home Cache プラン確認前表示」)。
 *
 * iOS のホームのキャッシュは、プランで内容が変わらない(`HomeCacheSnapshot.planIndependent`)ときだけ、
 * `/entitlements` でプランを確かめる前にも出す。その前提は「今日の発表は、その指標の一番新しい RELEASED なので、
 * FREE の過去の発表の制限(新しい順で3件、domain/pastReleaseAccess.ts)に当たらない」こと。
 * **このテストが落ちたら(制限の決まりや /home の項目が変わったら)、iOS の判定を見直す。**
 *
 * 自分の指標(実行ごとに別の code)に、過去の RELEASED を4件と今日の RELEASED・今日の予定を入れる。RELEASE の
 * snapshot は消せない(DB のトリガー)ので、終わったら予定と付属の行を消し、指標を無効にする。CI は毎回 DB を作り直す。
 */
describe.skipIf(!integration)('GET /home for today is the same for FREE and PRO (except past_release_limit)', () => {
  let ctx: IntegrationContext;
  const users: TestUser[] = [];
  const runId = `${Date.now()}`;
  let indicatorId = '';

  const now = Date.now();
  const today = new Date(now).toISOString().slice(0, 10);
  const startOfToday = Date.parse(`${today}T00:00:00Z`);
  const endOfToday = startOfToday + 86_400_000 - 1000;
  const iso = (ms: number) => new Date(ms).toISOString();

  // 過去の発表4件(1〜4か月前)と、今日の発表(今より少し前、ただし今日のうち)。
  const PAST = [1, 2, 3, 4].map((monthsAgo) => ({
    id: randomUUID(),
    at: iso(now - monthsAgo * 30 * 86_400_000),
    actual: 200 + monthsAgo,
  }));
  const TODAY_RELEASED = { id: randomUUID(), at: iso(Math.max(startOfToday + 1000, now - 60_000)), actual: 200 };
  const scheduledAt = Math.min(now + 3_600_000, endOfToday);
  const TODAY_SCHEDULED = scheduledAt > now ? { id: randomUUID(), at: iso(scheduledAt) } : null;

  async function newUser(plan: 'FREE' | 'PRO') {
    const user = await createTestUser(ctx);
    users.push(user);
    if (plan === 'PRO') await grantEntitlement(ctx, user.id, FEATURE_CODES.VIEW_ADVANCED_STATS);
    return { authorization: `Bearer ${user.accessToken}` };
  }

  async function getHome(headers: { authorization: string }) {
    const response = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/home?date=${today}&timezone=UTC`,
      headers,
    });
    return { status: response.statusCode, body: JSON.parse(response.body) as Record<string, unknown> };
  }

  function eventRow(id: string, at: string, status: 'RELEASED' | 'SCHEDULED') {
    return {
      id,
      indicator_id: indicatorId,
      provider: 'integration-test',
      provider_event_id: `home-plan-${runId}-${id}`,
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
      previous: actual + 1,
      unit: '%',
      source: 'integration-test',
      captured_at: at,
      surprise: 0.5,
      surprise_direction: 'POSITIVE',
    };
  }

  beforeAll(async () => {
    ctx = buildIntegrationContext(integration!);
    const { data, error } = await ctx.serviceClient
      .from('economic_indicators')
      .insert({
        code: `IT_HOME_PLAN_${runId}`,
        name: `結合テスト用指標(ホームのプラン非依存) ${runId}`,
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
    indicatorId = data.id;

    const released = [...PAST, TODAY_RELEASED];
    const events = [
      ...released.map((event) => eventRow(event.id, event.at, 'RELEASED')),
      ...(TODAY_SCHEDULED ? [eventRow(TODAY_SCHEDULED.id, TODAY_SCHEDULED.at, 'SCHEDULED')] : []),
    ];
    const { error: eventError } = await ctx.serviceClient.from('economic_events').insert(events);
    if (eventError) throw new Error(`Failed to insert test events: ${eventError.message}`);
    const { error: snapshotError } = await ctx.serviceClient
      .from('event_snapshots')
      .insert(released.map((event) => snapshotRow(event.id, event.at, event.actual)));
    if (snapshotError) throw new Error(`Failed to insert test snapshots: ${snapshotError.message}`);
  });

  afterAll(async () => {
    if (!ctx) return;
    for (const user of users) await deleteTestUser(ctx, user.id);
    if (TODAY_SCHEDULED) await ctx.serviceClient.from('economic_events').delete().eq('id', TODAY_SCHEDULED.id);
    if (indicatorId !== '') {
      await ctx.serviceClient.from('economic_indicators').update({ is_active: false }).eq('id', indicatorId);
    }
    await ctx.app.close();
  });

  it('returns the same events for FREE and PRO; only past_release_limit differs', async () => {
    const [free, pro] = await Promise.all([newUser('FREE'), newUser('PRO')]);
    const [freeHome, proHome] = await Promise.all([getHome(free), getHome(pro)]);
    expect(freeHome.status).toBe(200);
    expect(proHome.status).toBe(200);

    // 応答の一番上の項目は同じ。違ってよいのは past_release_limit だけ。
    expect(Object.keys(freeHome.body).sort()).toEqual(Object.keys(proHome.body).sort());
    expect(freeHome.body.past_release_limit).toMatchObject({ applied: true, max_for_plan: 3 });
    expect(proHome.body.past_release_limit).toMatchObject({ applied: false, max_for_plan: null });

    type HomeEvent = { event_id: string; locked: boolean; previous_locked: boolean } & Record<string, unknown>;
    const freeEvents = freeHome.body.events as HomeEvent[];
    const proEvents = proHome.body.events as HomeEvent[];

    // この指標の今日の発表(過去の発表が4件ある指標の、一番新しい RELEASED)と今日の予定。
    const ownIds = [TODAY_RELEASED.id, ...(TODAY_SCHEDULED ? [TODAY_SCHEDULED.id] : [])];
    for (const id of ownIds) {
      const freeEvent = freeEvents.find((event) => event.event_id === id);
      const proEvent = proEvents.find((event) => event.event_id === id);
      expect(freeEvent, `FREE /home has ${id}`).toBeDefined();
      expect(proEvent, `PRO /home has ${id}`).toBeDefined();
      expect(freeEvent).toEqual(proEvent);
      expect(freeEvent).toMatchObject({ locked: false, previous_locked: false });
    }
    const todayReleased = freeEvents.find((event) => event.event_id === TODAY_RELEASED.id)!;
    expect(Number(todayReleased.actual)).toBeCloseTo(TODAY_RELEASED.actual);
    expect(Number(todayReleased.previous)).toBeCloseTo(TODAY_RELEASED.actual + 1);

    // 今日のほかのイベント(seed・他のテストの行)も、両方に出ているものは同じで、FREE でもロックされていない。
    // 並行して動く他のテストが行を足し引きしても落ちないよう、両方にあるものだけを比べる。
    const proById = new Map(proEvents.map((event) => [event.event_id, event]));
    for (const event of freeEvents) {
      const other = proById.get(event.event_id);
      if (!other) continue;
      expect(event, `event ${event.event_id}`).toEqual(other);
      expect(event.locked, `event ${event.event_id} is not locked for FREE`).toBe(false);
      expect(event.previous_locked, `event ${event.event_id} is not previous-locked for FREE`).toBe(false);
    }
  });
});
