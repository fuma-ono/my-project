import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FEATURE_CODES } from '../../src/authorization/entitlements.js';
import { FRB_ATTRIBUTION, NY_FED_SOURCE, nyFedAttribution } from '../../src/domain/attribution.js';
import { parseNyFedTargetRanges } from '../../src/ingestion/adapters/nyFedRates.js';
import { ingestFomcPolicyRates } from '../../src/ingestion/pipelines/fomcPolicyRates.js';
import { FOMC_SCHEDULE_PROVIDER } from '../../src/ingestion/pipelines/fomcSchedule.js';
import { JobCounters } from '../../src/ingestion/runner.js';
import type { IngestionStore } from '../../src/ingestion/store.js';
import { createIngestionRepository } from '../../src/repositories/ingestionRepository.js';
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

/** seed.sql の US_FOMC。 */
const US_FOMC_INDICATOR_ID = '10000000-0000-0000-0000-000000000003';

/**
 * migration 20261105000001(fomc_policy_decisions)と、FOMC の政策決定の取り込み・GET /events/{id} の policy_rate
 * (HQ承認 2026-11-05「FOMC政策金利の実データ取り込み」案A、api-design v1.47)を本物の Postgres で確かめる。
 * 会合の行は US_FOMC の 2019 年の日付(ほかのテストの期間に入らない)。決定の行は消せない(トリガー)ので、
 * 会合の行も残る(CI は毎回 DB を作り直す)。NY連銀の API は偽物。
 */
describe.skipIf(!integration)('FOMC policy decisions: table, ingestion and GET /events/{id}', () => {
  let ctx: IntegrationContext;
  let user: TestUser;
  const runId = `${Date.now()}`;
  const meetingId = randomUUID();
  const otherMeetingId = randomUUID();
  const constraintMeetingId = randomUUID();

  function meetingRow(id: string, releaseIso: string, key: string) {
    return {
      id,
      indicator_id: US_FOMC_INDICATOR_ID,
      provider: FOMC_SCHEDULE_PROVIDER,
      provider_event_id: `fomc_schedule:it-${runId}-${key}`,
      release_datetime: releaseIso,
      release_datetime_precision: 'EXACT',
      importance: 'HIGH',
      status: 'SCHEDULED',
      data_status: 'PENDING',
    };
  }

  const validDecision = (eventId: string) => ({
    event_id: eventId,
    target_range_lower: 1.5,
    target_range_upper: 1.75,
    announced_at: '2019-07-31T18:00:00Z',
    effective_date: '2019-08-01',
    source: NY_FED_SOURCE,
    source_url:
      'https://markets.newyorkfed.org/api/rates/unsecured/effr/search.json?startDate=2019-08-01&endDate=2019-08-02',
    fetched_at: '2019-08-02T15:00:00Z',
  });

  beforeAll(async () => {
    ctx = buildIntegrationContext(integration!);
    const { error } = await ctx.serviceClient
      .from('economic_events')
      .insert([
        meetingRow(meetingId, '2019-12-11T19:00:00Z', 'dec'),
        meetingRow(otherMeetingId, '2019-10-30T18:00:00Z', 'oct'),
        meetingRow(constraintMeetingId, '2019-07-31T18:00:00Z', 'jul'),
      ]);
    if (error) throw new Error(`Failed to insert test meetings: ${error.message}`);
    user = await createTestUser(ctx);
    await grantEntitlement(ctx, user.id, FEATURE_CODES.VIEW_BASIC_EVENT);
  });

  afterAll(async () => {
    if (!ctx) return;
    if (user) await deleteTestUser(ctx, user.id);
    await ctx.app.close();
  });

  it('keeps one row per meeting, lower < upper, the effective day after the announcement, and never changes a row', async () => {
    const insert = (row: Record<string, unknown>) => ctx.serviceClient.from('fomc_policy_decisions').insert(row);
    expect((await insert(validDecision(constraintMeetingId))).error).toBeNull();
    expect((await insert(validDecision(constraintMeetingId))).error?.message).toMatch(/duplicate key/);

    const other = randomUUID();
    const { error: eventError } = await ctx.serviceClient
      .from('economic_events')
      .insert(meetingRow(other, '2019-09-18T18:00:00Z', 'sep'));
    if (eventError) throw eventError;
    const bad = { ...validDecision(other), announced_at: '2019-09-18T18:00:00Z', effective_date: '2019-09-19' };
    expect((await insert({ ...bad, target_range_lower: 2, target_range_upper: 1.75 })).error?.message).toMatch(
      /range_check/,
    );
    expect((await insert({ ...bad, target_range_lower: -0.25 })).error?.message).toMatch(/range_check/);
    expect((await insert({ ...bad, effective_date: '2019-09-18' })).error?.message).toMatch(/effective_after/);
    expect((await insert({ ...bad, target_range_lower: null })).error).not.toBeNull();

    const { error: updateError } = await ctx.serviceClient
      .from('fomc_policy_decisions')
      .update({ target_range_upper: 2 })
      .eq('event_id', constraintMeetingId);
    expect(updateError?.message).toMatch(/immutable/);
    const { error: deleteError } = await ctx.serviceClient
      .from('fomc_policy_decisions')
      .delete()
      .eq('event_id', constraintMeetingId);
    expect(deleteError?.message).toMatch(/immutable/);
  });

  it('the job records the range for its meetings through the real repository, once, and leaves economic_events alone', async () => {
    const repository = createIngestionRepository(ctx.serviceClient);
    // ほかのテストの US_FOMC の行に触れないよう、このテストの2つの会合だけを見せる。
    const store: IngestionStore = {
      ...repository,
      listEventsByProvider: async (provider) =>
        (await repository.listEventsByProvider(provider)).filter((row) =>
          ([meetingId, otherMeetingId] as string[]).includes(row.id),
        ),
    };
    const body = {
      refRates: [
        { effectiveDate: '2019-10-31', type: 'EFFR', percentRate: 1.83, targetRateFrom: 1.5, targetRateTo: 1.75 },
        { effectiveDate: '2019-12-12', type: 'EFFR', percentRate: 1.55, targetRateFrom: 1.5, targetRateTo: 1.75 },
      ],
    };
    const fetchRanges = () => Promise.resolve(parseNyFedTargetRanges(body));
    const now = () => new Date('2019-12-13T15:00:00Z');
    const before = await ctx.serviceClient.from('economic_events').select('*').in('id', [meetingId, otherMeetingId]);

    const first = new JobCounters();
    await ingestFomcPolicyRates({ store, fetchRanges, now }, first);
    expect(first.errorMessages).toEqual([]);
    const { data: rows, error } = await ctx.serviceClient
      .from('fomc_policy_decisions')
      .select('event_id, target_range_lower, target_range_upper, effective_date, announced_at, source')
      .in('event_id', [meetingId, otherMeetingId])
      .order('effective_date');
    if (error) throw error;
    expect(
      rows.map((r) => [r.event_id, Number(r.target_range_lower), Number(r.target_range_upper), r.effective_date]),
    ).toEqual([
      [otherMeetingId, 1.5, 1.75, '2019-10-31'],
      [meetingId, 1.5, 1.75, '2019-12-12'],
    ]);
    expect(Date.parse(rows[1]!.announced_at)).toBe(Date.parse('2019-12-11T19:00:00Z'));

    const second = new JobCounters();
    const again = await ingestFomcPolicyRates({ store, fetchRanges, now }, second);
    expect(again).toMatchObject({ recorded: [], alreadyRecorded: 2 });

    const after = await ctx.serviceClient.from('economic_events').select('*').in('id', [meetingId, otherMeetingId]);
    expect(after.data).toEqual(before.data);
  });

  it('GET /events/{id} returns policy_rate (lower and upper apart) with the NY Fed attribution, and null without a decision', async () => {
    const headers = { authorization: `Bearer ${user.accessToken}` };
    const withDecision = await ctx.app.inject({ method: 'GET', url: `/api/v1/events/${meetingId}`, headers });
    expect(withDecision.statusCode).toBe(200);
    const event = JSON.parse(withDecision.body).event;
    expect(event.policy_rate).toMatchObject({
      target_range_lower: 1.5,
      target_range_upper: 1.75,
      effective_date: '2019-12-12',
      source: NY_FED_SOURCE,
    });
    expect(Date.parse(event.policy_rate.announced_at)).toBe(Date.parse('2019-12-11T19:00:00Z'));
    expect(event.attribution).toEqual(nyFedAttribution());
    // HQ指示(2026-11-06「NY連銀の規約対応」修正案1): API の告知に、会合との対応付けは本アプリが行っていることが入る
    expect(event.attribution.notice).toContain(
      'FOMC会合との対応付け（発表日の翌営業日以降で最初に有効になったレンジ）は、本アプリが行っています。',
    );
    expect(event.data_status).toBe('DATA_PENDING'); // 会合の行は変えていない(DB の PENDING は API で DATA_PENDING)

    const noDecisionId = randomUUID();
    const { error } = await ctx.serviceClient
      .from('economic_events')
      .insert(meetingRow(noDecisionId, '2019-01-30T19:00:00Z', 'jan'));
    if (error) throw error;
    const without = await ctx.app.inject({ method: 'GET', url: `/api/v1/events/${noDecisionId}`, headers });
    expect(without.statusCode).toBe(200);
    // HQ指示(2026-11-10「指標の全量表示」): 政策金利の無い会合は FRB の出典(以前は null)
    expect(JSON.parse(without.body).event).toMatchObject({ policy_rate: null, attribution: FRB_ATTRIBUTION });
  });
  // HQ指示(2026-11-06「DEV監査で見つかった政策金利テーブルの権限問題」): 値の表(20261022000001_past_release_access.sql)と
  // 同じく、アプリ利用者(anon / authenticated)は Supabase に直接つないでこの表を読み書きできない(権限が無い = 42501。
  // RLS で「0 行」になるのではない)。Backend は service_role で読み書きし(上の2つのテスト)、API はその値を返す(上のテスト)。
  it('anon / authenticated cannot read or write fomc_policy_decisions directly; service_role can read it', async () => {
    const asUser = (token: string): SupabaseClient =>
      createClient(ctx.supabaseUrl, ctx.anonKey, {
        global: { headers: { Authorization: `Bearer ${token}` } },
        auth: { autoRefreshToken: false, persistSession: false },
      });
    const roles: { label: string; client: SupabaseClient; deniedStatus: number }[] = [
      {
        label: 'anon',
        client: createClient(ctx.supabaseUrl, ctx.anonKey, {
          auth: { autoRefreshToken: false, persistSession: false },
        }),
        deniedStatus: 401,
      },
      { label: 'authenticated', client: asUser(user.accessToken), deniedStatus: 403 },
    ];
    type Result = { data: unknown; error: { code?: string; message: string } | null; status: number };
    const expectDenied = (result: Result, label: string) => {
      const detail = `${label}: ${JSON.stringify({ status: result.status, error: result.error, data: result.data })}`;
      expect(result.error?.code, detail).toBe('42501');
      expect(result.error?.message, detail).toBe('permission denied for table fomc_policy_decisions');
      expect(result.data, detail).toBeNull();
    };
    const row = { ...validDecision(otherMeetingId), event_id: randomUUID() } as never;
    for (const { label, client, deniedStatus } of roles) {
      const select = await client.from('fomc_policy_decisions').select('*').limit(5);
      expect(select.status, `${label} select`).toBe(deniedStatus);
      expectDenied(select, `${label} select`);
      const count = await client.from('fomc_policy_decisions').select('*', { count: 'exact', head: true });
      expect(count.status, `${label} count`).toBe(deniedStatus);
      expect(count.count, `${label} count`).toBeNull();
      expectDenied(await client.from('fomc_policy_decisions').insert(row), `${label} insert`);
      expectDenied(
        await client
          .from('fomc_policy_decisions')
          .update({ target_range_upper: 9 } as never)
          .eq('event_id', meetingId),
        `${label} update`,
      );
      expectDenied(await client.from('fomc_policy_decisions').delete().eq('event_id', meetingId), `${label} delete`);
    }
    // service_role(Backend)は読める。直接の試みで何も変わっていない。
    const { data, error } = await ctx.serviceClient
      .from('fomc_policy_decisions')
      .select('event_id, target_range_upper')
      .eq('event_id', meetingId);
    expect(error).toBeNull();
    expect(data?.map((r) => Number(r.target_range_upper))).toEqual([1.75]);
  });
  // HQ指示(2026-11-06「NY Fed 食い違いログの重複防止」): 前回の状態は、このジョブ(job・provider)のログのうち、
  // 突き合わせができた(conflicts_checked = true)直近の1行の open_conflicts だけから読む。
  it('reads the previous conflict state only from the latest comparable log of this job', async () => {
    const repository = createIngestionRepository(ctx.serviceClient);
    const log = (job: string, provider: string, startedAt: string, details: Record<string, unknown>) => ({
      provider,
      data_type: 'ECONOMIC_EVENT' as const,
      job,
      started_at: startedAt,
      completed_at: startedAt,
      status: 'SUCCESS' as const,
      fetched_count: 0,
      success_count: 0,
      error_count: 0,
      skipped_count: 0,
      review_count: 0,
      error_message: null,
      details,
    });
    const key = `it-${runId}`;
    await repository.insertIngestionLog(
      log('ingest:fomc-policy-rate', 'nyfed_effr', '2099-01-01T00:00:00Z', {
        conflicts_checked: true,
        open_conflicts: [`${key}-old`],
      }),
    );
    await repository.insertIngestionLog(
      log('ingest:fomc-policy-rate', 'nyfed_effr', '2099-01-02T00:00:00Z', {
        conflicts_checked: true,
        open_conflicts: [`${key}-latest`],
      }),
    );
    // より新しいが、突き合わせなかった実行(取得の失敗)・他のジョブ・他の provider は前回の状態にならない
    await repository.insertIngestionLog(
      log('ingest:fomc-policy-rate', 'nyfed_effr', '2099-01-03T00:00:00Z', {
        conflicts_checked: false,
        source_status: 'UNAVAILABLE',
      }),
    );
    await repository.insertIngestionLog(
      log('ingest:fomc-schedule', 'nyfed_effr', '2099-01-04T00:00:00Z', {
        conflicts_checked: true,
        open_conflicts: [`${key}-other-job`],
      }),
    );
    await repository.insertIngestionLog(
      log('ingest:fomc-policy-rate', 'fomc_schedule', '2099-01-05T00:00:00Z', {
        conflicts_checked: true,
        open_conflicts: [`${key}-other-provider`],
      }),
    );
    expect(await repository.latestFomcPolicyRateOpenConflicts()).toEqual([`${key}-latest`]);
    await ctx.serviceClient.from('ingestion_logs').delete().gte('started_at', '2099-01-01T00:00:00Z');
  });
});
