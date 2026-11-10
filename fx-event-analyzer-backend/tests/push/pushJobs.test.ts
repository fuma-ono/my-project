/**
 * プッシュ通知の予約と送信(DB はメモリ、APNs は偽物)。HQ指示 2026-11-10 のテスト項目:
 * 抽出・重複防止・延期/中止の除外・送信失敗と再試行・設定の反映・無効な端末。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type {
  IndicatorNotificationCandidate,
  NotificationCandidate,
  NotificationPreferences,
} from '../../src/domain/notifications.js';
import type { PushNotificationRow, PushPlanItem, PushUserContext } from '../../src/domain/pushNotifications.js';
import type { PushDevice, PushMessage, PushSender, SendResult } from '../../src/push/apnsSender.js';
import {
  enqueuePushNotifications,
  sendDuePushNotifications,
  type DeliveryAttempt,
  type PushDeviceRow,
  type PushRowUpdate,
  type PushStore,
} from '../../src/push/pushJobs.js';

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

class MemoryPushStore implements PushStore {
  users = new Map<string, PushUserContext>();
  candidates: NotificationCandidate[] = [];
  devices: (PushDeviceRow & { is_active: boolean; disabled_reason?: string })[] = [];
  rows: (PushNotificationRow & {
    status_reason?: string | null;
    last_error?: string | null;
    sent_at?: string | null;
  })[] = [];
  attempts: DeliveryAttempt[] = [];
  private seq = 0;

  listPushUserIds() {
    return Promise.resolve(
      [...this.users.keys()].filter(
        (id) => this.users.get(id)!.prefs.push && this.devices.some((d) => d.user_id === id && d.is_active),
      ),
    );
  }
  loadUserContext(userId: string) {
    return Promise.resolve(this.users.get(userId) ?? null);
  }
  listCandidates(fromIso: string, toIso: string, _kinds: unknown, includePast: boolean) {
    return Promise.resolve(
      this.candidates.filter(
        (c) => (includePast || c.status === 'SCHEDULED') && c.scheduled_at >= fromIso && c.scheduled_at <= toIso,
      ),
    );
  }
  listCandidatesByIds(ids: { indicators: readonly string[]; speeches: readonly string[] }) {
    return Promise.resolve(this.candidates.filter((c) => [...ids.indicators, ...ids.speeches].includes(c.id)));
  }
  enqueue(items: readonly PushPlanItem[]) {
    let inserted = 0;
    for (const i of items) {
      const dup = this.rows.some(
        (r) =>
          r.user_id === i.user_id &&
          r.push_type === i.push_type &&
          r.target_kind === i.target_kind &&
          r.target_id === i.target_id &&
          r.event_scheduled_at === i.event_scheduled_at,
      );
      if (dup) continue;
      this.rows.push({
        ...i,
        id: `n-${++this.seq}`,
        status: 'PENDING',
        attempts: 0,
        next_attempt_at: i.scheduled_send_at,
      });
      inserted += 1;
    }
    return Promise.resolve(inserted);
  }
  claimNow = new Date();
  claimDue(limit: number) {
    const due = this.rows
      .filter((r) => r.status === 'PENDING' && Date.parse(r.next_attempt_at) <= this.claimNow.getTime())
      .slice(0, limit);
    for (const r of due) r.status = 'SENDING';
    return Promise.resolve(due.map((r) => ({ ...r })));
  }
  listActiveDevices(userId: string) {
    return Promise.resolve(this.devices.filter((d) => d.user_id === userId && d.is_active));
  }
  recordAttempt(a: DeliveryAttempt) {
    this.attempts.push(a);
    return Promise.resolve();
  }
  deactivateDevice(id: string, reason: string) {
    const d = this.devices.find((x) => x.id === id)!;
    d.is_active = false;
    d.disabled_reason = reason;
    return Promise.resolve();
  }
  finish(id: string, update: PushRowUpdate) {
    const r = this.rows.find((x) => x.id === id)!;
    if (r.status !== 'SENDING') return Promise.resolve();
    Object.assign(r, update);
    return Promise.resolve();
  }
}

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
    store.claimNow = now;
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

  it('a pre-release push picked up after the release (+2 min) is skipped as expired', async () => {
    await enqueue();
    const sender = new FakeSender();
    expect(await send(sender, new Date('2026-11-12T13:33:00Z'))).toMatchObject({ skipped: 1 });
    expect(store.rows[0]).toMatchObject({ status: 'SKIPPED', status_reason: 'EXPIRED' });
    expect(sender.sent).toEqual([]);
  });
});
