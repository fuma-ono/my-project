import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FEATURE_CODES } from '../../src/authorization/entitlements.js';
import { NY_FED_SOURCE, nyFedAttribution } from '../../src/domain/attribution.js';
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
    expect(event.data_status).toBe('DATA_PENDING'); // 会合の行は変えていない(DB の PENDING は API で DATA_PENDING)

    const noDecisionId = randomUUID();
    const { error } = await ctx.serviceClient
      .from('economic_events')
      .insert(meetingRow(noDecisionId, '2019-01-30T19:00:00Z', 'jan'));
    if (error) throw error;
    const without = await ctx.app.inject({ method: 'GET', url: `/api/v1/events/${noDecisionId}`, headers });
    expect(without.statusCode).toBe(200);
    expect(JSON.parse(without.body).event).toMatchObject({ policy_rate: null, attribution: null });
  });
});
