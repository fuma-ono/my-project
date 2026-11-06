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
 * GET /events/{id}/strategy-analysis(Pro イベント別トレード戦略分析、HQ指示 2026-11-06、api-design v1.48)を本物の Postgres で
 * 確かめる。自分の指標(実行ごとに別の code、通貨 USD、関連の通貨ペア USDJPY)に、過去の RELEASED を4回(値動きつき)と、
 * 値動きの無い RELEASED を1回、これからの予定を1回入れる。日付は 2090 年代(ほかのテストの期間に入らない)。
 * RELEASE の snapshot は消せないので、終わったら値動きを消し、指標を無効にする(CI は毎回 DB を作り直す)。
 */
describe.skipIf(!integration)('GET /events/{id}/strategy-analysis', () => {
  let ctx: IntegrationContext;
  const users: TestUser[] = [];
  const runId = `${Date.now()}`;
  let indicatorId = '';
  let usdjpyId = '';
  const targetId = randomUUID();
  const sparseTargetId = randomUUID();
  const past = [1, 2, 3, 4, 5].map((n) => ({ id: randomUUID(), at: `2090-0${n}-10T12:30:00.000Z` }));

  async function asUser(plan: 'FREE' | 'PRO') {
    const user = await createTestUser(ctx);
    users.push(user);
    await grantEntitlement(ctx, user.id, FEATURE_CODES.VIEW_BASIC_EVENT);
    if (plan === 'PRO') await grantEntitlement(ctx, user.id, FEATURE_CODES.VIEW_ADVANCED_STATS);
    return { authorization: `Bearer ${user.accessToken}` };
  }

  async function get(eventId: string, headers: { authorization: string }, query = '') {
    const response = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/events/${eventId}/strategy-analysis${query}`,
      headers,
    });
    return { status: response.statusCode, body: JSON.parse(response.body) as Record<string, unknown> };
  }

  beforeAll(async () => {
    ctx = buildIntegrationContext(integration!);
    const { data: pair, error: pairError } = await ctx.serviceClient
      .from('fx_pairs')
      .select('id')
      .eq('symbol', 'USDJPY')
      .single();
    if (pairError) throw pairError;
    usdjpyId = pair.id;
    const { data, error } = await ctx.serviceClient
      .from('economic_indicators')
      .insert({
        code: `IT_STRATEGY_${runId}`,
        name: `結合テスト用指標(戦略分析) ${runId}`,
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
    const { error: linkError } = await ctx.serviceClient
      .from('indicator_fx_pairs')
      .insert({ indicator_id: indicatorId, fx_pair_id: usdjpyId, priority: 1 });
    if (linkError) throw linkError;

    const event = (id: string, at: string, status: 'RELEASED' | 'SCHEDULED') => ({
      id,
      indicator_id: indicatorId,
      provider: 'integration-test',
      provider_event_id: `strategy-${runId}-${id}`,
      release_datetime: at,
      release_datetime_precision: 'EXACT',
      importance: 'HIGH',
      status,
      data_status: status === 'RELEASED' ? 'AVAILABLE' : 'PENDING',
    });
    const { error: eventError } = await ctx.serviceClient.from('economic_events').insert([
      ...past.map((p) => event(p.id, p.at, 'RELEASED')),
      event(targetId, '2099-01-10T13:30:00.000Z', 'SCHEDULED'),
      event(sparseTargetId, '2090-03-01T00:00:00.000Z', 'SCHEDULED'), // この前の発表は2回だけ
    ]);
    if (eventError) throw eventError;
    // 1・2・3回目は結果が予想を上回った(USD にとって良い)。4回目は予想なし。5回目は予想を下回った。
    const snapshot = (eventId: string, forecast: number | null, actual: number, direction: string | null) => ({
      event_id: eventId,
      snapshot_type: 'RELEASE',
      forecast,
      actual,
      previous: actual,
      unit: '%',
      source: 'integration-test',
      captured_at: '2090-01-01T00:00:00Z',
      surprise: forecast === null ? null : actual - forecast,
      surprise_direction: direction,
    });
    const { error: snapshotError } = await ctx.serviceClient
      .from('event_snapshots')
      .insert([
        snapshot(past[0]!.id, 3.0, 3.2, 'POSITIVE'),
        snapshot(past[1]!.id, 3.0, 3.1, 'POSITIVE'),
        snapshot(past[2]!.id, 3.0, 3.3, 'POSITIVE'),
        snapshot(past[3]!.id, null, 3.0, null),
        snapshot(past[4]!.id, 3.0, 2.8, 'NEGATIVE'),
      ]);
    if (snapshotError) throw snapshotError;
    // 値動き(USDJPY): [1分 pips, 15分 pips, 1分 高/安, 15分 高/安](価格の幅)。5回目は値動き無し。
    const moves: [number, number, number, number, number, number][] = [
      [5, 10, 0.05, -0.01, 0.12, -0.01], // 上昇が続き、上に抜けた。USD 高 → Sell the Fact ではない
      [4, -9, 0.04, 0.0, 0.04, -0.1], // 反転・下に抜けた。USD 安 → Sell the Fact
      [-3, -6, 0.0, -0.03, 0.0, -0.07], // 下落が続き、下に抜けた。USD 安 → Sell the Fact
      [6, 8, 0.06, 0.0, 0.09, 0.0], // 上に抜けた(予想なし)
    ];
    const rows = moves.flatMap(([p1, p15, up1, dn1, up15, dn15], i) =>
      (
        [
          ['1m', p1, up1, dn1],
          ['15m', p15, up15, dn15],
          ['60m', p15, up15, dn15],
        ] as const
      ).map(([timeframe, pips, up, down]) => ({
        event_id: past[i]!.id,
        fx_pair_id: usdjpyId,
        timeframe,
        pips,
        max_upward: up,
        max_downward: down,
        data_status: 'AVAILABLE',
      })),
    );
    const { error: reactionError } = await ctx.serviceClient.from('event_price_reactions').insert(rows);
    if (reactionError) throw reactionError;
  });

  afterAll(async () => {
    if (!ctx) return;
    for (const user of users) await deleteTestUser(ctx, user.id);
    await ctx.serviceClient
      .from('event_price_reactions')
      .delete()
      .in(
        'event_id',
        past.map((p) => p.id),
      );
    await ctx.serviceClient.from('economic_events').delete().in('id', [targetId, sparseTargetId]);
    if (indicatorId !== '')
      await ctx.serviceClient.from('economic_indicators').update({ is_active: false }).eq('id', indicatorId);
    await ctx.app.close();
  });

  it('FREE: a locked response (available: false), no analysis', async () => {
    const { status, body } = await get(targetId, await asUser('FREE'));
    expect(status).toBe(200);
    expect(body).toEqual({
      event_id: targetId,
      available: false,
      required_entitlement: 'VIEW_ADVANCED_STATS',
      fx_pair: null,
      analysis: null,
    });
  });

  it('PRO: counts the stored reactions of the 5 previous releases, with nulls where data is missing', async () => {
    const { status, body } = await get(targetId, await asUser('PRO'));
    expect(status).toBe(200);
    expect(body).toMatchObject({ available: true, fx_pair: { fx_pair_id: usdjpyId, symbol: 'USDJPY' } });
    const analysis = body.analysis as {
      status: string;
      releases: Record<string, unknown>[];
      summary: Record<string, unknown>;
    };
    expect(analysis.status).toBe('READY');
    // 新しい順(2090-05 → 2090-01)
    expect(analysis.releases.map((r) => r.event_id)).toEqual([...past].reverse().map((p) => p.id));
    const newest = analysis.releases[0]!; // 5回目: 値動き無し
    expect(newest).toMatchObject({ direction_1m: null, pattern_15m: null, high_break_15m: null, sell_the_fact: null });
    expect(analysis.releases[1]).toMatchObject({
      direction_1m: 'UP',
      high_break_15m: true,
      low_break_15m: false,
      sell_the_fact: null,
    });
    expect(analysis.summary).toMatchObject({
      direction_1m: { up: 3, down: 1, flat: 0, samples: 4 },
      pattern_15m: { continuation: 3, reversal: 1, samples: 4 },
      breaks_15m: { high: 2, low: 2, both: 0, neither: 0, samples: 4 },
      sell_the_fact: { occurred: 2, samples: 3 },
    });
  });

  it('PRO: DATA_PREPARING with no tendency when fewer than 3 previous releases can be compared', async () => {
    const { body } = await get(sparseTargetId, await asUser('PRO'));
    const analysis = body.analysis as { status: string; releases: unknown[]; summary: Record<string, unknown> };
    expect(analysis.status).toBe('DATA_PREPARING');
    expect(analysis.releases).toHaveLength(2);
    expect(analysis.summary).toEqual({
      direction_1m: null,
      breaks_15m: null,
      breaks_60m: null,
      pattern_15m: null,
      sell_the_fact: null,
    });
  });

  it('404 for an unknown event, 404 for an unknown fx pair', async () => {
    const headers = await asUser('PRO');
    expect((await get(randomUUID(), headers)).status).toBe(404);
    expect((await get(targetId, headers, `?fx_pair_id=${randomUUID()}`)).status).toBe(404);
  });
});
