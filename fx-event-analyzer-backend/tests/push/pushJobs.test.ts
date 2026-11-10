/**
 * プッシュ通知の予約と送信(DB はメモリ、APNs は偽物)。HQ指示 2026-11-10 のテスト項目:
 * 抽出・重複防止・延期/中止の除外・送信失敗と再試行・設定の反映・無効な端末。
 * 障害復旧(HQ指示 2026-11-10「障害復旧・信頼性強化」): 途中で止まった送信の取り直し・結果の分からない端末・
 * APNs 成功後の DB の失敗・CONFIG_ERROR・取り出しを失った worker。DB の関数そのものは tests/integration/push-notifications.test.ts。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { IndicatorNotificationCandidate, NotificationPreferences } from '../../src/domain/notifications.js';
import type { PushDevice, PushMessage, PushSender, SendResult } from '../../src/push/apnsSender.js';
import { enqueuePushNotifications, sendDuePushNotifications } from '../../src/push/pushJobs.js';
import { MemoryPushStore } from '../helpers/memoryPushStore.js';

const prefs: NotificationPreferences = {
  push: true,
  indicators: true,
  speeches: true,
  fxPairSymbols: null,
  importances: ['HIGH', 'MEDIUM'],
  leadMinutes: 5,
  quietHours: { enabled: false, start: '23:00', end: '07:00' },
  timeZone: 'Asia/Tokyo',
};

const cpi = (over: Partial<IndicatorNotificationCandidate> = {}): IndicatorNotificationCandidate => ({
  kind: 'INDICATOR',
  id: 'ev-cpi',
  title: '米国CPI',
  display_name: '消費者物価指数（CPI）',
  importance: 'HIGH',
  status: 'SCHEDULED',
  scheduled_at: '2026-11-12T13:30:00.000Z',
  release_datetime_precision: 'EXACT',
  country_code: 'US',
  currency_code: 'USD',
  related_fx_pairs: ['USDJPY'],
  ...over,
});

class FakeSender implements PushSender {
  sent: { device: PushDevice; message: PushMessage }[] = [];
  constructor(private readonly results: Record<string, SendResult[]> = {}) {}
  send(device: PushDevice, message: PushMessage): Promise<SendResult> {
    this.sent.push({ device, message });
    const queue = this.results[device.id];
    return Promise.resolve(queue?.shift() ?? { outcome: 'SUCCESS', httpStatus: 200, apnsId: 'a', reason: null });
  }
}

const ENQUEUE_AT = new Date('2026-11-12T12:00:00Z');
const SEND_AT = new Date('2026-11-12T13:25:05Z');

describe('push jobs', () => {
  let store: MemoryPushStore;
  beforeEach(() => {
    store = new MemoryPushStore();
    store.users.set('u1', { userId: 'u1', prefs, favoriteCurrencies: [], language: 'ja' });
    store.devices.push({
      id: 'd1',
      user_id: 'u1',
      device_token: 'aa'.repeat(32),
      environment: 'SANDBOX',
      is_active: true,
    });
    store.candidates = [cpi()];
  });
  const enqueue = (now = ENQUEUE_AT) => enqueuePushNotifications({ store, now: () => now });
  const send = (sender: PushSender | null, now = SEND_AT) => {
    store.clock = now;
    return sendDuePushNotifications({ store, sender, now: () => now });
  };

  it('enqueues once per user/type/event/time — re-running does not duplicate', async () => {
    expect(await enqueue()).toMatchObject({ users: 1, planned: 1, inserted: 1 });
    expect(await enqueue(new Date('2026-11-12T12:05:00Z'))).toMatchObject({ planned: 1, inserted: 0 });
    expect(store.rows).toHaveLength(1);
  });

  it('only users with push ON and an active device are planned; another user sees nothing of u1', async () => {
    store.users.set('u2', { userId: 'u2', prefs: { ...prefs, push: false }, favoriteCurrencies: [], language: 'ja' });
    store.devices.push({
      id: 'd2',
      user_id: 'u2',
      device_token: 'bb'.repeat(32),
      environment: 'SANDBOX',
      is_active: true,
    });
    store.users.set('u3', { userId: 'u3', prefs, favoriteCurrencies: [], language: 'ja' }); // 端末なし
    await enqueue();
    expect(store.rows.map((r) => r.user_id)).toEqual(['u1']);
  });

  it('sends at the due time to every active device, logs each attempt and marks SENT; never sends twice', async () => {
    store.devices.push({
      id: 'd1b',
      user_id: 'u1',
      device_token: 'cc'.repeat(32),
      environment: 'PRODUCTION',
      is_active: true,
    });
    await enqueue();
    const sender = new FakeSender();
    expect(await send(sender, new Date('2026-11-12T13:20:00Z'))).toMatchObject({ claimed: 0 }); // まだ時刻前
    expect(await send(sender)).toMatchObject({ claimed: 1, sent: 1 });
    expect(sender.sent.map((s) => s.device.id)).toEqual(['d1', 'd1b']);
    expect(sender.sent[0]!.message).toMatchObject({ notificationId: 'n-1', expiresAt: '2026-11-12T13:32:00.000Z' });
    expect(store.attempts.map((a) => [a.device_id, a.attempt, a.outcome])).toEqual([
      ['d1', 1, 'SUCCESS'],
      ['d1b', 1, 'SUCCESS'],
    ]);
    expect(store.rows[0]).toMatchObject({ status: 'SENT', attempts: 1, sent_at: SEND_AT.toISOString() });
    expect(await send(sender, new Date('2026-11-12T13:26:00Z'))).toMatchObject({ claimed: 0 });
    expect(sender.sent).toHaveLength(2);
  });

  it('a postponed event is not notified at the old time, and gets a new notification at the new time', async () => {
    await enqueue();
    store.candidates = [cpi({ scheduled_at: '2026-11-12T15:30:00.000Z' })]; // 2時間の延期
    const sender = new FakeSender();
    expect(await send(sender)).toMatchObject({ cancelled: 1, sent: 0 });
    expect(store.rows[0]).toMatchObject({ status: 'CANCELLED', status_reason: 'RESCHEDULED' });
    expect(await enqueue(new Date('2026-11-12T13:30:00Z'))).toMatchObject({ inserted: 1 });
    expect(store.rows[1]).toMatchObject({ status: 'PENDING', event_scheduled_at: '2026-11-12T15:30:00.000Z' });
    expect(sender.sent).toEqual([]);
  });

  it('a cancelled event and a settings change after enqueue are not sent', async () => {
    store.candidates.push(cpi({ id: 'ev-2', scheduled_at: '2026-11-12T13:30:00.000Z' }));
    await enqueue();
    store.candidates = [cpi({ status: 'CANCELLED' }), cpi({ id: 'ev-2' })];
    store.users.set('u1', {
      userId: 'u1',
      prefs: { ...prefs, importances: ['LOW'] },
      favoriteCurrencies: [],
      language: 'ja',
    });
    const sender = new FakeSender();
    await send(sender);
    expect(store.rows.map((r) => [r.target_id, r.status, r.status_reason]).sort()).toEqual([
      ['ev-2', 'CANCELLED', 'SETTINGS_CHANGED'],
      ['ev-cpi', 'CANCELLED', 'TARGET_CANCELLED'],
    ]);
    expect(sender.sent).toEqual([]);
  });

  it('a retryable failure is retried after the back-off, then sent', async () => {
    await enqueue();
    const sender = new FakeSender({
      d1: [{ outcome: 'RETRYABLE_ERROR', httpStatus: 503, apnsId: null, reason: 'ServiceUnavailable' }],
    });
    expect(await send(sender)).toMatchObject({ retried: 1 });
    expect(store.rows[0]).toMatchObject({
      status: 'PENDING',
      attempts: 1,
      next_attempt_at: '2026-11-12T13:26:05.000Z',
      last_error: '503 ServiceUnavailable',
    });
    expect(await send(sender, new Date('2026-11-12T13:25:30Z'))).toMatchObject({ claimed: 0 }); // 待ちの間
    expect(await send(sender, new Date('2026-11-12T13:26:10Z'))).toMatchObject({ sent: 1 });
    expect(store.rows[0]).toMatchObject({ status: 'SENT', attempts: 2 });
    expect(store.attempts.map((a) => [a.attempt, a.outcome])).toEqual([
      [1, 'RETRYABLE_ERROR'],
      [2, 'SUCCESS'],
    ]);
  });

  it('an invalid token deactivates the device; with no device left the notification fails / is skipped', async () => {
    await enqueue();
    const sender = new FakeSender({
      d1: [{ outcome: 'INVALID_TOKEN', httpStatus: 410, apnsId: null, reason: 'Unregistered' }],
    });
    expect(await send(sender)).toMatchObject({ failed: 1, invalidated_devices: 1 });
    expect(store.devices[0]).toMatchObject({ is_active: false, disabled_reason: 'APNS_INVALID_TOKEN' });
    expect(store.rows[0]).toMatchObject({ status: 'FAILED', status_reason: 'ALL_TOKENS_INVALID' });
    // 端末が無い利用者の行(登録の後に外した)は SKIPPED NO_DEVICE
    store.candidates.push(cpi({ id: 'ev-3' }));
    store.rows.push({ ...store.rows[0]!, id: 'n-x', target_id: 'ev-3', status: 'PENDING', attempts: 0 });
    expect(await send(sender)).toMatchObject({ skipped: 1 });
    expect(store.rows[1]).toMatchObject({ status: 'SKIPPED', status_reason: 'NO_DEVICE' });
  });

  it('without APNs credentials nothing is claimed or sent (rows stay PENDING)', async () => {
    await enqueue();
    const result = await send(null);
    expect(result).toMatchObject({ claimed: 0, errors: ['APNS_NOT_CONFIGURED'] });
    expect(store.rows[0]!.status).toBe('PENDING');
  });

  it('a pre-release push not sent by the release (+2 min) is swept as expired and never sent', async () => {
    await enqueue();
    const sender = new FakeSender();
    expect(await send(sender, new Date('2026-11-12T13:33:00Z'))).toMatchObject({ expired: 1, claimed: 0 });
    expect(store.rows[0]).toMatchObject({ status: 'SKIPPED', status_reason: 'EXPIRED' });
    expect(sender.sent).toEqual([]);
  });
  describe('failure recovery', () => {
    const dev2 = () =>
      store.devices.push({
        id: 'd2',
        user_id: 'u1',
        device_token: 'dd'.repeat(32),
        environment: 'SANDBOX',
        is_active: true,
      });

    it('a worker that stopped after claiming: taken again after the lease, not before; IN_FLIGHT becomes UNKNOWN and is re-sent (at least once)', async () => {
      await enqueue();
      store.clock = SEND_AT;
      const [claimed] = await store.claimDue(10, 120, 3); // worker 1 が取り出して…
      await store.startAttempt({
        notification_id: claimed!.id,
        device_id: 'd1',
        attempt: 1,
        claim_token: claimed!.claim_token,
      });
      // …APNs に送った直後に止まった(記録は IN_FLIGHT のまま、行は SENDING のまま)
      const sender = new FakeSender();
      expect(await send(sender, new Date(SEND_AT.getTime() + 60_000))).toMatchObject({ claimed: 0 }); // 持ち時間の中は取らない
      const result = await send(sender, new Date(SEND_AT.getTime() + 121_000));
      expect(result).toMatchObject({ claimed: 1, recovered: 1, resent_unknown: 1, sent: 1 });
      expect(store.attempts.map((a) => a.outcome)).toEqual(['UNKNOWN', 'SUCCESS']);
      expect(store.rows[0]).toMatchObject({ status: 'SENT', recovery_count: 1 });
      expect(sender.sent).toHaveLength(1);
    });

    it('APNs succeeded but marking SENT failed: the retry does not send again to devices that already succeeded', async () => {
      dev2();
      await enqueue();
      store.failNextFinish = true;
      const sender = new FakeSender();
      const first = await send(sender);
      expect(first.errors).toHaveLength(1); // 行は SENDING のまま
      expect(store.rows[0]!.status).toBe('SENDING');
      expect(store.attempts.map((a) => [a.device_id, a.outcome])).toEqual([
        ['d1', 'SUCCESS'],
        ['d2', 'SUCCESS'],
      ]);
      const second = await send(sender, new Date(SEND_AT.getTime() + 121_000));
      expect(second).toMatchObject({ recovered: 1, sent: 1, resent_unknown: 0 });
      expect(sender.sent).toHaveLength(2); // 送り直していない
      expect(store.rows[0]).toMatchObject({ status: 'SENT' });
    });

    it('APNs succeeded but recording the attempt failed: the device is UNKNOWN and gets it again (the documented duplicate case)', async () => {
      await enqueue();
      store.failNextComplete = true;
      const sender = new FakeSender();
      await send(sender);
      expect(store.attempts.map((a) => a.outcome)).toEqual(['IN_FLIGHT']);
      const second = await send(sender, new Date(SEND_AT.getTime() + 121_000));
      expect(second).toMatchObject({ recovered: 1, resent_unknown: 1, sent: 1 });
      expect(sender.sent).toHaveLength(2); // At Least Once: 2回届くことがある(collapse-id は同じ)
      expect(sender.sent.map((s) => s.message.notificationId)).toEqual(['n-1', 'n-1']);
    });

    it('a row that keeps stopping is failed after 3 recoveries (STUCK_IN_SENDING) instead of blocking the queue', async () => {
      await enqueue();
      let t = SEND_AT.getTime();
      for (let i = 0; i < 4; i += 1) {
        store.clock = new Date(t);
        await store.claimDue(10, 60, 3); // 取り出して止まる、を繰り返す
        t += 61_000;
      }
      store.clock = new Date(t);
      expect(await store.claimDue(10, 60, 3)).toEqual([]);
      expect(store.rows[0]).toMatchObject({ status: 'FAILED', status_reason: 'STUCK_IN_SENDING', recovery_count: 4 });
    });

    it('a slow worker that lost its claim (another worker took the row after the lease) writes nothing', async () => {
      await enqueue();
      store.clock = SEND_AT;
      const [old] = await store.claimDue(10, 60, 3);
      store.clock = new Date(SEND_AT.getTime() + 61_000);
      const [fresh] = await store.claimDue(10, 60, 3); // worker 2 が取り直した
      expect(fresh!.claim_token).not.toBe(old!.claim_token);
      expect(await store.renewLease(old!.id, old!.claim_token, 60)).toBe(false);
      expect(await store.finish(old!.id, old!.claim_token, { status: 'FAILED', status_reason: 'X' })).toBe(false);
      expect(store.rows[0]).toMatchObject({ status: 'SENDING', claim_token: fresh!.claim_token });
    });

    it('a timeout is retried (APNs may or may not have it), and counts toward the attempt limit', async () => {
      await enqueue();
      const sender = new FakeSender({
        d1: [{ outcome: 'RETRYABLE_ERROR', httpStatus: null, apnsId: null, reason: 'TIMEOUT' }],
      });
      expect(await send(sender)).toMatchObject({ retried: 1 });
      expect(store.rows[0]).toMatchObject({ status: 'PENDING', attempts: 1, last_error: 'ERR TIMEOUT' });
    });

    it('permanent errors are not retried, and a later retry skips the device whose failure is final', async () => {
      dev2();
      await enqueue();
      const sender = new FakeSender({
        d1: [{ outcome: 'PERMANENT_ERROR', httpStatus: 400, apnsId: null, reason: 'PayloadTooLarge' }],
        d2: [{ outcome: 'RETRYABLE_ERROR', httpStatus: 500, apnsId: null, reason: 'InternalServerError' }],
      });
      expect(await send(sender)).toMatchObject({ retried: 1 });
      await send(sender, new Date(SEND_AT.getTime() + 61_000));
      expect(sender.sent.map((s) => s.device.id)).toEqual(['d1', 'd2', 'd2']); // d1 には送り直さない
      expect(store.rows[0]).toMatchObject({ status: 'SENT', attempts: 2 });
    });

    it('max attempts: failing 5 times gives FAILED MAX_ATTEMPTS, and the row is not claimed again', async () => {
      await enqueue();
      store.rows[0]!.expires_at = '2026-11-12T14:30:00.000Z';
      const fail = { outcome: 'RETRYABLE_ERROR' as const, httpStatus: 503, apnsId: null, reason: 'ServiceUnavailable' };
      const sender = new FakeSender({ d1: [fail, fail, fail, fail, fail] });
      let t = SEND_AT.getTime();
      for (let i = 0; i < 5; i += 1) {
        await send(sender, new Date(t));
        t += 11 * 60_000;
      }
      expect(store.rows[0]).toMatchObject({ status: 'FAILED', status_reason: 'MAX_ATTEMPTS', attempts: 5 });
      expect(await send(sender, new Date(t))).toMatchObject({ claimed: 0 });
    });

    it('CONFIG_ERROR (APNs key/config): this run stops, claimed rows go back to PENDING without using an attempt', async () => {
      store.candidates.push(cpi({ id: 'ev-2' }));
      await enqueue();
      const sender = new FakeSender({
        d1: [{ outcome: 'CONFIG_ERROR', httpStatus: 403, apnsId: null, reason: 'InvalidProviderToken' }],
      });
      const result = await send(sender);
      expect(result).toMatchObject({ config_error: true, released_config_error: 2, sent: 0 });
      expect(result.errors).toEqual(['APNS_CONFIG_ERROR: 403 InvalidProviderToken']);
      expect(sender.sent).toHaveLength(1); // 2件目は送っていない
      expect(store.rows.map((r) => [r.status, r.status_reason, r.attempts, r.next_attempt_at])).toEqual([
        ['PENDING', 'CONFIG_ERROR', 0, '2026-11-12T13:30:05.000Z'],
        ['PENDING', 'CONFIG_ERROR', 0, '2026-11-12T13:30:05.000Z'],
      ]);
    });

    it('expired PENDING rows are swept even without APNs credentials, and are never claimed', async () => {
      await enqueue();
      const result = await send(null, new Date('2026-11-12T13:40:00Z'));
      expect(result).toMatchObject({ expired: 1, claimed: 0, errors: ['APNS_NOT_CONFIGURED'] });
      expect(store.rows[0]).toMatchObject({ status: 'SKIPPED', status_reason: 'EXPIRED' });
    });
  });
});
