import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PushPlanItem } from '../../src/domain/pushNotifications.js';
import { createPushStore } from '../../src/repositories/pushRepository.js';
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
 * プッシュ通知(migration 20261110000005、routes/pushNotifications.ts、repositories/pushRepository.ts)を本物の
 * Postgres・PostgREST・GoTrue で確かめる(HQ指示 2026-11-10)。APNs には送らない(送信は tests/push の偽物で確かめる)。
 * 予定の行の対象(target_id)はこのテストだけの乱数の uuid(イベントの表には触れない)。
 */
describe.skipIf(!integration)('Push notifications: devices, favorites, history, queue', () => {
  let ctx: IntegrationContext;
  let a: TestUser;
  let b: TestUser;
  const tokenA = 'AB'.repeat(32); // 大文字で送り、小文字で保存される
  const auth = (u: TestUser) => ({ authorization: `Bearer ${u.accessToken}` });
  const asUser = (u: TestUser) =>
    createClient(integration!.env.SUPABASE_URL, integration!.anonKey, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${u.accessToken}` } },
    });

  beforeAll(async () => {
    ctx = buildIntegrationContext(integration!);
    a = await createTestUser(ctx);
    b = await createTestUser(ctx);
  });

  afterAll(async () => {
    if (!ctx) return;
    for (const u of [a, b]) if (u) await deleteTestUser(ctx, u.id); // 端末・お気に入り・予定は cascade で消える
    await ctx.app.close();
  });

  const post = (u: TestUser | null, body: unknown) =>
    ctx.app.inject({
      method: 'POST',
      url: '/api/v1/notifications/push/devices',
      headers: u ? auth(u) : {},
      payload: body as object,
    });

  it('registers a device (201), re-registers it (200), lists only own devices without the full token', async () => {
    const first = await post(a, { device_token: tokenA, environment: 'SANDBOX', app_version: '1.0 (20)' });
    expect(first.statusCode).toBe(201);
    expect(first.json()).toMatchObject({
      environment: 'SANDBOX',
      token_suffix: 'abababab',
      is_active: true,
      app_version: '1.0 (20)',
      disabled_reason: null,
    });
    expect(JSON.stringify(first.json())).not.toContain(tokenA.toLowerCase());
    const again = await post(a, { device_token: tokenA, environment: 'SANDBOX' });
    expect(again.statusCode).toBe(200);
    expect(again.json().id).toBe(first.json().id);

    const listA = await ctx.app.inject({ method: 'GET', url: '/api/v1/notifications/push/devices', headers: auth(a) });
    expect(listA.json().items).toHaveLength(1);
    const listB = await ctx.app.inject({ method: 'GET', url: '/api/v1/notifications/push/devices', headers: auth(b) });
    expect(listB.json().items).toEqual([]);
  });

  it('status: server push is not available while APNs is not configured (CI has no credentials)', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/v1/notifications/push/status', headers: auth(a) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ server_push_available: false });
  });

  it('rejects bad input (422) and anonymous calls (401)', async () => {
    expect((await post(a, { device_token: 'xyz', environment: 'SANDBOX' })).statusCode).toBe(422);
    expect((await post(a, { device_token: tokenA, environment: 'DEV' })).statusCode).toBe(422);
    expect((await post(null, { device_token: tokenA, environment: 'SANDBOX' })).statusCode).toBe(401);
  });

  it('another user cannot delete my device (404); I can (USER_UNREGISTERED); a token registered by another user moves to them', async () => {
    const mine = (await post(a, { device_token: 'cd'.repeat(32), environment: 'PRODUCTION' })).json();
    const byB = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/v1/notifications/push/devices/${mine.id}`,
      headers: auth(b),
    });
    expect(byB.statusCode).toBe(404);
    const byA = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/v1/notifications/push/devices/${mine.id}`,
      headers: auth(a),
    });
    expect(byA.statusCode).toBe(200);
    expect(byA.json()).toMatchObject({ is_active: false, disabled_reason: 'USER_UNREGISTERED' });

    // 同じ端末で B がログインして登録 → A の一覧から消え、B のものになる
    const moved = await post(b, { device_token: tokenA, environment: 'SANDBOX' });
    expect(moved.statusCode).toBe(200);
    const listA = (
      await ctx.app.inject({ method: 'GET', url: '/api/v1/notifications/push/devices', headers: auth(a) })
    ).json();
    expect(listA.items.map((d: { token_suffix: string }) => d.token_suffix)).toEqual(['cdcdcdcd']);
    const listB = (
      await ctx.app.inject({ method: 'GET', url: '/api/v1/notifications/push/devices', headers: auth(b) })
    ).json();
    expect(listB.items.map((d: { token_suffix: string }) => d.token_suffix)).toEqual(['abababab']);
    // 他人の行は service の API でも返らない
    const store = createPushStore(ctx.serviceClient);
    expect((await store.listActiveDevices(a.id)).map((d) => d.device_token)).toEqual([]);
    expect((await store.listActiveDevices(b.id)).map((d) => d.device_token)).toEqual([tokenA.toLowerCase()]);
  });

  it('favorite currencies: replace and read; FREE is limited to 3 (403 PLAN_LIMIT_EXCEEDED); unknown codes 422', async () => {
    const put = (codes: string[]) =>
      ctx.app.inject({
        method: 'PUT',
        url: '/api/v1/notifications/push/favorite-currencies',
        headers: auth(a),
        payload: { currency_codes: codes },
      });
    const ok = await put(['JPY', 'USD', 'JPY']);
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ currency_codes: ['JPY', 'USD'], limit: 3 });
    const tooMany = await put(['JPY', 'USD', 'EUR', 'GBP']);
    expect(tooMany.statusCode).toBe(403);
    expect(tooMany.json().error).toMatchObject({ code: 'PLAN_LIMIT_EXCEEDED', required_plan: 'PRO' });
    expect((await put(['XXX'])).statusCode).toBe(422);
    const got = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/notifications/push/favorite-currencies',
      headers: auth(a),
    });
    expect(got.json()).toEqual({ currency_codes: ['JPY', 'USD'], limit: 3 });
    const gotB = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/notifications/push/favorite-currencies',
      headers: auth(b),
    });
    expect(gotB.json().currency_codes).toEqual([]);
  });

  const item = (userId: string, over: Partial<PushPlanItem> = {}): PushPlanItem => {
    const at = new Date(Date.now() + 10 * 60_000).toISOString();
    return {
      user_id: userId,
      push_type: 'PRE_RELEASE',
      target_kind: 'INDICATOR',
      target_id: randomUUID(),
      event_scheduled_at: at,
      reason: 'SETTINGS',
      scheduled_send_at: new Date(Date.now() - 60_000).toISOString(), // もう送る時刻
      expires_at: new Date(Date.now() + 12 * 60_000).toISOString(),
      title: 'IT title',
      body: 'IT body',
      payload: { it: true },
      ...over,
    };
  };

  it('the queue keeps one row per user/type/target/time, and two concurrent claims never take the same row', async () => {
    const store = createPushStore(ctx.serviceClient);
    const one = item(a.id);
    expect(await store.enqueue([one])).toBe(1);
    expect(await store.enqueue([one, { ...one }])).toBe(0); // 重複は入らない
    expect(
      await store.enqueue([
        {
          ...one,
          event_scheduled_at: new Date(Date.now() + 70 * 60_000).toISOString(),
          expires_at: new Date(Date.now() + 80 * 60_000).toISOString(),
        },
      ]),
    ).toBe(1); // 延期 = 別の行
    await store.enqueue([item(a.id), item(a.id)]);

    const [c1, c2] = await Promise.all([store.claimDue(2, 60), store.claimDue(2, 60)]);
    const mine = [...c1, ...c2].filter((r) => r.user_id === a.id);
    const ids = mine.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length); // 同じ行を2回取らない
    expect(mine.length).toBeGreaterThanOrEqual(3);
    expect(mine.every((r) => r.status === 'SENDING')).toBe(true);

    // finish は SENDING の行だけを変える(2回目は何もしない)
    await store.finish(ids[0]!, {
      status: 'SENT',
      status_reason: null,
      attempts: 1,
      sent_at: new Date().toISOString(),
    });
    await store.finish(ids[0]!, { status: 'FAILED', status_reason: 'X' });
    const { data } = await ctx.serviceClient.from('push_notifications').select('status').eq('id', ids[0]!).single();
    expect(data).toEqual({ status: 'SENT' });
    // 残りは片付ける(ほかのテストの取り出しに出ないように)
    await ctx.serviceClient.from('push_notifications').update({ status: 'CANCELLED' }).in('id', ids.slice(1));

    const bad = await ctx.serviceClient.rpc('claim_due_push_notifications', { p_limit: 0, p_lease_seconds: 60 });
    expect(bad.error?.code).toBe('22023');
  });

  it('history: each user sees only their own rows', async () => {
    const histA = await ctx.app.inject({ method: 'GET', url: '/api/v1/notifications/push/history', headers: auth(a) });
    expect(histA.statusCode).toBe(200);
    expect(histA.json().items.length).toBeGreaterThanOrEqual(1);
    expect(histA.json().items.every((i: { title: string }) => i.title === 'IT title')).toBe(true);
    const histB = await ctx.app.inject({ method: 'GET', url: '/api/v1/notifications/push/history', headers: auth(b) });
    expect(histB.json().items).toEqual([]);
  });

  it('direct table access with a user JWT: own rows only, no writes, no delivery log, no claim', async () => {
    const clientA = asUser(a);
    const devices = await clientA.from('push_devices').select('user_id');
    expect(devices.error).toBeNull();
    expect((devices.data ?? []).every((d: { user_id: string }) => d.user_id === a.id)).toBe(true);
    const othersQueue = await clientA.from('push_notifications').select('id').eq('user_id', b.id);
    expect(othersQueue.data).toEqual([]);
    const insert = await clientA
      .from('push_devices')
      .insert({ user_id: a.id, device_token: 'ef'.repeat(32), environment: 'SANDBOX' });
    expect(insert.error).not.toBeNull();
    const fav = await clientA.from('push_favorite_currencies').insert({ user_id: a.id, currency_code: 'EUR' });
    expect(fav.error).not.toBeNull();
    expect((await clientA.from('push_delivery_attempts').select('id').limit(1)).error?.code).toBe('42501');
    expect(
      (await clientA.rpc('claim_due_push_notifications', { p_limit: 1, p_lease_seconds: 60 })).error,
    ).not.toBeNull();
  });
});
