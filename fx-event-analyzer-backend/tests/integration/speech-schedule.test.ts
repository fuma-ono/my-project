import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createQualityReader } from '../../src/ingestion/quality/reader.js';
import { createSpeechBodyStore } from '../../src/repositories/speechBodyRepository.js';
import { buildIntegrationContext, loadIntegrationEnv, type IntegrationContext } from './setup.js';

const integration = loadIntegrationEnv();

/**
 * HQ承認(2026-11-11「要人発言の定期実行」1日目): migration 20261112000001(body_attempts・body_last_attempt_at)と、
 * 本文のストアの状態の条件・楽観的な条件を、本物の Postgres で確かめる。
 */
describe.skipIf(!integration)('speech bodies: attempts and guarded writes (migration 20261112000001)', () => {
  let ctx: IntegrationContext;
  const runId = `${Date.now()}`;
  const speakerId = randomUUID();
  const ids = {
    pending: randomUUID(),
    failed2: randomUUID(),
    failed3: randomUUID(),
    scheduled: randomUUID(),
    old: randomUUID(),
  };
  const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();
  const URL_OK = `https://www.federalreserve.gov/newsevents/speech/schedtest${runId}a.htm`;

  beforeAll(async () => {
    ctx = buildIntegrationContext(integration!);
    const speaker = await ctx.serviceClient.from('speakers').insert({
      id: speakerId,
      name: `定期テスト ${runId}`,
      title: 'FRB理事',
      organization: 'FRB',
      country_code: 'US',
      currency_code: 'USD',
    });
    if (speaker.error) throw speaker.error;
    const base = {
      speaker_id: speakerId,
      provider: 'frb_calendar',
      title: '講演: Schedule test',
      importance: 'MEDIUM',
    };
    const rows = [
      {
        ...base,
        id: ids.pending,
        provider_event_id: `sched-p-${runId}`,
        statement_datetime: daysAgo(2),
        status: 'DELIVERED',
      },
      {
        ...base,
        id: ids.failed2,
        provider_event_id: `sched-f2-${runId}`,
        statement_datetime: daysAgo(3),
        status: 'DELIVERED',
        source_url: URL_OK,
        body_status: 'FAILED',
        body_error: 'HTTP_404',
        body_attempts: 2,
      },
      {
        ...base,
        id: ids.failed3,
        provider_event_id: `sched-f3-${runId}`,
        statement_datetime: daysAgo(4),
        status: 'DELIVERED',
        source_url: URL_OK,
        body_status: 'FAILED',
        body_error: 'HTTP_404',
        body_attempts: 3,
      },
      {
        ...base,
        id: ids.scheduled,
        provider_event_id: `sched-s-${runId}`,
        statement_datetime: daysAgo(-2),
        status: 'SCHEDULED',
      },
      {
        ...base,
        id: ids.old,
        provider_event_id: `sched-o-${runId}`,
        statement_datetime: daysAgo(20),
        status: 'DELIVERED',
      },
    ];
    for (const row of rows) {
      const { error } = await ctx.serviceClient.from('speech_events').insert(row);
      if (error) throw error;
    }
  });

  afterAll(async () => {
    if (!ctx) return;
    await ctx.serviceClient.from('speech_events').delete().in('id', Object.values(ids));
    await ctx.serviceClient.from('speakers').delete().eq('id', speakerId);
    await ctx.app.close();
  });

  const read = async (id: string) => {
    const { data, error } = await ctx.serviceClient
      .from('speech_events')
      .select('body_status, body_attempts, body_last_attempt_at, speech_body, source_url')
      .eq('id', id)
      .single();
    if (error) throw error;
    return data;
  };

  it('new rows get body_attempts 0 and no last attempt; a negative count is refused', async () => {
    expect(await read(ids.pending)).toMatchObject({
      body_attempts: 0,
      body_last_attempt_at: null,
      body_status: 'PENDING',
    });
    const bad = await ctx.serviceClient.from('speech_events').update({ body_attempts: -1 }).eq('id', ids.pending);
    expect(bad.error?.message).toMatch(/body_attempts_check/);
  });

  it('lists DELIVERED rows of the window that are PENDING or FAILED under the cap only', async () => {
    const store = createSpeechBodyStore(ctx.serviceClient);
    const listed = (await store.listSpeechesNeedingBody(['frb_calendar'], daysAgo(14), 3)).map((r) => r.id);
    expect(listed).toContain(ids.pending);
    expect(listed).toContain(ids.failed2);
    expect(listed).not.toContain(ids.failed3); // 3回失敗(上限)
    expect(listed).not.toContain(ids.scheduled); // 発言前
    expect(listed).not.toContain(ids.old); // 14日より前
    const failed2 = (await store.listSpeechesNeedingBody(['frb_calendar'], daysAgo(14), 3)).find(
      (r) => r.id === ids.failed2,
    );
    expect(failed2?.body_attempts).toBe(2);
  });

  it('claims an attempt once (optimistic: the same expected count twice → false)', async () => {
    const store = createSpeechBodyStore(ctx.serviceClient);
    expect(await store.claimBodyAttempt(ids.pending, 0, new Date().toISOString())).toBe(true);
    expect(await store.claimBodyAttempt(ids.pending, 0, new Date().toISOString())).toBe(false);
    const row = await read(ids.pending);
    expect(row.body_attempts).toBe(1);
    expect(row.body_last_attempt_at).not.toBeNull();
  });

  it('writes only with the current count, and never overwrites a FETCHED body or URL', async () => {
    const store = createSpeechBodyStore(ctx.serviceClient);
    const fetched = {
      source_url: URL_OK,
      speech_body: 'Inflation has eased.',
      body_fetched_at: new Date().toISOString(),
      body_status: 'FETCHED' as const,
      body_error: null,
    };
    expect(await store.updateSpeechBody(ids.pending, fetched, 0)).toBe(false); // 古い回数
    expect(await store.updateSpeechBody(ids.pending, fetched, 1)).toBe(true);
    // FETCHED の後は、数えることも、FAILED や別の本文で上書きすることもできない
    expect(await store.claimBodyAttempt(ids.pending, 1, new Date().toISOString())).toBe(false);
    expect(
      await store.updateSpeechBody(
        ids.pending,
        { source_url: URL_OK, body_status: 'FAILED', body_error: 'HTTP_500' },
        1,
      ),
    ).toBe(false);
    expect(
      await store.updateSpeechBody(
        ids.pending,
        { ...fetched, source_url: 'https://www.federalreserve.gov/newsevents/speech/other.htm', speech_body: 'Other.' },
        1,
      ),
    ).toBe(false);
    expect(await read(ids.pending)).toMatchObject({
      body_status: 'FETCHED',
      speech_body: 'Inflation has eased.',
      source_url: URL_OK,
      body_attempts: 1,
    });
  });

  it('the quality reader reads the chapter 11 counts (the capped FAILED row is counted)', async () => {
    const status = await createQualityReader(ctx.serviceClient).speechPipelineStatus(new Date().toISOString());
    expect(status).not.toBeNull();
    expect(status!.bodyFailedAtCap).toBeGreaterThanOrEqual(1);
    expect(status!.bodyFailedRetrying).toBeGreaterThanOrEqual(1);
    expect(status!.lastRuns.map((r) => r.job)).toEqual(['ingest:speech-bodies', 'ingest:speech-summaries']);
  });
});
