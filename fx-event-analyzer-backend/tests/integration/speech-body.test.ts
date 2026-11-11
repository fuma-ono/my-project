import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FEATURE_CODES } from '../../src/authorization/entitlements.js';
import { createSpeechBodyStore } from '../../src/repositories/speechBodyRepository.js';
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
 * HQ指示(2026-11-10「要人発言本文の取得・保存機能」): migration 20261110000001(speech_events の source_url・speech_body・
 * body_fetched_at・body_status・body_error)と、本文のストア・GET /speeches/{id} を本物の Postgres で確かめる。
 * 既存の行は PENDING になる(壊れない)・公式サイト以外の URL は入らない・FETCHED には本文と取得日時が要る・API は
 * source_url と body_status を返し、本文は返さない。
 */
describe.skipIf(!integration)('speech bodies: migration, store and GET /speeches/{id}', () => {
  let ctx: IntegrationContext;
  const users: TestUser[] = [];
  const runId = `${Date.now()}`;
  const speakerId = randomUUID();
  const speechId = randomUUID();
  const URL_OK = 'https://www.federalreserve.gov/newsevents/speech/test20261105a.htm';

  beforeAll(async () => {
    ctx = buildIntegrationContext(integration!);
    const speaker = await ctx.serviceClient.from('speakers').insert({
      id: speakerId,
      name: `本文テスト ${runId}`,
      title: 'FRB理事',
      organization: 'FRB',
      country_code: 'US',
      currency_code: 'USD',
    });
    if (speaker.error) throw speaker.error;
    const speech = await ctx.serviceClient.from('speech_events').insert({
      id: speechId,
      speaker_id: speakerId,
      provider: 'frb_calendar',
      provider_event_id: `body-test-${runId}`,
      title: '講演: Test',
      statement_datetime: '2026-11-05T15:00:00Z',
      importance: 'MEDIUM',
      status: 'DELIVERED',
    });
    if (speech.error) throw speech.error;
  });

  afterAll(async () => {
    if (!ctx) return;
    for (const user of users) await deleteTestUser(ctx, user.id);
    await ctx.serviceClient.from('speech_events').delete().eq('id', speechId);
    await ctx.serviceClient.from('speakers').delete().eq('id', speakerId);
    await ctx.app.close();
  });

  async function getSpeech() {
    const user = await createTestUser(ctx);
    users.push(user);
    await grantEntitlement(ctx, user.id, FEATURE_CODES.VIEW_BASIC_EVENT);
    const response = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/speeches/${speechId}`,
      headers: { authorization: `Bearer ${user.accessToken}` },
    });
    return { status: response.statusCode, body: JSON.parse(response.body) as Record<string, unknown> };
  }

  it('a row without the new columns gets body_status PENDING and nulls (existing rows are not broken)', async () => {
    const { data, error } = await ctx.serviceClient
      .from('speech_events')
      .select('source_url, speech_body, body_fetched_at, body_status, body_error')
      .eq('id', speechId)
      .single();
    if (error) throw error;
    expect(data).toEqual({
      source_url: null,
      speech_body: null,
      body_fetched_at: null,
      body_status: 'PENDING',
      body_error: null,
    });
    const { status, body } = await getSpeech();
    expect(status).toBe(200);
    expect(body).toMatchObject({ source_url: null, body_status: 'PENDING', summary_status: 'NOT_AVAILABLE' });
  });

  it('the DB refuses a non-official URL, an unknown status and FETCHED without a body', async () => {
    const update = (patch: Record<string, unknown>) =>
      ctx.serviceClient.from('speech_events').update(patch).eq('id', speechId);
    expect((await update({ source_url: 'https://example.com/speech.htm' })).error?.message).toMatch(
      /source_url_official/,
    );
    expect((await update({ source_url: 'http://www.federalreserve.gov/x.htm' })).error?.message).toMatch(
      /source_url_official/,
    );
    expect((await update({ body_status: 'DONE' })).error?.message).toMatch(/body_status_check/);
    expect((await update({ source_url: URL_OK, body_status: 'FETCHED' })).error?.message).toMatch(/body_fetched_check/);
  });

  it('the store lists the speech, writes the body; the API returns the URL and status but never the body', async () => {
    const store = createSpeechBodyStore(ctx.serviceClient);
    const listed = await store.listSpeechesNeedingBody(['frb_calendar'], '2026-11-01T00:00:00Z');
    const mine = listed.find((row) => row.id === speechId);
    expect(mine).toMatchObject({
      provider: 'frb_calendar',
      status: 'DELIVERED',
      body_status: 'PENDING',
      speaker_organization: 'FRB',
    });

    await store.updateSpeechBody(speechId, {
      source_url: URL_OK,
      speech_body: 'Thank you for having me.',
      body_fetched_at: '2026-11-10T06:00:00Z',
      body_status: 'FETCHED',
      body_error: null,
    });
    // FETCHED になった行は、もう候補に入らない
    expect(
      (await store.listSpeechesNeedingBody(['frb_calendar'], '2026-11-01T00:00:00Z')).some((r) => r.id === speechId),
    ).toBe(false);

    const { status, body } = await getSpeech();
    expect(status).toBe(200);
    expect(body).toMatchObject({ source_url: URL_OK, body_status: 'FETCHED' });
    expect(JSON.stringify(body)).not.toContain('Thank you for having me.'); // 本文はまだ返さない(権利が未確認)
    expect(body).not.toHaveProperty('speech_body');
  });
});
