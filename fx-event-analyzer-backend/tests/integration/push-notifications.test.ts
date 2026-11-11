import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { IndicatorNotificationCandidate } from '../../src/domain/notifications.js';
import type { PushPlanItem, PushUserContext } from '../../src/domain/pushNotifications.js';
import type { PushDevice, PushMessage, PushSender, SendResult } from '../../src/push/apnsSender.js';
import { enqueuePushNotifications, sendDuePushNotifications, type PushStore } from '../../src/push/pushJobs.js';
import { cleanupPushNotifications, createPushStore, getPushQueueStats } from '../../src/repositories/pushRepository.js';
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

    const [c1, c2] = await Promise.all([store.claimDue(2, 60, 3), store.claimDue(2, 60, 3)]);
    const mine = [...c1, ...c2].filter((r) => r.user_id === a.id);
    const ids = mine.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length); // 同じ行を2回取らない
    expect(mine.length).toBeGreaterThanOrEqual(3);
    expect(mine.every((r) => r.status === 'SENDING')).toBe(true);

    // finish は、取り出しの印が一致する SENDING の行だけを変える(2回目・違う印は何もしない)
    const first = mine[0]!;
    expect(
      await store.finish(first.id, '00000000-0000-4000-8000-000000000000', { status: 'FAILED', status_reason: 'X' }),
    ).toBe(false);
    await store.finish(first.id, first.claim_token, {
      status: 'SENT',
      status_reason: null,
      attempts: 1,
      sent_at: new Date().toISOString(),
    });
    expect(await store.finish(first.id, first.claim_token, { status: 'FAILED', status_reason: 'X' })).toBe(false);
    const { data } = await ctx.serviceClient.from('push_notifications').select('status').eq('id', ids[0]!).single();
    expect(data).toEqual({ status: 'SENT' });
    // 残りは片付ける(ほかのテストの取り出しに出ないように)
    await ctx.serviceClient.from('push_notifications').update({ status: 'CANCELLED' }).in('id', ids.slice(1));

    const bad = await ctx.serviceClient.rpc('claim_due_push_notifications', {
      p_limit: 0,
      p_lease_seconds: 60,
      p_max_recoveries: 3,
    });
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
      (await clientA.rpc('claim_due_push_notifications', { p_limit: 1, p_lease_seconds: 60, p_max_recoveries: 3 }))
        .error,
    ).not.toBeNull();
    for (const fn of ['expire_push_notifications', 'push_queue_stats', 'cleanup_push_notifications']) {
      expect(
        (await clientA.rpc(fn, fn === 'push_queue_stats' ? { p_since: new Date().toISOString() } : {})).error,
        fn,
      ).not.toBeNull();
    }
  });

  /**
   * 障害復旧・信頼性強化(HQ指示 2026-11-10)を本物の DB の関数で: claim・持ち時間・取り直し・IN_FLIGHT → UNKNOWN・
   * 印の照合・期限切れの整理・集計。イベントの候補と利用者の設定だけはメモリで渡す(イベントの表に触れない)。
   */
  describe('failure recovery against the real queue functions', () => {
    let c: TestUser;
    const deviceIds: string[] = [];
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const userCtx = (): PushUserContext => ({
      userId: c.id,
      language: 'ja',
      favoriteCurrencies: [],
      prefs: {
        push: true,
        indicators: true,
        speeches: true,
        fxPairSymbols: null,
        importances: ['HIGH', 'MEDIUM', 'LOW'],
        leadMinutes: 5,
        quietHours: { enabled: false, start: '23:00', end: '07:00' },
        timeZone: 'UTC',
      },
    });
    const candidates = new Map<string, IndicatorNotificationCandidate>();
    /** 実際の DB の store。イベントの候補と設定だけ差し替え、finish / completeAttempt の失敗を1回だけ起こせる。 */
    const dbStore = (fail: { finish?: boolean; complete?: boolean } = {}): PushStore => {
      const real = createPushStore(ctx.serviceClient);
      return {
        ...real,
        loadUserContext: (userId) => Promise.resolve(userId === c.id ? userCtx() : null),
        listCandidatesByIds: (ids) =>
          Promise.resolve([...ids.indicators].map((id) => candidates.get(id)).filter((x) => x !== undefined)),
        finish: (id, token, update) => {
          if (fail.finish) {
            fail.finish = false;
            return Promise.reject(new Error('DB down before marking SENT'));
          }
          return real.finish(id, token, update);
        },
        completeAttempt: (id, result, max) => {
          if (fail.complete) {
            fail.complete = false;
            return Promise.reject(new Error('DB down after APNs success'));
          }
          return real.completeAttempt(id, result, max);
        },
      };
    };
    class Sender implements PushSender {
      sent: { device: PushDevice; message: PushMessage }[] = [];
      constructor(
        private readonly byNotification: Record<string, SendResult> = {},
        /** 端末ごとの結果(順に使う。無くなったら byNotification・SUCCESS) */
        private readonly byDevice: Record<string, SendResult[]> = {},
      ) {}
      send(device: PushDevice, message: PushMessage): Promise<SendResult> {
        this.sent.push({ device, message });
        const queued = this.byDevice[device.id]?.shift();
        if (queued) return Promise.resolve(queued);
        return Promise.resolve(
          this.byNotification[message.notificationId] ?? {
            outcome: 'SUCCESS',
            httpStatus: 200,
            apnsId: 'ok',
            reason: null,
          },
        );
      }
    }
    /** 送る時刻を過ぎた PENDING の行を1件入れる(対象のイベントの候補も作る)。戻り値 = 行の id。 */
    const due = async (over: Partial<PushPlanItem> = {}): Promise<string> => {
      const targetId = randomUUID();
      const eventAt = new Date(Date.now() + 5 * 60_000).toISOString();
      candidates.set(targetId, {
        kind: 'INDICATOR',
        id: targetId,
        title: 'IT indicator',
        display_name: null,
        importance: 'HIGH',
        status: 'SCHEDULED',
        scheduled_at: eventAt,
        release_datetime_precision: 'EXACT',
        country_code: 'US',
        currency_code: 'USD',
        related_fx_pairs: ['USDJPY'],
      });
      const row = item(c.id, { target_id: targetId, event_scheduled_at: eventAt, ...over });
      const { data, error } = await ctx.serviceClient
        .from('push_notifications')
        .insert({ ...row, next_attempt_at: row.scheduled_send_at })
        .select('id')
        .single();
      if (error) throw error;
      return data.id;
    };
    const rowOf = async (id: string) => {
      const { data, error } = await ctx.serviceClient
        .from('push_notifications')
        .select(
          'status, status_reason, attempts, recovery_count, next_attempt_at, last_error, claim_token, lease_until',
        )
        .eq('id', id)
        .single();
      if (error) throw error;
      return data as Record<string, unknown>;
    };
    const attemptsOf = async (id: string) => {
      const { data, error } = await ctx.serviceClient
        .from('push_delivery_attempts')
        .select('device_id, outcome, reason, attempt')
        .eq('notification_id', id)
        .order('attempted_at');
      if (error) throw error;
      return (data ?? []) as { device_id: string; outcome: string; reason: string | null; attempt: number }[];
    };
    /** ほかの行が取り出しに入らないように、キューの未完了の行を片付ける(push の表を使うのはこのファイルだけ)。 */
    const resetQueue = async () => {
      const { error } = await ctx.serviceClient
        .from('push_notifications')
        .update({ status: 'CANCELLED', status_reason: 'IT_RESET', claim_token: null, lease_until: null })
        .in('status', ['PENDING', 'SENDING']);
      if (error) throw error;
    };

    beforeAll(async () => {
      c = await createTestUser(ctx);
      for (const token of ['e1'.repeat(32), 'e2'.repeat(32)]) {
        const { data, error } = await ctx.serviceClient
          .from('push_devices')
          .insert({ user_id: c.id, device_token: token, environment: 'SANDBOX' })
          .select('id')
          .single();
        if (error) throw error;
        deviceIds.push(data.id);
      }
    });

    afterAll(async () => {
      if (c) await deleteTestUser(ctx, c.id);
    });

    it('1-2. a worker stops right after sending: the SENDING row is recovered after the lease, IN_FLIGHT becomes UNKNOWN and is re-sent', async () => {
      await resetQueue();
      const id = await due();
      const store = dbStore();
      const [claimed] = (await store.claimDue(10, 1, 3)).filter((r) => r.id === id);
      expect(claimed).toBeDefined();
      await store.startAttempt({
        notification_id: id,
        device_id: deviceIds[0]!,
        attempt: 1,
        claim_token: claimed!.claim_token,
      });
      // ここでプロセスが止まった: 行は SENDING、記録は IN_FLIGHT のまま
      expect(await rowOf(id)).toMatchObject({ status: 'SENDING', recovery_count: 0 });
      await sleep(1_300);
      const sender = new Sender();
      const result = await sendDuePushNotifications({ store, sender, leaseSeconds: 30 });
      expect(result).toMatchObject({ claimed: 1, recovered: 1, resent_unknown: 2, sent: 1 }); // 取り直した行で2台に送った
      expect(await rowOf(id)).toMatchObject({
        status: 'SENT',
        recovery_count: 1,
        claim_token: null,
        lease_until: null,
      });
      const attempts = await attemptsOf(id);
      const of = (device: string) => attempts.filter((a) => a.device_id === device).map((a) => a.outcome);
      // 止まった端末: 取り直しで UNKNOWN(届いたか分からない)→ 送り直し(At Least Once)。もう1台は初めて
      expect(of(deviceIds[0]!)).toEqual(['UNKNOWN', 'SUCCESS']);
      expect(of(deviceIds[1]!)).toEqual(['SUCCESS']);
      expect(attempts[0]!.reason).toBe('LEASE_EXPIRED_DURING_SEND');
    });

    it('3. a SENDING row within its lease is not recovered, and the lease can be extended only with its claim token', async () => {
      await resetQueue();
      const id = await due();
      const store = dbStore();
      const [claimed] = (await store.claimDue(10, 60, 3)).filter((r) => r.id === id);
      expect((await store.claimDue(10, 60, 3)).map((r) => r.id)).not.toContain(id);
      expect(await store.renewLease(id, claimed!.claim_token, 60)).toBe(true);
      expect(await store.renewLease(id, randomUUID(), 60)).toBe(false);
      expect(await rowOf(id)).toMatchObject({ status: 'SENDING', recovery_count: 0 });
    });

    it('4. two workers claiming at the same time never get the same row (and a lost claim cannot write)', async () => {
      await resetQueue();
      const ids = [await due(), await due(), await due()];
      const store = dbStore();
      const [w1, w2] = await Promise.all([store.claimDue(2, 1, 3), store.claimDue(2, 1, 3)]);
      const got = [...w1, ...w2].map((r) => r.id).filter((x) => ids.includes(x));
      expect(new Set(got).size).toBe(got.length);
      expect(got.sort()).toEqual([...ids].sort());
      // 持ち時間が切れて別の worker が取り直したら、前の worker の印では書けない
      await sleep(1_300);
      const old = [...w1, ...w2].find((r) => r.id === ids[0])!;
      const [fresh] = (await store.claimDue(10, 60, 3)).filter((r) => r.id === ids[0]);
      expect(fresh!.claim_token).not.toBe(old.claim_token);
      expect(await store.finish(old.id, old.claim_token, { status: 'FAILED', status_reason: 'X' })).toBe(false);
      expect(await rowOf(ids[0]!)).toMatchObject({ status: 'SENDING', claim_token: fresh!.claim_token });
    });

    it('5a. APNs succeeded but marking SENT failed: recovered later and marked SENT without sending again', async () => {
      await resetQueue();
      const id = await due();
      const sender = new Sender();
      const first = await sendDuePushNotifications({ store: dbStore({ finish: true }), sender, leaseSeconds: 1 });
      expect(first.errors.join()).toContain('DB down before marking SENT');
      expect(await rowOf(id)).toMatchObject({ status: 'SENDING' });
      expect((await attemptsOf(id)).map((a) => a.outcome)).toEqual(['SUCCESS', 'SUCCESS']);
      await sleep(1_300);
      const second = await sendDuePushNotifications({ store: dbStore(), sender, leaseSeconds: 30 });
      expect(second).toMatchObject({ recovered: 1, sent: 1, resent_unknown: 0 });
      expect(sender.sent).toHaveLength(2); // 2台に1回ずつ。送り直していない
      expect(await rowOf(id)).toMatchObject({ status: 'SENT', recovery_count: 1 });
    });

    it('5b. APNs succeeded but recording the result failed: that device is UNKNOWN and gets it again (At Least Once)', async () => {
      await resetQueue();
      const id = await due();
      const sender = new Sender();
      await sendDuePushNotifications({ store: dbStore({ complete: true }), sender, leaseSeconds: 1 });
      const [inFlight] = await attemptsOf(id);
      expect(inFlight).toMatchObject({ outcome: 'IN_FLIGHT' });
      await sleep(1_300);
      const second = await sendDuePushNotifications({ store: dbStore(), sender, leaseSeconds: 30 });
      expect(second).toMatchObject({ recovered: 1, resent_unknown: 2, sent: 1 }); // 2台とも未完了だった
      expect((await attemptsOf(id)).map((a) => a.outcome)).toEqual(['UNKNOWN', 'SUCCESS', 'SUCCESS']);
      expect(sender.sent.filter((s) => s.device.id === inFlight!.device_id)).toHaveLength(2); // 二重になりうる端末
    });

    it('6. a timeout is retried after the back-off with the error kept', async () => {
      await resetQueue();
      const id = await due();
      const sender = new Sender({
        [id]: { outcome: 'RETRYABLE_ERROR', httpStatus: null, apnsId: null, reason: 'TIMEOUT' },
      });
      const before = Date.now();
      expect(await sendDuePushNotifications({ store: dbStore(), sender })).toMatchObject({ retried: 1 });
      const row = await rowOf(id);
      expect(row).toMatchObject({ status: 'PENDING', status_reason: 'RETRY', attempts: 1, last_error: 'ERR TIMEOUT' });
      expect(Date.parse(String(row.next_attempt_at))).toBeGreaterThanOrEqual(before + 55_000);
      expect((await attemptsOf(id)).map((a) => [a.outcome, a.reason])).toEqual([
        ['RETRYABLE_ERROR', 'TIMEOUT'],
        ['RETRYABLE_ERROR', 'TIMEOUT'],
      ]);
    });

    it('7. 429 / 500 are retried, 410 deactivates the device, 403 (config) stops the run without using an attempt', async () => {
      await resetQueue();
      const t = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
      const n429 = await due({ scheduled_send_at: t(4) });
      const n500 = await due({ scheduled_send_at: t(3) });
      const n403 = await due({ scheduled_send_at: t(2) });
      const after403 = await due({ scheduled_send_at: t(1) });
      const sender = new Sender({
        [n429]: { outcome: 'RETRYABLE_ERROR', httpStatus: 429, apnsId: null, reason: 'TooManyRequests' },
        [n500]: { outcome: 'RETRYABLE_ERROR', httpStatus: 500, apnsId: null, reason: 'InternalServerError' },
        [n403]: { outcome: 'CONFIG_ERROR', httpStatus: 403, apnsId: null, reason: 'InvalidProviderToken' },
      });
      const result = await sendDuePushNotifications({ store: dbStore(), sender });
      expect(result).toMatchObject({ retried: 2, config_error: true, released_config_error: 2 });
      expect(await rowOf(n429)).toMatchObject({ status: 'PENDING', status_reason: 'RETRY', attempts: 1 });
      expect(await rowOf(n500)).toMatchObject({ status: 'PENDING', status_reason: 'RETRY', attempts: 1 });
      expect(await rowOf(n403)).toMatchObject({ status: 'PENDING', status_reason: 'CONFIG_ERROR', attempts: 0 });
      expect(await rowOf(after403)).toMatchObject({ status: 'PENDING', status_reason: 'CONFIG_ERROR', attempts: 0 });
      expect(sender.sent.filter((s) => s.message.notificationId === after403)).toEqual([]); // 止めた後は送らない

      await resetQueue();
      const n410 = await due();
      const invalid = new Sender({
        [n410]: { outcome: 'INVALID_TOKEN', httpStatus: 410, apnsId: null, reason: 'Unregistered' },
      });
      expect(await sendDuePushNotifications({ store: dbStore(), sender: invalid })).toMatchObject({
        failed: 1,
        invalidated_devices: 2,
      });
      expect(await rowOf(n410)).toMatchObject({ status: 'FAILED', status_reason: 'ALL_TOKENS_INVALID' });
      const { data: devs } = await ctx.serviceClient
        .from('push_devices')
        .select('is_active, disabled_reason')
        .in('id', deviceIds);
      expect(devs).toEqual([
        { is_active: false, disabled_reason: 'APNS_INVALID_TOKEN' },
        { is_active: false, disabled_reason: 'APNS_INVALID_TOKEN' },
      ]);
      await ctx.serviceClient
        .from('push_devices')
        .update({ is_active: true, disabled_reason: null, disabled_at: null })
        .in('id', deviceIds);
    });

    it('8. at the attempt limit a retryable failure ends as FAILED MAX_ATTEMPTS and is not claimed again', async () => {
      await resetQueue();
      const id = await due();
      await ctx.serviceClient.from('push_notifications').update({ attempts: 4 }).eq('id', id);
      // 2台とも、結果の出た試行が4回(あと1回で上限)
      await ctx.serviceClient
        .from('push_notification_targets')
        .insert(deviceIds.map((device_id) => ({ notification_id: id, device_id, status: 'RETRY', attempts: 4 })));
      const sender = new Sender({
        [id]: { outcome: 'RETRYABLE_ERROR', httpStatus: 503, apnsId: null, reason: 'ServiceUnavailable' },
      });
      expect(await sendDuePushNotifications({ store: dbStore(), sender })).toMatchObject({ failed: 1 });
      expect(await rowOf(id)).toMatchObject({ status: 'FAILED', status_reason: 'MAX_ATTEMPTS', attempts: 5 });
      expect((await dbStore().claimDue(10, 60, 3)).map((r) => r.id)).not.toContain(id);
    });

    it('8b. a row that keeps stopping fails as STUCK_IN_SENDING after 3 recoveries', async () => {
      await resetQueue();
      const id = await due();
      const store = dbStore();
      for (let i = 0; i < 4; i += 1) {
        await store.claimDue(10, 1, 3);
        await sleep(1_100);
      }
      expect((await store.claimDue(10, 1, 3)).map((r) => r.id)).not.toContain(id);
      expect(await rowOf(id)).toMatchObject({ status: 'FAILED', status_reason: 'STUCK_IN_SENDING', recovery_count: 4 });
    }, 20_000);

    it('9. expired PENDING rows are swept to SKIPPED EXPIRED and never claimed', async () => {
      await resetQueue();
      const id = await due({
        scheduled_send_at: new Date(Date.now() - 10 * 60_000).toISOString(),
        expires_at: new Date(Date.now() - 60_000).toISOString(),
      });
      expect((await dbStore().claimDue(10, 60, 3)).map((r) => r.id)).not.toContain(id); // 期限切れは取らない
      const sender = new Sender();
      expect(await sendDuePushNotifications({ store: dbStore(), sender })).toMatchObject({ expired: 1, claimed: 0 });
      expect(await rowOf(id)).toMatchObject({ status: 'SKIPPED', status_reason: 'EXPIRED' });
      expect(sender.sent).toEqual([]);
    });

    it('10. without APNs credentials: expired rows are swept, nothing is claimed or sent, due rows stay PENDING', async () => {
      await resetQueue();
      const pending = await due();
      const old = await due({
        scheduled_send_at: new Date(Date.now() - 10 * 60_000).toISOString(),
        expires_at: new Date(Date.now() - 60_000).toISOString(),
      });
      const result = await sendDuePushNotifications({ store: dbStore(), sender: null });
      expect(result).toMatchObject({ expired: 1, claimed: 0, errors: ['APNS_NOT_CONFIGURED'] });
      expect(await rowOf(pending)).toMatchObject({ status: 'PENDING', attempts: 0, claim_token: null });
      expect(await rowOf(old)).toMatchObject({ status: 'SKIPPED', status_reason: 'EXPIRED' });
    });

    it('ops: queue stats report backlog / stuck / outcomes, and cleanup keeps PENDING rows and validates its arguments', async () => {
      await resetQueue();
      await due();
      const stuck = await due();
      await dbStore().claimDue(10, 1, 3); // 2件とも SENDING に
      await ctx.serviceClient
        .from('push_notifications')
        .update({ status: 'PENDING', claim_token: null, lease_until: null })
        .neq('id', stuck)
        .eq('status', 'SENDING')
        .eq('user_id', c.id);
      await sleep(1_100);
      const stats = await getPushQueueStats(ctx.serviceClient, new Date(Date.now() - 3_600_000).toISOString());
      expect(stats).toMatchObject({ pending_due: 1, sending: 1, sending_lease_expired: 1 });
      expect(Object.keys(stats).sort()).toEqual(
        [
          'attempts_since',
          'by_status_since',
          'targets_by_status_since',
          'targets_open',
          'oldest_due_seconds',
          'pending',
          'pending_due',
          'pending_retrying',
          'retried_notifications_since',
          'sending',
          'sending_lease_expired',
          'success_rate_since',
        ].sort(),
      );
      expect((stats.attempts_since as Record<string, number>).SUCCESS).toBeGreaterThanOrEqual(1);
      expect(await cleanupPushNotifications(ctx.serviceClient)).toBeGreaterThanOrEqual(0);
      expect((await rowOf(stuck)).status).toBe('SENDING'); // 未完了の行は消さない
      const bad = await ctx.serviceClient.rpc('cleanup_push_notifications', { p_keep_days: 30, p_keep_failed_days: 1 });
      expect(bad.error?.code).toBe('22023');
      await resetQueue();
    });

    /**
     * 複数端末・部分失敗(HQ指示 2026-11-10「複数端末配信・部分失敗対応」)。端末は deviceIds の2台(d0・d1)。
     * 次の回を待たずに試すときは next_attempt_at を今にする(待ちの長さは domain のテストで確かめている)。
     */
    describe('multi-device delivery and partial failure', () => {
      const e503: SendResult = {
        outcome: 'RETRYABLE_ERROR',
        httpStatus: 503,
        apnsId: null,
        reason: 'ServiceUnavailable',
      };
      const timeout: SendResult = { outcome: 'RETRYABLE_ERROR', httpStatus: null, apnsId: null, reason: 'TIMEOUT' };
      const perm: SendResult = { outcome: 'PERMANENT_ERROR', httpStatus: 400, apnsId: null, reason: 'PayloadTooLarge' };
      const d0 = () => deviceIds[0]!;
      const d1 = () => deviceIds[1]!;
      const targetsOf = async (id: string) => {
        const { data, error } = await ctx.serviceClient
          .from('push_notification_targets')
          .select('device_id, status, status_reason, attempts, last_error')
          .eq('notification_id', id);
        if (error) throw error;
        return Object.fromEntries(
          (
            (data ?? []) as {
              device_id: string;
              status: string;
              status_reason: string | null;
              attempts: number;
              last_error: string | null;
            }[]
          ).map((t) => [t.device_id, t]),
        );
      };
      const dueNow = (id: string) =>
        ctx.serviceClient.from('push_notifications').update({ next_attempt_at: new Date().toISOString() }).eq('id', id);
      const run = (sender: Sender) => sendDuePushNotifications({ store: dbStore(), sender });
      const sentTo = (sender: Sender, id: string) =>
        sender.sent.filter((x) => x.message.notificationId === id).map((x) => x.device.id);

      it('MD1. both devices succeed → SENT; history shows 2 of 2 delivered', async () => {
        await resetQueue();
        const id = await due();
        const sender = new Sender();
        expect(await run(sender)).toMatchObject({ sent: 1 });
        expect(await rowOf(id)).toMatchObject({ status: 'SENT', attempts: 1 });
        const t = await targetsOf(id);
        expect([t[d0()]!.status, t[d1()]!.status]).toEqual(['SUCCESS', 'SUCCESS']);
        const hist = await ctx.app.inject({
          method: 'GET',
          url: '/api/v1/notifications/push/history',
          headers: auth(c),
        });
        const mine = hist.json().items.find((i: { id: string }) => i.id === id);
        expect(mine).toMatchObject({
          status: 'SENT',
          devices: { total: 2, success: 2, failed: 0, pending: 0, cancelled: 0 },
        });
      });

      it('MD2-5. one succeeds, one gets 503 / timeout → PENDING; the retry goes only to the failed device and never to the succeeded one', async () => {
        await resetQueue();
        const a503 = await due();
        const aTimeout = await due();
        const sender = new Sender({}, { [d1()]: [e503, timeout] });
        expect(await run(sender)).toMatchObject({ retried: 2, sent: 0 }); // 1台の成功で SENT にしない
        for (const [id, error] of [
          [a503, '503 ServiceUnavailable'],
          [aTimeout, 'TIMEOUT'],
        ] as const) {
          expect(await rowOf(id)).toMatchObject({ status: 'PENDING', status_reason: 'RETRY', attempts: 1 });
          const t = await targetsOf(id);
          expect(t[d0()]).toMatchObject({ status: 'SUCCESS', attempts: 1 });
          expect(t[d1()]).toMatchObject({ status: 'RETRY', attempts: 1, last_error: error });
        }
        await dueNow(a503);
        await dueNow(aTimeout);
        const retry = new Sender();
        expect(await run(retry)).toMatchObject({ sent: 2 });
        expect(sentTo(retry, a503)).toEqual([d1()]); // 失敗した端末だけ
        expect(sentTo(retry, aTimeout)).toEqual([d1()]);
        for (const id of [a503, aTimeout]) {
          expect(await rowOf(id)).toMatchObject({ status: 'SENT', attempts: 2 });
          const t = await targetsOf(id);
          expect(t[d0()]).toMatchObject({ status: 'SUCCESS', attempts: 1 }); // 再送していない
          expect(t[d1()]).toMatchObject({ status: 'SUCCESS', attempts: 2 });
        }
      });

      it('MD6. both permanent errors → FAILED at once, no retry', async () => {
        await resetQueue();
        const id = await due();
        const sender = new Sender({ [id]: perm });
        expect(await run(sender)).toMatchObject({ failed: 1 });
        expect(await rowOf(id)).toMatchObject({ status: 'FAILED', status_reason: 'PERMANENT_ERROR', attempts: 1 });
        expect(Object.values(await targetsOf(id)).map((t) => t.status)).toEqual(['FAILED', 'FAILED']);
        await dueNow(id);
        expect(await run(new Sender())).toMatchObject({ claimed: 0 });
      });

      it('MD7. retry limit: the failing device is retried 5 times, then FAILED MAX_ATTEMPTS; the notification ends PARTIAL_FAILURE', async () => {
        await resetQueue();
        const id = await due();
        const sender = new Sender({}, { [d1()]: [e503, e503, e503, e503, e503] });
        for (let round = 1; round <= 5; round += 1) {
          await run(sender);
          if (round < 5) {
            expect(await rowOf(id)).toMatchObject({ status: 'PENDING', attempts: round });
            await dueNow(id);
          }
        }
        expect(await rowOf(id)).toMatchObject({
          status: 'PARTIAL_FAILURE',
          status_reason: 'MAX_ATTEMPTS',
          attempts: 5,
        });
        const t = await targetsOf(id);
        expect(t[d0()]).toMatchObject({ status: 'SUCCESS', attempts: 1 });
        expect(t[d1()]).toMatchObject({ status: 'FAILED', status_reason: 'MAX_ATTEMPTS', attempts: 5 });
        expect(sentTo(sender, id).filter((d) => d === d0())).toHaveLength(1);
        expect(sentTo(sender, id).filter((d) => d === d1())).toHaveLength(5);
      });

      it('MD8. a device removed during the retry is CANCELLED (not sent, not a failure) → SENT', async () => {
        await resetQueue();
        const id = await due();
        await run(new Sender({}, { [d1()]: [e503] }));
        await ctx.serviceClient
          .from('push_devices')
          .update({ is_active: false, disabled_reason: 'USER_UNREGISTERED', disabled_at: new Date().toISOString() })
          .eq('id', d1());
        await dueNow(id);
        const retry = new Sender();
        expect(await run(retry)).toMatchObject({ sent: 1, cancelled_devices: 1 });
        expect(sentTo(retry, id)).toEqual([]);
        expect(await rowOf(id)).toMatchObject({ status: 'SENT' });
        expect((await targetsOf(id))[d1()]).toMatchObject({ status: 'CANCELLED', status_reason: 'DEVICE_REMOVED' });
        await ctx.serviceClient
          .from('push_devices')
          .update({ is_active: true, disabled_reason: null, disabled_at: null })
          .eq('id', d1());
      });

      it('MD9. a device added during the retry is not a target of that notification', async () => {
        await resetQueue();
        const id = await due();
        await run(new Sender({}, { [d1()]: [e503] }));
        const { data: added, error } = await ctx.serviceClient
          .from('push_devices')
          .insert({ user_id: c.id, device_token: 'e3'.repeat(32), environment: 'SANDBOX' })
          .select('id')
          .single();
        if (error) throw error;
        await dueNow(id);
        const retry = new Sender();
        expect(await run(retry)).toMatchObject({ sent: 1 });
        expect(sentTo(retry, id)).toEqual([d1()]); // 新しい端末には送らない
        expect(Object.keys(await targetsOf(id)).sort()).toEqual([d0(), d1()].sort());
        await ctx.serviceClient.from('push_devices').delete().eq('id', added.id);
      });

      it('MD10. two workers at the same time: every notification goes to each device exactly once', async () => {
        await resetQueue();
        const ids = [await due(), await due(), await due()];
        const sender = new Sender();
        const [w1, w2] = await Promise.all([run(sender), run(sender)]);
        expect(w1.claimed + w2.claimed).toBe(3);
        expect(w1.sent + w2.sent).toBe(3);
        const pairs = sender.sent.map((x) => `${x.message.notificationId}:${x.device.id}`);
        expect(pairs).toHaveLength(6);
        expect(new Set(pairs).size).toBe(6);
        for (const id of ids) expect(await rowOf(id)).toMatchObject({ status: 'SENT' });
      });

      it('APNs not configured: no new rows are enqueued, so the queue does not grow', async () => {
        await resetQueue();
        const count = async () =>
          (await ctx.serviceClient.from('push_notifications').select('id', { count: 'exact', head: true })).count;
        const before = await count();
        const result = await enqueuePushNotifications({ store: dbStore(), apnsConfigured: false });
        expect(result).toMatchObject({ skipped_not_configured: true, inserted: 0 });
        expect(await count()).toBe(before);
      });

      it('APNs down after a partial send: the expired retry ends PARTIAL_FAILURE (not sent later), and nothing is deleted', async () => {
        await resetQueue();
        const partial = await due();
        await run(new Sender({}, { [d1()]: [e503] }));
        const valid = await due();
        // 期限切れにする(APNs が使えない間に過ぎた)
        await ctx.serviceClient
          .from('push_notifications')
          .update({ expires_at: new Date(Date.now() - 1_000).toISOString(), next_attempt_at: new Date().toISOString() })
          .eq('id', partial);
        const down = await sendDuePushNotifications({ store: dbStore(), sender: null });
        expect(down).toMatchObject({ expired: 1, claimed: 0, errors: ['APNS_NOT_CONFIGURED'] });
        expect(await rowOf(partial)).toMatchObject({
          status: 'PARTIAL_FAILURE',
          status_reason: 'EXPIRED_BEFORE_RETRY',
        });
        expect((await targetsOf(partial))[d1()]).toMatchObject({ status: 'FAILED', status_reason: 'EXPIRED' });
        expect(await rowOf(valid)).toMatchObject({ status: 'PENDING' }); // 期限内の行は消さず・送らず残る
        // 設定が直った: 期限内の行だけ送り、期限切れの行は送らない
        const restored = new Sender();
        expect(await run(restored)).toMatchObject({ claimed: 1, sent: 1 });
        expect(sentTo(restored, partial)).toEqual([]);
        expect(sentTo(restored, valid).sort()).toEqual([d0(), d1()].sort());
        const { count } = await ctx.serviceClient
          .from('push_notifications')
          .select('id', { count: 'exact', head: true })
          .in('id', [partial, valid]);
        expect(count).toBe(2); // どちらの行も消していない
      });
    });
  });
});
