import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FEATURE_CODES } from '../../src/authorization/entitlements.js';
import { listMinuteCandleCompleteness } from '../../src/repositories/historicalRepository.js';
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
 * HQ指示(2026-11-07「1分足欠損への対応」): 値動きつきの4回には、15分・60分のブレイク判定が揚がるよ1分足を
 * 60本(VERIFIED)ずつ入れておく(揃っていなければ全部nullになり、既存のbreaks_15m/60mの件数の想定が崩れるため)。
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

  /** `count`本の1分足(VERIFIED、releaseAtの直後から1分ごと)。価格はダミー(ブレイク判定はevent_price_reactionsの
   * max_upward/max_downwardで決まり、ここでは窓の本数とverification_statusだけが意味を持つ)。 */
  function minuteCandles(fxPairId: string, releaseAt: string, count: number, verificationStatus = 'VERIFIED') {
    const startMs = Date.parse(releaseAt);
    return Array.from({ length: count }, (_, i) => ({
      fx_pair_id: fxPairId,
      timestamp: new Date(startMs + i * 60_000).toISOString(),
      timeframe: '1m' as const,
      open: 150,
      high: 150,
      low: 150,
      close: 150,
      volume: 0,
      source: 'integration-test',
      verification_status: verificationStatus,
    }));
  }

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
    // HQ指示(2026-11-07): 値動きつきの4回(past[0..3])には、15分・60分のブレイク判定が通るよゆ1分足を60本(VERIFIED)入れる。
    const candleRows = moves.flatMap((_, i) => minuteCandles(usdjpyId, past[i]!.at, 60));
    const { error: candleError } = await ctx.serviceClient.from('fx_prices').insert(candleRows);
    if (candleError) throw candleError;
  });

  afterAll(async () => {
    if (!ctx) return;
    for (const user of users) await deleteTestUser(ctx, user.id);
    await ctx.serviceClient
      .from('fx_prices')
      .delete()
      .eq('fx_pair_id', usdjpyId)
      .gte('timestamp', '2090-01-01T00:00:00.000Z')
      .lt('timestamp', '2091-01-01T00:00:00.000Z');
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
    expect(newest).toMatchObject({
      direction_1m: null,
      pattern_15m: null,
      high_break_15m: null,
      round_trip_15m: null, // HQ指示2026-11-10 STEP3: 高値・安値のどちらかが判定できなければ往復もnull
      sell_the_fact: null,
      pips_5m: null, // 5分の値動きは今回のテストデータに無い(保存が無ければnull。作らない)
    });
    expect(analysis.releases[1]).toMatchObject({
      direction_1m: 'UP',
      high_break_15m: true,
      low_break_15m: false,
      round_trip_15m: false, // HQ指示2026-11-10 STEP3: 高値だけ抜けた(安値は抜いていない)ので往復ではない
      sell_the_fact: null,
    });
    expect(analysis.summary).toMatchObject({
      direction_1m: { up: 3, down: 1, flat: 0, samples: 4 },
      pattern_15m: { continuation: 3, reversal: 1, samples: 4 },
      breaks_15m: { high: 2, low: 2, both: 0, neither: 0, samples: 4 },
      sell_the_fact: { occurred: 2, samples: 3 },
      // HQ指示(2026-11-09 P0): 初動は USD 高 → 15分で USD 安 は 2回目(+4 → -9)だけ。1回目は続伸、3回目は初動が USD 安
      sell_the_fact_after_initial_rise: { occurred: 1, samples: 3 },
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
      sell_the_fact_after_initial_rise: null,
    });
  });

  it('404 for an unknown event, 404 for an unknown fx pair', async () => {
    const headers = await asUser('PRO');
    expect((await get(randomUUID(), headers)).status).toBe(404);
    expect((await get(targetId, headers, `?fx_pair_id=${randomUUID()}`)).status).toBe(404);
  });

  describe('同時発表イベントのグループ化(HQ指示 2026-11-10「重複排除・集計改善・AI分析基盤の整備」STEP1)', () => {
    let siblingIndicatorId = '';
    const siblingIndicatorCode = `IT_STRATEGY_SIBLING_${runId}`;
    const siblingEventId = randomUUID();

    beforeAll(async () => {
      const { data, error } = await ctx.serviceClient
        .from('economic_indicators')
        .insert({
          code: siblingIndicatorCode,
          name: `結合テスト用指標(同時発表の相手) ${runId}`,
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
      if (error) throw error;
      siblingIndicatorId = data.id;
      // targetId と同じ provider・release_datetime(同時発表)。指標は別(重複排除・グループ化の対象)。
      const { error: eventError } = await ctx.serviceClient.from('economic_events').insert({
        id: siblingEventId,
        indicator_id: siblingIndicatorId,
        provider: 'integration-test',
        provider_event_id: `strategy-sibling-${runId}`,
        release_datetime: '2099-01-10T13:30:00.000Z', // targetId と同じ瞬間
        release_datetime_precision: 'EXACT',
        importance: 'HIGH',
        status: 'SCHEDULED',
        data_status: 'PENDING',
      });
      if (eventError) throw eventError;
    });

    afterAll(async () => {
      await ctx.serviceClient.from('economic_events').delete().eq('id', siblingEventId);
      if (siblingIndicatorId !== '')
        await ctx.serviceClient.from('economic_indicators').update({ is_active: false }).eq('id', siblingIndicatorId);
    });

    it('同じ provider・release_datetime の他の指標を co_released_indicators に返す(重複を見分けられるようにする)', async () => {
      const { status, body } = await get(targetId, await asUser('PRO'));
      expect(status).toBe(200);
      expect(body.co_released_indicators).toEqual([
        { indicator_id: siblingIndicatorId, indicator_code: siblingIndicatorCode },
      ]);
      // HQ指示(2026-11-10「実動作検証」STEP2「最重要」): summarizeMarketEventCoverageが実際の応答に反映され、
      // 「指標は2つ(自分＋同時発表の相手)だが、独立した市場イベントとしては1つ」であることを示す。
      expect(body.market_event_coverage).toEqual({ independent_market_events: 1, indicator_count: 2 });
    });

    it('同時発表が無い発表(sparseTargetId)は空配列・indicator_countは1', async () => {
      const { body } = await get(sparseTargetId, await asUser('PRO'));
      expect(body.co_released_indicators).toEqual([]);
      expect(body.market_event_coverage).toEqual({ independent_market_events: 1, indicator_count: 1 });
    });
  });

  describe('release_datetime_precision が EXACT でない発表は同時発表と誤判定しない(HQ指示 2026-11-10「実動作検証」で発見・修正)', () => {
    // mappings/eurostatSchedule.ts の実例(EU_HICP・EU_UNEMPLOYMENT_RATE、どちらもAPPROXIMATE・11:00
    // Europe/Luxembourgで、発表日が偶然重なる行が実在する)を再現する。同じ provider・release_datetime でも、
    // 時刻が確認できない(EXACTでない)場合は別々の市場イベントとして扱わなければならない。
    let approxIndicatorId = '';
    let approxOtherIndicatorId = '';
    const approxTargetId = randomUUID();
    const approxOtherId = randomUUID();

    beforeAll(async () => {
      const makeIndicator = async (code: string, name: string) => {
        const { data, error } = await ctx.serviceClient
          .from('economic_indicators')
          .insert({
            code,
            name,
            country_code: 'EU',
            currency_code: 'EUR',
            importance: 'HIGH',
            frequency: 'MONTHLY',
            unit: '%',
            favorable_direction: 'HIGHER_IS_POSITIVE',
            is_active: true,
          })
          .select('id')
          .single();
        if (error) throw error;
        return data.id as string;
      };
      approxIndicatorId = await makeIndicator(
        `IT_STRATEGY_APPROX_COINCIDE_A_${runId}`,
        `結合テスト用指標(APPROXIMATEの偶然の一致A) ${runId}`,
      );
      approxOtherIndicatorId = await makeIndicator(
        `IT_STRATEGY_APPROX_COINCIDE_B_${runId}`,
        `結合テスト用指標(APPROXIMATEの偶然の一致B) ${runId}`,
      );
      const { error: eventError } = await ctx.serviceClient.from('economic_events').insert([
        {
          id: approxTargetId,
          indicator_id: approxIndicatorId,
          provider: 'integration-test-eurostat',
          provider_event_id: `strategy-approx-coincide-a-${runId}`,
          release_datetime: '2099-02-10T11:00:00.000Z',
          release_datetime_precision: 'APPROXIMATE',
          importance: 'HIGH',
          status: 'SCHEDULED',
          data_status: 'PENDING',
        },
        {
          id: approxOtherId,
          indicator_id: approxOtherIndicatorId,
          provider: 'integration-test-eurostat',
          provider_event_id: `strategy-approx-coincide-b-${runId}`,
          release_datetime: '2099-02-10T11:00:00.000Z', // approxTargetIdと全く同じ(偶然の一致)。別指標・別発表。
          release_datetime_precision: 'APPROXIMATE',
          importance: 'HIGH',
          status: 'SCHEDULED',
          data_status: 'PENDING',
        },
      ]);
      if (eventError) throw eventError;
    });

    afterAll(async () => {
      await ctx.serviceClient.from('economic_events').delete().in('id', [approxTargetId, approxOtherId]);
      for (const id of [approxIndicatorId, approxOtherIndicatorId]) {
        if (id !== '') await ctx.serviceClient.from('economic_indicators').update({ is_active: false }).eq('id', id);
      }
    });

    it('provider・release_datetimeが完全一致していても、precisionがAPPROXIMATEなら同時発表に含めない', async () => {
      const { status, body } = await get(approxTargetId, await asUser('PRO'));
      expect(status).toBe(200);
      expect(body.co_released_indicators).toEqual([]);
      expect(body.market_event_coverage).toEqual({ independent_market_events: 1, indicator_count: 1 });
    });
  });

  describe('通貨ペアの選択・並び順(HQ指示 2026-11-09 P0)', () => {
    let eurusdId = '';
    let eurjpyId = '';

    beforeAll(async () => {
      const { data, error } = await ctx.serviceClient
        .from('fx_pairs')
        .select('id, symbol')
        .in('symbol', ['EURUSD', 'EURJPY']);
      if (error) throw error;
      eurusdId = data.find((p) => p.symbol === 'EURUSD')!.id;
      eurjpyId = data.find((p) => p.symbol === 'EURJPY')!.id;
      // USDJPY と同じ priority(1)で EURUSD も関連づける。並びは入れた順でなく、主要ペアの順(USDJPY が先)で決まる
      const { error: linkError } = await ctx.serviceClient
        .from('indicator_fx_pairs')
        .insert({ indicator_id: indicatorId, fx_pair_id: eurusdId, priority: 1 });
      if (linkError) throw linkError;
    });

    afterAll(async () => {
      await ctx.serviceClient
        .from('indicator_fx_pairs')
        .delete()
        .eq('indicator_id', indicatorId)
        .eq('fx_pair_id', eurusdId);
    });

    it('同じ priority のペアがあっても、既定のペアは毎回 USDJPY(主要ペアの順)', async () => {
      const headers = await asUser('PRO');
      for (let i = 0; i < 3; i += 1) {
        const { body } = await get(targetId, headers);
        expect(body.fx_pair).toEqual({ fx_pair_id: usdjpyId, symbol: 'USDJPY' });
      }
    });

    it('?fx_pair_id は、有効で指標の通貨(USD)を含むペアなら使う。含まないペア(EURJPY)は 404', async () => {
      const headers = await asUser('PRO');
      const eurusd = await get(targetId, headers, `?fx_pair_id=${eurusdId}`);
      expect(eurusd.status).toBe(200);
      expect(eurusd.body.fx_pair).toEqual({ fx_pair_id: eurusdId, symbol: 'EURUSD' });
      // 修正前は EURJPY でも 200 で、値動きが計算されないペアの「全部 null」が返っていた
      const eurjpy = await get(targetId, headers, `?fx_pair_id=${eurjpyId}`);
      expect(eurjpy.status).toBe(404);
    });
  });

  describe('EXACT でない発表は Sell the Fact に入れない(HQ指示 2026-11-09 P0)', () => {
    let approxIndicatorId = '';
    const approxTargetId = randomUUID();
    const approxPast = [1, 2, 3].map((n) => ({ id: randomUUID(), at: `2091-0${n}-10T10:00:00.000Z` }));

    beforeAll(async () => {
      const { data, error } = await ctx.serviceClient
        .from('economic_indicators')
        .insert({
          code: `IT_STRATEGY_APPROX_${runId}`,
          name: `結合テスト用指標(戦略分析・時刻がおおよそ) ${runId}`,
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
      if (error) throw error;
      approxIndicatorId = data.id;
      const { error: linkError } = await ctx.serviceClient
        .from('indicator_fx_pairs')
        .insert({ indicator_id: approxIndicatorId, fx_pair_id: usdjpyId, priority: 1 });
      if (linkError) throw linkError;
      const event = (id: string, at: string, status: 'RELEASED' | 'SCHEDULED') => ({
        id,
        indicator_id: approxIndicatorId,
        provider: 'integration-test',
        provider_event_id: `strategy-approx-${runId}-${id}`,
        release_datetime: at,
        release_datetime_precision: 'APPROXIMATE',
        importance: 'HIGH',
        status,
        data_status: status === 'RELEASED' ? 'AVAILABLE' : 'PENDING',
      });
      const { error: eventError } = await ctx.serviceClient
        .from('economic_events')
        .insert([
          ...approxPast.map((p) => event(p.id, p.at, 'RELEASED')),
          event(approxTargetId, '2091-12-10T10:00:00.000Z', 'SCHEDULED'),
        ]);
      if (eventError) throw eventError;
      // 3回とも結果が予想を上回った(USD にとって良い)
      const { error: snapshotError } = await ctx.serviceClient.from('event_snapshots').insert(
        approxPast.map((p) => ({
          event_id: p.id,
          snapshot_type: 'RELEASE',
          forecast: 3.0,
          actual: 3.2,
          previous: 3.0,
          unit: '%',
          source: 'integration-test',
          captured_at: '2091-01-01T00:00:00Z',
          surprise: 0.2,
          surprise_direction: 'POSITIVE',
        })),
      );
      if (snapshotError) throw snapshotError;
      // APPROXIMATE は1分の値動きが作られず(domain/dataQuality.ts)、15分だけがある。15分後は USD 安
      const { error: reactionError } = await ctx.serviceClient.from('event_price_reactions').insert(
        approxPast.map((p) => ({
          event_id: p.id,
          fx_pair_id: usdjpyId,
          timeframe: '15m',
          pips: -9,
          max_upward: 0,
          max_downward: -0.1,
          data_status: 'AVAILABLE',
        })),
      );
      if (reactionError) throw reactionError;
    });

    afterAll(async () => {
      await ctx.serviceClient
        .from('event_price_reactions')
        .delete()
        .in(
          'event_id',
          approxPast.map((p) => p.id),
        );
      await ctx.serviceClient.from('economic_events').delete().eq('id', approxTargetId);
      if (approxIndicatorId !== '')
        await ctx.serviceClient.from('economic_indicators').update({ is_active: false }).eq('id', approxIndicatorId);
    });

    it('15分の値動きと好結果があっても、発表ごと・要約とも Sell the Fact は null', async () => {
      const { status, body } = await get(approxTargetId, await asUser('PRO'));
      expect(status).toBe(200);
      const analysis = body.analysis as {
        status: string;
        releases: Record<string, unknown>[];
        summary: Record<string, unknown>;
      };
      expect(analysis.releases).toHaveLength(3);
      for (const release of analysis.releases) {
        expect(release).toMatchObject({
          pips_15m: -9,
          surprise_direction: 'POSITIVE',
          sell_the_fact: null,
          sell_the_fact_after_initial_rise: null,
        });
      }
      // 修正前は「3回中3回」と出ていた
      expect(analysis.summary).toMatchObject({ sell_the_fact: null, sell_the_fact_after_initial_rise: null });
      expect(analysis.status).toBe('DATA_PREPARING');
    });
  });

  describe('listMinuteCandleCompleteness (1分足の欠損・UNVERIFIEDの除外、HQ指示 2026-11-07)', () => {
    // past配列・既存の件数想定とは独立した、専用の発表時刻で確かめる(他のテストに影響しない)。
    const releaseAt = '2090-06-10T12:30:00.000Z';
    const fakeEventId = randomUUID(); // listMinuteCandleCompletenessはevent_idをキーにするだけで、他の表は読まない。

    afterAll(async () => {
      await ctx.serviceClient
        .from('fx_prices')
        .delete()
        .eq('fx_pair_id', usdjpyId)
        .gte('timestamp', releaseAt)
        .lt('timestamp', '2090-07-01T00:00:00.000Z');
    });

    it('15本・60本すべて揃い、UNVERIFIEDが無ければ両方true', async () => {
      await ctx.serviceClient.from('fx_prices').insert(minuteCandles(usdjpyId, releaseAt, 60));
      const result = await listMinuteCandleCompleteness(
        ctx.serviceClient,
        [{ event_id: fakeEventId, release_datetime: releaseAt }],
        usdjpyId,
      );
      expect(result.get(fakeEventId)).toEqual({ complete15m: true, complete60m: true });
      await ctx.serviceClient.from('fx_prices').delete().eq('fx_pair_id', usdjpyId).gte('timestamp', releaseAt);
    });

    it('15分の窓に1分足が1本でも欠けていればcomplete15mはfalse(60分は揃っていればtrueのまま)', async () => {
      // 15分の窓のうち1本(8分目)を欠かす = 59本挿入。
      const rows = minuteCandles(usdjpyId, releaseAt, 60).filter((_, i) => i !== 7);
      await ctx.serviceClient.from('fx_prices').insert(rows);
      const result = await listMinuteCandleCompleteness(
        ctx.serviceClient,
        [{ event_id: fakeEventId, release_datetime: releaseAt }],
        usdjpyId,
      );
      expect(result.get(fakeEventId)).toEqual({ complete15m: false, complete60m: false });
      await ctx.serviceClient.from('fx_prices').delete().eq('fx_pair_id', usdjpyId).gte('timestamp', releaseAt);
    });

    it('15分の窓は揃っていて60分の窓だけ欠けていれば、15分はtrue、60分はfalse', async () => {
      // 60本のうち50分目(15分の窓の外)を1本欠かす = 59本挿入。
      const rows = minuteCandles(usdjpyId, releaseAt, 60).filter((_, i) => i !== 49);
      await ctx.serviceClient.from('fx_prices').insert(rows);
      const result = await listMinuteCandleCompleteness(
        ctx.serviceClient,
        [{ event_id: fakeEventId, release_datetime: releaseAt }],
        usdjpyId,
      );
      expect(result.get(fakeEventId)).toEqual({ complete15m: true, complete60m: false });
      await ctx.serviceClient.from('fx_prices').delete().eq('fx_pair_id', usdjpyId).gte('timestamp', releaseAt);
    });

    it('本数は揃っていても、15分の窓の中に1本でもUNVERIFIEDがあればcomplete15m・complete60mともfalse', async () => {
      const rows = minuteCandles(usdjpyId, releaseAt, 60).map((row, i) =>
        i === 3 ? { ...row, verification_status: 'UNVERIFIED' } : row,
      );
      await ctx.serviceClient.from('fx_prices').insert(rows);
      const result = await listMinuteCandleCompleteness(
        ctx.serviceClient,
        [{ event_id: fakeEventId, release_datetime: releaseAt }],
        usdjpyId,
      );
      expect(result.get(fakeEventId)).toEqual({ complete15m: false, complete60m: false });
      await ctx.serviceClient.from('fx_prices').delete().eq('fx_pair_id', usdjpyId).gte('timestamp', releaseAt);
    });

    it('UNVERIFIEDが15分の窓の外(60分の窓の中)だけにあれば、15分はtrue、60分はfalse', async () => {
      const rows = minuteCandles(usdjpyId, releaseAt, 60).map((row, i) =>
        i === 40 ? { ...row, verification_status: 'UNVERIFIED' } : row,
      );
      await ctx.serviceClient.from('fx_prices').insert(rows);
      const result = await listMinuteCandleCompleteness(
        ctx.serviceClient,
        [{ event_id: fakeEventId, release_datetime: releaseAt }],
        usdjpyId,
      );
      expect(result.get(fakeEventId)).toEqual({ complete15m: true, complete60m: false });
      await ctx.serviceClient.from('fx_prices').delete().eq('fx_pair_id', usdjpyId).gte('timestamp', releaseAt);
    });

    it('1分足が1本も無ければ両方false(欠損をfalseで返す。例外を投げない)', async () => {
      const result = await listMinuteCandleCompleteness(
        ctx.serviceClient,
        [{ event_id: fakeEventId, release_datetime: releaseAt }],
        usdjpyId,
      );
      expect(result.get(fakeEventId)).toEqual({ complete15m: false, complete60m: false });
    });
  });
});
