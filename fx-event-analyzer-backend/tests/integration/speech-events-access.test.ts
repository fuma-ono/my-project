import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  buildIntegrationContext,
  createTestUser,
  deleteTestUser,
  loadIntegrationEnv,
  type IntegrationContext,
  type TestUser,
} from './setup.js';

const integration = loadIntegrationEnv();

/**
 * speech_events の直接参照の禁止 (migration 20261125000001, HQ判断 2026-11-24):
 * anon / authenticated は Supabase に直接つないでこの表(本文 speech_body・要約を含む)を
 * 読み書きできない(権限が無い = 42501)。Backend(service_role)の読み方は変わらない。
 */
describe.skipIf(!integration)('speech_events: no client access, service_role unchanged', () => {
  let ctx: IntegrationContext;
  let user: TestUser;
  const runId = `${Date.now()}`;
  const speakerId = randomUUID();
  const speechId = randomUUID();

  function clients(): { label: string; client: SupabaseClient }[] {
    const options = { auth: { autoRefreshToken: false, persistSession: false } };
    return [
      { label: 'anon', client: createClient(ctx.supabaseUrl, ctx.anonKey, options) },
      {
        label: 'authenticated',
        client: createClient(ctx.supabaseUrl, ctx.anonKey, {
          ...options,
          global: { headers: { Authorization: `Bearer ${user.accessToken}` } },
        }),
      },
    ];
  }

  beforeAll(async () => {
    ctx = buildIntegrationContext(integration!);
    user = await createTestUser(ctx);
    const speaker = await ctx.serviceClient.from('speakers').insert({
      id: speakerId,
      name: `権限テスト ${runId}`,
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
      provider_event_id: `speech-access-${runId}`,
      title: '講演: Access',
      statement_datetime: '2097-03-01T00:00:00Z',
      importance: 'LOW',
      status: 'SCHEDULED',
    });
    if (speech.error) throw speech.error;
  });

  afterAll(async () => {
    if (!ctx) return;
    await ctx.serviceClient.from('speech_events').delete().eq('id', speechId);
    await ctx.serviceClient.from('speakers').delete().eq('id', speakerId);
    if (user) await deleteTestUser(ctx, user.id);
    await ctx.app.close();
  });

  it('service_role still reads the row (body columns included)', async () => {
    const result = await ctx.serviceClient
      .from('speech_events')
      .select('id, speech_body, body_status')
      .eq('id', speechId)
      .single();
    expect(result.error).toBeNull();
    expect(result.data?.id).toBe(speechId);
  });

  it('anon / authenticated get a permission error (42501) on SELECT, never rows', async () => {
    for (const { label, client } of clients()) {
      const result = await client.from('speech_events').select('id, speech_body').eq('id', speechId);
      const detail = `${label}: ${JSON.stringify(result)}`;
      expect(result.error?.code, detail).toBe('42501');
      expect(result.data, detail).toBeNull();
    }
  });

  it('anon / authenticated cannot write', async () => {
    for (const { label, client } of clients()) {
      const update = await client.from('speech_events').update({ title: 'x' }).eq('id', speechId);
      expect(update.error?.code, label).toBe('42501');
    }
  });
});
