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

// テスト用の行(afterAll で消す)。実際の時計から3日後。議事要旨(migration 20261027000004 の指標)と、比べるための CPI
const MINUTES_EVENT_ID = '3e000000-0000-0000-0000-000000000001';
const US_CPI_INDICATOR_ID = '10000000-0000-0000-0000-000000000001';
const CPI_EVENT_ID = '3e000000-0000-0000-0000-000000000002';
const MINUTE_MS = 60_000;
const base = Math.floor(Date.now() / MINUTE_MS) * MINUTE_MS;
const at = (minutes: number) => new Date(base + minutes * MINUTE_MS).toISOString();

/**
 * 予定だけのデータの区別(HQ指示 2026-10-27、schedule-only-design.md 2章): 結果の値が出ない予定(FOMC議事要旨)は
 * result_type NONE、値の出る指標は VALUE。カレンダー・ホーム・通知の予定で同じ値を返す。DB は変えない(コードの設定)。
 */
describe.skipIf(!integration)('result_type: schedule-only events (FOMC minutes) vs value events', () => {
  let ctx: IntegrationContext;
  const users: TestUser[] = [];
  let headers: { authorization: string };

  beforeAll(async () => {
    ctx = buildIntegrationContext(integration!);
    const { data: minutes, error: lookup } = await ctx.serviceClient
      .from('economic_indicators')
      .select('id')
      .eq('code', 'US_FOMC_MINUTES')
      .single();
    if (lookup) throw lookup;
    const { error } = await ctx.serviceClient.from('economic_events').insert([
      {
        id: MINUTES_EVENT_ID,
        indicator_id: minutes.id,
        provider: 'integration-test',
        provider_event_id: 'result-type-minutes',
        release_datetime: at(3 * 24 * 60),
        release_datetime_precision: 'EXACT',
        importance: 'MEDIUM',
        status: 'SCHEDULED',
      },
      {
        id: CPI_EVENT_ID,
        indicator_id: US_CPI_INDICATOR_ID,
        provider: 'integration-test',
        provider_event_id: 'result-type-cpi',
        release_datetime: at(3 * 24 * 60 + 30),
        release_datetime_precision: 'EXACT',
        importance: 'MEDIUM',
        status: 'SCHEDULED',
      },
    ]);
    if (error) throw new Error(`Failed to insert test events: ${error.message}`);
    const user = await createTestUser(ctx);
    users.push(user);
    await grantEntitlement(ctx, user.id, FEATURE_CODES.VIEW_ADVANCED_STATS);
    headers = { authorization: `Bearer ${user.accessToken}` };
  });

  afterAll(async () => {
    await ctx.serviceClient.from('economic_events').delete().in('id', [MINUTES_EVENT_ID, CPI_EVENT_ID]);
    for (const user of users) await deleteTestUser(ctx, user.id);
    await ctx.app.close();
  });

  const range = () => `from=${encodeURIComponent(at(3 * 24 * 60 - 60))}&to=${encodeURIComponent(at(3 * 24 * 60 + 90))}`;
  const get = async (url: string) => {
    const response = await ctx.app.inject({ method: 'GET', url: `/api/v1${url}`, headers });
    expect(response.statusCode).toBe(200);
    return JSON.parse(response.body);
  };

  it('/calendar: minutes NONE, CPI VALUE, both with data_status DATA_PENDING', async () => {
    const body = await get(`/calendar?${range()}`);
    const byId = new Map(
      (body.items as { id: string; result_type: string; data_status: string }[]).map((i) => [i.id, i]),
    );
    expect(byId.get(MINUTES_EVENT_ID)).toMatchObject({ result_type: 'NONE', data_status: 'DATA_PENDING' });
    expect(byId.get(CPI_EVENT_ID)).toMatchObject({ result_type: 'VALUE', data_status: 'DATA_PENDING' });
  });

  it('/notifications/upcoming: the minutes item carries result_type NONE (iOS words it 「公表の N 分前」)', async () => {
    const body = await get(`/notifications/upcoming?${range()}`);
    const byId = new Map((body.items as { id: string; result_type: string | null }[]).map((i) => [i.id, i]));
    expect(byId.get(MINUTES_EVENT_ID)?.result_type).toBe('NONE');
    expect(byId.get(CPI_EVENT_ID)?.result_type).toBe('VALUE');
  });
});
