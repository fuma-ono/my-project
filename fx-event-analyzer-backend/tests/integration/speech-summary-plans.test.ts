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
 * HQ指示(2026-11-11「FREE/PRO 双方で READY・FAILED・NOT_AVAILABLE を表示できることを確認」): 本物の Postgres と API で、
 * 要約の3つの状態が FREE・PRO のどちらにも同じ形で返ること、本文と作れなかった理由は返らないこと。
 */
describe.skipIf(!integration)('speech summary status for FREE and PRO (GET /speeches, GET /speeches/{id})', () => {
  let ctx: IntegrationContext;
  const users: TestUser[] = [];
  const runId = `${Date.now()}`;
  const speakerId = randomUUID();
  const ids = { ready: randomUUID(), failed: randomUUID(), none: randomUUID() };
  const BODY = 'Inflation remains above our 2 percent objective. The labor market is broadly in balance.';
  const SUMMARY = 'Inflation remains above our 2 percent objective.';
  const url = (suffix: string) => `https://www.federalreserve.gov/newsevents/speech/plantest${runId}${suffix}.htm`;

  beforeAll(async () => {
    ctx = buildIntegrationContext(integration!);
    const speaker = await ctx.serviceClient.from('speakers').insert({
      id: speakerId,
      name: `要約プランテスト ${runId}`,
      title: 'FRB理事',
      organization: 'FRB',
      country_code: 'US',
      currency_code: 'USD',
    });
    if (speaker.error) throw speaker.error;
    const base = {
      speaker_id: speakerId,
      provider: 'frb_calendar',
      title: '講演: Plan test',
      importance: 'MEDIUM',
      status: 'DELIVERED',
    };
    // 1行ずつ入れる(まとめて入れると、行ごとに無い列が既定値ではなく null になる — body_status は null 不可)
    const rows = [
      {
        ...base,
        id: ids.ready,
        provider_event_id: `plan-ready-${runId}`,
        statement_datetime: '2026-11-03T15:00:00Z',
        source_url: url('a'),
        speech_body: BODY,
        body_fetched_at: '2026-11-11T06:00:00Z',
        body_status: 'FETCHED',
        summary: SUMMARY,
        summary_method: 'EXTRACTIVE_EN',
        summary_generated_at: '2026-11-11T06:05:00Z',
      },
      {
        ...base,
        id: ids.failed,
        provider_event_id: `plan-failed-${runId}`,
        statement_datetime: '2026-11-03T16:00:00Z',
        source_url: url('b'),
        speech_body: 'Thank you.',
        body_fetched_at: '2026-11-11T06:00:00Z',
        body_status: 'FETCHED',
        summary_error: 'BODY_TOO_SHORT',
      },
      {
        ...base,
        id: ids.none,
        provider_event_id: `plan-none-${runId}`,
        statement_datetime: '2026-11-03T17:00:00Z',
      },
    ];
    for (const row of rows) {
      const { error } = await ctx.serviceClient.from('speech_events').insert(row);
      if (error) throw error;
    }
  });

  afterAll(async () => {
    if (!ctx) return;
    for (const user of users) await deleteTestUser(ctx, user.id);
    await ctx.serviceClient.from('speech_events').delete().in('id', Object.values(ids));
    await ctx.serviceClient.from('speakers').delete().eq('id', speakerId);
    await ctx.app.close();
  });

  async function headersFor(plan: 'FREE' | 'PRO') {
    const user = await createTestUser(ctx);
    users.push(user);
    if (plan === 'PRO') await grantEntitlement(ctx, user.id, FEATURE_CODES.VIEW_ADVANCED_STATS);
    return { authorization: `Bearer ${user.accessToken}` };
  }

  const pick = (body: Record<string, unknown>) => ({
    summary: body.summary,
    summary_status: body.summary_status,
    summary_method: body.summary_method,
    source_url: body.source_url,
    body_status: body.body_status,
  });

  const expected = {
    [ids.ready]: {
      summary: SUMMARY,
      summary_status: 'READY',
      summary_method: 'EXTRACTIVE_EN',
      source_url: url('a'),
      body_status: 'FETCHED',
    },
    [ids.failed]: {
      summary: null,
      summary_status: 'FAILED',
      summary_method: null,
      source_url: url('b'),
      body_status: 'FETCHED',
    },
    [ids.none]: {
      summary: null,
      summary_status: 'NOT_AVAILABLE',
      summary_method: null,
      source_url: null,
      body_status: 'PENDING',
    },
  };

  for (const plan of ['FREE', 'PRO'] as const) {
    it(`${plan}: detail and list return READY / FAILED / NOT_AVAILABLE, never the body or the failure reason`, async () => {
      const headers = await headersFor(plan);
      for (const id of Object.values(ids)) {
        const response = await ctx.app.inject({ method: 'GET', url: `/api/v1/speeches/${id}`, headers });
        expect(response.statusCode, `${plan} ${id}`).toBe(200);
        const body = JSON.parse(response.body) as Record<string, unknown>;
        expect(pick(body)).toEqual(expected[id]);
        expect(body).not.toHaveProperty('speech_body');
        expect(body).not.toHaveProperty('summary_error');
        expect(response.body).not.toContain('The labor market is broadly in balance');
        expect(response.body).not.toContain('BODY_TOO_SHORT');
      }
      const list = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/speeches?from=2026-11-03T00:00:00Z&to=2026-11-04T00:00:00Z&limit=100`,
        headers,
      });
      expect(list.statusCode).toBe(200);
      const items = (JSON.parse(list.body) as { data: Record<string, unknown>[] }).data;
      for (const id of Object.values(ids)) {
        const item = items.find((row) => row.speech_id === id);
        expect(item, `${plan} list ${id}`).toBeDefined();
        expect(pick(item!)).toEqual(expected[id]);
      }
      expect(list.body).not.toContain('BODY_TOO_SHORT');
    });
  }
});
