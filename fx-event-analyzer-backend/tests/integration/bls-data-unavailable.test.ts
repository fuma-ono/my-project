import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FEATURE_CODES } from '../../src/authorization/entitlements.js';
import type { BlsDataUnavailableEntry } from '../../src/ingestion/mappings/blsDataUnavailable.js';
import { applyBlsDataUnavailable } from '../../src/ingestion/pipelines/blsDataUnavailable.js';
import { JobCounters } from '../../src/ingestion/runner.js';
import type { OfficialObservation } from '../../src/ingestion/types.js';
import { createBlsDataUnavailableStore } from '../../src/repositories/blsDataUnavailableRepository.js';
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
 * CPI DATA_UNAVAILABLE(案A、HQ指示 2026-11-11)を本物の DB と GET /events/{id} で確かめる。
 * 本番の表の回(2026-10)ではなく、このテストだけの指標と回(2018-10、表と同じ形)で行い、終わったら全部消す
 * (US_CPI の行・スナップショットは作らない。ほかのテストの件数に影響しない)。
 */
describe.skipIf(!integration)('BLS DATA_UNAVAILABLE release: DB state and the API', () => {
  let ctx: IntegrationContext;
  let user: TestUser;
  let indicatorId = '';
  const code = `IT_BLS_UNAVAIL_${Date.now()}`;
  const unavailableId = randomUUID();
  const normalId = randomUUID();
  const release = '2018-11-14T13:30:00.000Z';
  const entry: BlsDataUnavailableEntry = {
    // 表の型は US_CPI / US_CORE_CPI だけ。provider_event_id の組み立てに使うだけなので、テスト用の指標の code を入れる
    indicatorCode: code as BlsDataUnavailableEntry['indicatorCode'],
    referencePeriod: '2018-10',
    releaseDate: '2018-11-14',
    releaseDatetimeUtc: release,
    missingPeriod: '2017-10',
    seriesId: 'CUUR0000SA0',
    reason: 'BLSが2017年10月の指数を公表していないため、2018年10月分の前年比を計算できません。(テスト)',
    source: 'U.S. Bureau of Labor Statistics',
    sourceUrl: 'https://data.bls.gov/timeseries/CUUR0000SA0',
    checkedAt: '2026-11-11',
  };
  const observation = (periodStart: string, value: number | null): OfficialObservation => ({
    source: 'BLS',
    seriesId: 'CUUR0000SA0',
    periodStart,
    value,
    asOfDate: '2018-11-15',
    releaseStatus: 'UNKNOWN',
  });
  const observations = [observation('2017-10-01', null), observation('2018-10-01', 252.885)];
  const eventRow = (id: string, key: string, releaseIso: string, status: string, dataStatus: string) => ({
    id,
    indicator_id: indicatorId,
    provider: 'bls_schedule',
    provider_event_id: `bls_schedule:${code}:${key}`,
    release_datetime: releaseIso,
    release_datetime_precision: 'EXACT',
    importance: 'HIGH',
    status,
    data_status: dataStatus,
  });
  const run = () =>
    applyBlsDataUnavailable(
      {
        store: createBlsDataUnavailableStore(ctx.serviceClient),
        entries: [entry],
        observations,
        now: () => new Date('2018-11-15T00:00:00Z'),
      },
      new JobCounters(),
    );

  beforeAll(async () => {
    ctx = buildIntegrationContext(integration!);
    const ind = await ctx.serviceClient
      .from('economic_indicators')
      .insert({
        code,
        name: `結合テスト用指標(BLS DATA_UNAVAILABLE) ${code}`,
        country_code: 'US',
        currency_code: 'USD',
        importance: 'HIGH',
        frequency: 'MONTHLY',
        unit: '%',
        source: 'U.S. Bureau of Labor Statistics',
        favorable_direction: 'HIGHER_IS_POSITIVE',
      })
      .select('id')
      .single();
    if (ind.error) throw ind.error;
    indicatorId = ind.data.id;
    const { error } = await ctx.serviceClient.from('economic_events').insert([
      eventRow(unavailableId, '2018-10', release, 'SCHEDULED', 'PENDING'),
      // 比べる相手: 通常の発表済み(RELEASED・AVAILABLE)
      eventRow(normalId, '2018-09', '2018-10-11T12:30:00.000Z', 'RELEASED', 'AVAILABLE'),
    ]);
    if (error) throw error;
    user = await createTestUser(ctx);
    await grantEntitlement(ctx, user.id, FEATURE_CODES.VIEW_BASIC_EVENT);
    await grantEntitlement(ctx, user.id, FEATURE_CODES.VIEW_ADVANCED_STATS); // 過去の発表のロックを外す
  });

  afterAll(async () => {
    if (!ctx) return;
    await ctx.serviceClient.from('event_explanations').delete().in('event_id', [unavailableId, normalId]);
    await ctx.serviceClient.from('economic_events').delete().in('id', [unavailableId, normalId]);
    if (indicatorId) await ctx.serviceClient.from('economic_indicators').delete().eq('id', indicatorId);
    if (user) await deleteTestUser(ctx, user.id);
    await ctx.app.close();
  });

  it('writes RELEASED / UNAVAILABLE and one explanation, no snapshot; a re-run changes nothing', async () => {
    expect((await run()).applied).toEqual([`${code}:2018-10`]);
    expect((await run()).unchanged).toEqual([`${code}:2018-10`]);
    const { data: ev } = await ctx.serviceClient
      .from('economic_events')
      .select('status, data_status')
      .eq('id', unavailableId)
      .single();
    expect(ev).toEqual({ status: 'RELEASED', data_status: 'UNAVAILABLE' });
    const { data: snaps } = await ctx.serviceClient.from('event_snapshots').select('id').eq('event_id', unavailableId);
    expect(snaps).toEqual([]);
    const { data: ex } = await ctx.serviceClient
      .from('event_explanations')
      .select('version, explanation_type, summary, source, source_url, published_at')
      .eq('event_id', unavailableId);
    expect(ex).toHaveLength(1);
    expect(ex![0]).toMatchObject({
      version: 1,
      explanation_type: 'FACT_SUMMARY',
      summary: entry.reason,
      source: 'U.S. Bureau of Labor Statistics',
      source_url: 'https://data.bls.gov/timeseries/CUUR0000SA0',
    });
    expect(Date.parse(String(ex![0]!.published_at))).toBe(Date.parse(release));
  });

  it('10. the API tells DATA_UNAVAILABLE apart from a normal release (status RELEASED in both)', async () => {
    const headers = { authorization: `Bearer ${user.accessToken}` };
    const unavailable = await ctx.app.inject({ method: 'GET', url: `/api/v1/events/${unavailableId}`, headers });
    expect(unavailable.statusCode).toBe(200);
    const u = unavailable.json<{
      event: Record<string, unknown>;
      snapshot: unknown;
      analysis: Record<string, unknown>;
      explanation: Record<string, unknown> | null;
    }>();
    expect(u.event).toMatchObject({ status: 'RELEASED', data_status: 'DATA_UNAVAILABLE' });
    expect(u.snapshot).toBeNull(); // 実績値なし
    expect(u.analysis).toMatchObject({ surprise: null, surprise_direction: null }); // サプライズを出さない
    expect(u.explanation).toMatchObject({ summary: entry.reason, source: 'U.S. Bureau of Labor Statistics' });

    const normal = await ctx.app.inject({ method: 'GET', url: `/api/v1/events/${normalId}`, headers });
    expect(normal.statusCode).toBe(200);
    const n = normal.json<{ event: Record<string, unknown>; explanation: unknown }>();
    expect(n.event).toMatchObject({ status: 'RELEASED', data_status: 'READY' });
    expect(n.explanation).toBeNull(); // 通常の回には理由が無い
  });
});
