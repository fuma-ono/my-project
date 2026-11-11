import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FOMC_SCHEDULE_PROVIDER } from '../../src/ingestion/pipelines/fomcSchedule.js';
import { createIngestionRepository } from '../../src/repositories/ingestionRepository.js';
import { buildIntegrationContext, loadIntegrationEnv, type IntegrationContext } from './setup.js';

const integration = loadIntegrationEnv();

/** seed.sql の US_FOMC。 */
const US_FOMC_INDICATOR_ID = '10000000-0000-0000-0000-000000000003';

/**
 * HQ指示(2026-11-10「FOMC 案3」): listPolicyRateEventsForReactions(fomc_policy_decisions を内部結合した会合の一覧)を
 * 本物の Postgres で確かめる。会合は 2018 年の日付(ほかのテストの期間に入らない)。決定の行は消せない(トリガー)ので、
 * 会合の行も残る(CI は毎回 DB を作り直す)。
 */
describe.skipIf(!integration)('listPolicyRateEventsForReactions (FOMC meetings with a recorded policy rate)', () => {
  let ctx: IntegrationContext;
  const runId = `${Date.now()}`;
  const recordedId: string = randomUUID();
  const noDecisionId: string = randomUUID();
  const cancelledId: string = randomUUID();

  const meeting = (id: string, releaseIso: string, key: string, status: 'SCHEDULED' | 'CANCELLED') => ({
    id,
    indicator_id: US_FOMC_INDICATOR_ID,
    provider: FOMC_SCHEDULE_PROVIDER,
    provider_event_id: `fomc_schedule:it-reactions-${runId}-${key}`,
    release_datetime: releaseIso,
    release_datetime_precision: 'EXACT',
    importance: 'HIGH',
    status,
    data_status: 'PENDING',
  });
  const decision = (eventId: string, announcedIso: string, effectiveDate: string) => ({
    event_id: eventId,
    target_range_lower: 1.75,
    target_range_upper: 2,
    announced_at: announcedIso,
    effective_date: effectiveDate,
    source: 'integration-test',
    source_url: 'https://example.test',
    fetched_at: '2018-12-31T00:00:00Z',
  });

  beforeAll(async () => {
    ctx = buildIntegrationContext(integration!);
    const { error } = await ctx.serviceClient
      .from('economic_events')
      .insert([
        meeting(recordedId, '2018-06-13T18:00:00Z', 'jun', 'SCHEDULED'),
        meeting(noDecisionId, '2018-08-01T18:00:00Z', 'aug', 'SCHEDULED'),
        meeting(cancelledId, '2018-09-26T18:00:00Z', 'sep', 'CANCELLED'),
      ]);
    if (error) throw new Error(`Failed to insert test meetings: ${error.message}`);
    const { error: decisionError } = await ctx.serviceClient
      .from('fomc_policy_decisions')
      .insert([
        decision(recordedId, '2018-06-13T18:00:00Z', '2018-06-14'),
        decision(cancelledId, '2018-09-26T18:00:00Z', '2018-09-27'),
      ]);
    if (decisionError) throw new Error(`Failed to insert test decisions: ${decisionError.message}`);
  });

  afterAll(async () => {
    if (!ctx) return;
    await ctx.app.close();
  });

  it('lists only non-cancelled meetings with a decision row, with the indicator currency, status unchanged', async () => {
    const store = createIngestionRepository(ctx.serviceClient);
    const listed = (await store.listPolicyRateEventsForReactions('2018-01-01T00:00:00Z')).filter((e) =>
      [recordedId, noDecisionId, cancelledId].includes(e.id),
    );
    expect(listed).toEqual([
      {
        id: recordedId,
        release_datetime: expect.stringMatching(/^2018-06-13T18:00:00/),
        release_datetime_precision: 'EXACT',
        currency_code: 'USD',
      },
    ]);
    // sinceIso より前の会合は入らない
    const later = await store.listPolicyRateEventsForReactions('2018-07-01T00:00:00Z');
    expect(later.some((e) => e.id === recordedId)).toBe(false);
    // RELEASED の一覧には入らない(会合は SCHEDULED のまま)
    const released = await store.listReleasedEventsForReactions('2018-01-01T00:00:00Z');
    expect(released.some((e) => e.id === recordedId)).toBe(false);
    const { data } = await ctx.serviceClient
      .from('economic_events')
      .select('status, data_status')
      .eq('id', recordedId)
      .single();
    expect(data).toEqual({ status: 'SCHEDULED', data_status: 'PENDING' });
  });
});
