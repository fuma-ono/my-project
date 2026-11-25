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
    expect(await store.claimBodyAttempt(ids.pending, 0, new Date().toISOString(), 3)).toBe(true);
    expect(await store.claimBodyAttempt(ids.pending, 0, new Date().toISOString(), 3)).toBe(false);
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
    expect(await store.claimBodyAttempt(ids.pending, 1, new Date().toISOString(), 3)).toBe(false);
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

  // HQ承認(2026-11-12「誤紐付けの修正」): 照らし合わせの母集団は、本文の有無・状態に関係なく FRB のすべての行
  it('listFrbRowsForMatching returns every FRB row, including FETCHED, FAILED and SCHEDULED ones, with their URLs', async () => {
    const store = createSpeechBodyStore(ctx.serviceClient);
    const rows = new Map((await store.listFrbRowsForMatching()).map((r) => [r.id, r]));
    for (const id of Object.values(ids)) expect(rows.has(id), id).toBe(true);
    expect(rows.get(ids.pending)).toMatchObject({ source_url: URL_OK, speaker_organization: 'FRB' }); // 前のテストで FETCHED
    expect(rows.get(ids.failed3)?.source_url).toBe(URL_OK);
    expect(rows.get(ids.scheduled)?.source_url).toBeNull();
  });

  it('the quality reader reads the chapter 11 counts (the capped FAILED row is counted)', async () => {
    const status = await createQualityReader(ctx.serviceClient).speechPipelineStatus(new Date().toISOString());
    expect(status).not.toBeNull();
    expect(status!.bodyAtCap).toBeGreaterThanOrEqual(1);
    expect(status!.bodyFailedRetrying).toBeGreaterThanOrEqual(1);
    expect(status!.lastRuns.map((r) => r.job)).toEqual(['ingest:speech-bodies', 'ingest:speech-summaries']);
  });
});

// HQレビュー(2026-11-12): PENDING も回数で止める。PENDING・FAILED × 回数 0〜3 の対象判定と、異常終了のケース。
describe.skipIf(!integration)('speech bodies: the attempt cap for PENDING and FAILED (real Postgres)', () => {
  let ctx: IntegrationContext;
  const runId = `${Date.now()}m`;
  const speakerId = randomUUID();
  const matrix: { id: string; status: 'PENDING' | 'FAILED'; attempts: number }[] = [];
  for (const status of ['PENDING', 'FAILED'] as const) {
    for (const attempts of [0, 1, 2, 3]) matrix.push({ id: randomUUID(), status, attempts });
  }
  const crashId = randomUUID();
  const at = (i: number) => new Date(Date.now() - (2 * 86_400_000 + i * 60_000)).toISOString();

  beforeAll(async () => {
    ctx = buildIntegrationContext(integration!);
    const speaker = await ctx.serviceClient.from('speakers').insert({
      id: speakerId,
      name: `上限テスト ${runId}`,
      title: 'FRB理事',
      organization: 'FRB',
      country_code: 'US',
      currency_code: 'USD',
    });
    if (speaker.error) throw speaker.error;
    const base = {
      speaker_id: speakerId,
      provider: 'frb_calendar',
      title: '講演: Cap test',
      importance: 'MEDIUM',
      status: 'DELIVERED',
    };
    const rows: Record<string, unknown>[] = [
      ...matrix.map((m, i) => ({
        ...base,
        id: m.id,
        provider_event_id: `cap-${runId}-${i}`,
        statement_datetime: at(i),
        body_status: m.status,
        body_error: m.status === 'FAILED' ? 'HTTP_404' : null,
        body_attempts: m.attempts,
      })),
      { ...base, id: crashId, provider_event_id: `cap-${runId}-crash`, statement_datetime: at(20), body_attempts: 2 },
    ];
    for (const row of rows) {
      const { error } = await ctx.serviceClient.from('speech_events').insert(row);
      if (error) throw error;
    }
  });

  afterAll(async () => {
    if (!ctx) return;
    await ctx.serviceClient
      .from('speech_events')
      .delete()
      .in('id', [...matrix.map((m) => m.id), crashId]);
    await ctx.serviceClient.from('speakers').delete().eq('id', speakerId);
    await ctx.app.close();
  });

  it('PENDING and FAILED with attempts 0, 1, 2 are listed; 3 is not (both states)', async () => {
    const store = createSpeechBodyStore(ctx.serviceClient);
    const since = new Date(Date.now() - 14 * 86_400_000).toISOString();
    const listed = new Set((await store.listSpeechesNeedingBody(['frb_calendar'], since, 3)).map((r) => r.id));
    for (const m of matrix) expect(listed.has(m.id), `${m.status} attempts=${m.attempts}`).toBe(m.attempts < 3);
  });

  it('the DB refuses to count past the cap, for PENDING and FAILED alike', async () => {
    const store = createSpeechBodyStore(ctx.serviceClient);
    for (const m of matrix.filter((x) => x.attempts === 3)) {
      expect(await store.claimBodyAttempt(m.id, 3, new Date().toISOString(), 3), m.status).toBe(false);
    }
  });

  it('abnormal end after counting (left PENDING): the third attempt is the last, then the row is no longer listed', async () => {
    const store = createSpeechBodyStore(ctx.serviceClient);
    const since = new Date(Date.now() - 14 * 86_400_000).toISOString();
    expect((await store.listSpeechesNeedingBody(['frb_calendar'], since, 3)).some((r) => r.id === crashId)).toBe(true);
    // 3回目を数えた直後に異常終了した(結果を書かないまま) → PENDING・回数3のまま残る
    expect(await store.claimBodyAttempt(crashId, 2, new Date().toISOString(), 3)).toBe(true);
    const { data, error } = await ctx.serviceClient
      .from('speech_events')
      .select('body_status, body_attempts')
      .eq('id', crashId)
      .single();
    if (error) throw error;
    expect(data).toEqual({ body_status: 'PENDING', body_attempts: 3 });
    // もう自動の対象にならず、数えることもできない
    expect((await store.listSpeechesNeedingBody(['frb_calendar'], since, 3)).some((r) => r.id === crashId)).toBe(false);
    expect(await store.claimBodyAttempt(crashId, 3, new Date().toISOString(), 3)).toBe(false);
  });
});
