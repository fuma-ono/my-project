import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FEATURE_CODES } from '../../src/authorization/entitlements.js';
import { NY_FED_SOURCE } from '../../src/domain/attribution.js';
import { FOMC_SCHEDULE_PROVIDER } from '../../src/ingestion/pipelines/fomcSchedule.js';
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

/** seed.sql の US_FOMC と USDJPY。 */
const US_FOMC_INDICATOR_ID = '10000000-0000-0000-0000-000000000003';
const USDJPY_FX_PAIR_ID = '20000000-0000-0000-0000-000000000001';

/**
 * FOMC の FREE/PRO 制限(HQ指示 2026-11-19、authorization/policyRateAccess.ts)を本物の Postgres で確かめる。
 * FOMC の政策金利は専用の表(fomc_policy_decisions)にあり、既存の「過去の発表」制限(RELEASED だけを数える)は、記録前・補正前の
 * SCHEDULED のままの会合を数えない。このテストの会合は SCHEDULED で作る(記録済みかどうかで数えることを確かめる)。
 * 政策金利が記録済みの会合を新しい順に並べ、FREE は直近 3 回だけ・PRO は全部。
 *
 * 同じ DB を使う他のテスト(fomc-policy-rate など、2018〜2019 年の会合)の「直近 3 回」を変えないよう、
 * このテストの会合は 2001 年(他より古い)に置く。ほかの記録済みの会合が増えても、4 つのうち一番古い会合は
 * 必ず 4 番目以降 = FREE ではロックされる(新しい側の見え方は、他のテストの会合に左右されるので確かめない)。
 * 決定の行は消せない(トリガー)ので会合の行も残る(CI は毎回 DB を作り直す)。
 */
describe.skipIf(!integration)('FOMC FREE/PRO limit: policy rate and child resources', () => {
  let ctx: IntegrationContext;
  const users: TestUser[] = [];
  const runId = `${Date.now()}`;
  // 新しい順に newest … oldest(2001-04 … 2001-01)。oldest は、FREE では必ずロックされる。
  const MONTHS = ['04', '03', '02', '01'];
  const meetings = MONTHS.map((month) => ({ id: randomUUID(), month }));
  const oldest = meetings[3]!;

  async function newUser(plan: 'FREE' | 'PRO'): Promise<{ authorization: string }> {
    const user = await createTestUser(ctx);
    users.push(user);
    await grantEntitlement(ctx, user.id, FEATURE_CODES.VIEW_BASIC_EVENT);
    if (plan === 'PRO') await grantEntitlement(ctx, user.id, FEATURE_CODES.VIEW_ADVANCED_STATS);
    return { authorization: `Bearer ${user.accessToken}` };
  }

  async function get(url: string, headers: { authorization: string }) {
    const response = await ctx.app.inject({ method: 'GET', url: `/api/v1${url}`, headers });
    return { status: response.statusCode, body: JSON.parse(response.body) };
  }

  beforeAll(async () => {
    ctx = buildIntegrationContext(integration!);
    const events = await ctx.serviceClient.from('economic_events').insert(
      meetings.map(({ id, month }) => ({
        id,
        indicator_id: US_FOMC_INDICATOR_ID,
        provider: FOMC_SCHEDULE_PROVIDER,
        provider_event_id: `fomc_schedule:it-free-pro-${runId}-${month}`,
        release_datetime: `2001-${month}-18T18:00:00Z`,
        release_datetime_precision: 'EXACT',
        importance: 'HIGH',
        status: 'SCHEDULED',
        data_status: 'PENDING',
      })),
    );
    if (events.error) throw new Error(`Failed to insert test meetings: ${events.error.message}`);
    const decisions = await ctx.serviceClient.from('fomc_policy_decisions').insert(
      meetings.map(({ id, month }) => ({
        event_id: id,
        target_range_lower: 5.25,
        target_range_upper: 5.5,
        announced_at: `2001-${month}-18T18:00:00Z`,
        effective_date: `2001-${month}-19`,
        source: NY_FED_SOURCE,
        source_url: 'https://markets.newyorkfed.org/api/rates/unsecured/effr/search.json',
        fetched_at: '2001-12-31T00:00:00Z',
      })),
    );
    if (decisions.error) throw new Error(`Failed to insert test decisions: ${decisions.error.message}`);
  });

  afterAll(async () => {
    if (!ctx) return;
    for (const user of users) await deleteTestUser(ctx, user.id);
    await ctx.app.close();
  });

  it('FREE: GET /events/{oldest recorded meeting} is locked and policy_rate is null', async () => {
    const headers = await newUser('FREE');
    const { status, body } = await get(`/events/${oldest.id}`, headers);
    expect(status).toBe(200);
    expect(body.event).toMatchObject({ id: oldest.id, locked: true, policy_rate: null });
    expect(JSON.stringify(body)).not.toContain('5.25');
  });

  it('FREE: child resources of the locked meeting are 403 PLAN_LIMIT_EXCEEDED (required_plan PRO)', async () => {
    const headers = await newUser('FREE');
    for (const url of [
      `/events/${oldest.id}/revisions`,
      `/events/${oldest.id}/history`,
      `/events/${oldest.id}/reaction?fx_pair_id=${USDJPY_FX_PAIR_ID}`,
      `/events/${oldest.id}/reaction/chart?fx_pair_id=${USDJPY_FX_PAIR_ID}&timeframe=1m`,
    ]) {
      const { status, body } = await get(url, headers);
      expect(status, url).toBe(403);
      expect(body.error, url).toMatchObject({ code: 'PLAN_LIMIT_EXCEEDED', required_plan: 'PRO' });
    }
  });

  it('PRO: every recorded meeting keeps its policy_rate and child resources', async () => {
    const headers = await newUser('PRO');
    for (const { id, month } of meetings) {
      const { status, body } = await get(`/events/${id}`, headers);
      expect(status, id).toBe(200);
      expect(body.event.locked, id).toBe(false);
      expect(body.event.policy_rate, id).toMatchObject({
        target_range_lower: 5.25,
        target_range_upper: 5.5,
        effective_date: `2001-${month}-19`,
      });
    }
    expect((await get(`/events/${oldest.id}/revisions`, headers)).status).toBe(200);
  });
});
