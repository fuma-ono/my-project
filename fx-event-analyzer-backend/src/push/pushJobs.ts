/**
 * プッシュ通知の2つの処理(HQ指示 2026-11-10「プッシュ通知バックエンド実装」):
 *   enqueuePushNotifications — 通知を送る予定を作る(push_notifications に PENDING の行。重複は DB の unique で入らない)
 *   sendDuePushNotifications — 送る時刻になった行を取り出し(claim)、送る直前に確かめてから端末ごとに送り、結果を記録する
 * 判定は domain/pushNotifications.ts。DB は PushStore(repositories/pushRepository.ts)、送信は PushSender(push/apnsSender.ts)。
 */
import {
  decidePushSend,
  planPreReleasePushes,
  planReleasedPushes,
  PRE_RELEASE_HORIZON_MINUTES,
  RELEASED_MAX_AGE_MINUTES,
  resolveDeliveryResult,
  type DeliveryOutcome,
  type PushNotificationRow,
  type PushPlanItem,
  type PushUserContext,
} from '../domain/pushNotifications.js';
import type { NotificationCandidate } from '../domain/notifications.js';
import type { PushDevice, PushSender } from './apnsSender.js';

const MINUTE_MS = 60_000;

export interface PushDeviceRow extends PushDevice {
  user_id: string;
}

export interface DeliveryAttempt {
  notification_id: string;
  device_id: string | null;
  attempt: number;
  outcome: DeliveryOutcome;
  http_status: number | null;
  apns_id: string | null;
  reason: string | null;
}

export interface PushRowUpdate {
  status: 'PENDING' | 'SENT' | 'FAILED' | 'CANCELLED' | 'SKIPPED';
  status_reason: string | null;
  attempts?: number;
  next_attempt_at?: string;
  last_error?: string | null;
  sent_at?: string | null;
}

export interface PushStore {
  /** 通知を送れる利用者(notify_push = true で、有効な端末が1台以上)。 */
  listPushUserIds(): Promise<string[]>;
  /** 利用者の今の通知設定(プランの上限を反映済み)とお気に入り通貨。利用者が無ければ null。 */
  loadUserContext(userId: string): Promise<PushUserContext | null>;
  listCandidates(
    fromIso: string,
    toIso: string,
    kinds: { indicators: boolean; speeches: boolean },
    includePast: boolean,
  ): Promise<NotificationCandidate[]>;
  listCandidatesByIds(ids: {
    indicators: readonly string[];
    speeches: readonly string[];
  }): Promise<NotificationCandidate[]>;
  /** 予定を入れる。同じ(利用者・種類・対象・予定時刻)の行が既にあれば入れない。戻り値 = 入れた行の数。 */
  enqueue(items: readonly PushPlanItem[]): Promise<number>;
  /** 送る時刻になった行を SENDING にして返す(同時に動いた別のジョブとは重ならない)。 */
  claimDue(limit: number, leaseSeconds: number): Promise<PushNotificationRow[]>;
  listActiveDevices(userId: string): Promise<PushDeviceRow[]>;
  recordAttempt(attempt: DeliveryAttempt): Promise<void>;
  deactivateDevice(deviceId: string, reason: 'APNS_INVALID_TOKEN'): Promise<void>;
  finish(notificationId: string, update: PushRowUpdate): Promise<void>;
}

export interface EnqueueResult {
  users: number;
  planned: number;
  inserted: number;
  errors: string[];
}

/** 全員分の予定を作る。1人の失敗で全体を止めない(errors に入れて次の人へ)。 */
export async function enqueuePushNotifications(deps: { store: PushStore; now?: () => Date }): Promise<EnqueueResult> {
  const now = deps.now?.() ?? new Date();
  const result: EnqueueResult = { users: 0, planned: 0, inserted: 0, errors: [] };
  const userIds = await deps.store.listPushUserIds();
  if (userIds.length === 0) return result;

  // 候補は全員で同じなので1回だけ取る(利用者ごとの判定は domain で)
  const upcomingTo = new Date(now.getTime() + PRE_RELEASE_HORIZON_MINUTES * MINUTE_MS + 60 * MINUTE_MS);
  const [upcoming, recent] = await Promise.all([
    deps.store.listCandidates(now.toISOString(), upcomingTo.toISOString(), { indicators: true, speeches: true }, false),
    deps.store.listCandidates(
      new Date(now.getTime() - RELEASED_MAX_AGE_MINUTES * MINUTE_MS).toISOString(),
      now.toISOString(),
      { indicators: true, speeches: true },
      true,
    ),
  ]);

  for (const userId of userIds) {
    try {
      const ctx = await deps.store.loadUserContext(userId);
      if (!ctx || !ctx.prefs.push) continue;
      result.users += 1;
      const items = [...planPreReleasePushes(ctx, upcoming, now), ...planReleasedPushes(ctx, recent, now)];
      result.planned += items.length;
      if (items.length > 0) result.inserted += await deps.store.enqueue(items);
    } catch (error) {
      result.errors.push(`${userId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return result;
}

export interface SendResultSummary {
  claimed: number;
  sent: number;
  retried: number;
  failed: number;
  cancelled: number;
  skipped: number;
  invalidated_devices: number;
  errors: string[];
}

/**
 * 送る時刻になった行を送る。sender が null(APNs が未設定)なら取り出さない(何も変えない)。
 * 1件ごとに: 今の候補と設定で確かめる(decidePushSend)→ 端末ごとに送る → 試行を記録 → 無効な端末を外す → 行の状態を決める。
 */
export async function sendDuePushNotifications(deps: {
  store: PushStore;
  sender: PushSender | null;
  now?: () => Date;
  limit?: number;
  leaseSeconds?: number;
}): Promise<SendResultSummary> {
  const summary: SendResultSummary = {
    claimed: 0,
    sent: 0,
    retried: 0,
    failed: 0,
    cancelled: 0,
    skipped: 0,
    invalidated_devices: 0,
    errors: [],
  };
  if (!deps.sender) {
    summary.errors.push('APNS_NOT_CONFIGURED');
    return summary;
  }
  const rows = await deps.store.claimDue(deps.limit ?? 200, deps.leaseSeconds ?? 120);
  summary.claimed = rows.length;
  if (rows.length === 0) return summary;

  const candidates = await deps.store.listCandidatesByIds({
    indicators: rows.filter((r) => r.target_kind === 'INDICATOR').map((r) => r.target_id),
    speeches: rows.filter((r) => r.target_kind === 'SPEECH').map((r) => r.target_id),
  });
  const byKey = new Map(candidates.map((c) => [`${c.kind}:${c.id}`, c]));
  const contexts = new Map<string, PushUserContext | null>();

  for (const row of rows) {
    try {
      const now = deps.now?.() ?? new Date();
      if (!contexts.has(row.user_id)) contexts.set(row.user_id, await deps.store.loadUserContext(row.user_id));
      const decision = decidePushSend(
        row,
        byKey.get(`${row.target_kind}:${row.target_id}`) ?? null,
        contexts.get(row.user_id)!,
        now,
      );
      if (decision.action !== 'SEND') {
        await deps.store.finish(row.id, {
          status: decision.action === 'CANCEL' ? 'CANCELLED' : 'SKIPPED',
          status_reason: decision.reason,
        });
        if (decision.action === 'CANCEL') summary.cancelled += 1;
        else summary.skipped += 1;
        continue;
      }

      const devices = await deps.store.listActiveDevices(row.user_id);
      const attempt = row.attempts + 1;
      const outcomes: DeliveryOutcome[] = [];
      let lastError: string | null = null;
      for (const device of devices) {
        const sent = await deps.sender.send(device, {
          notificationId: row.id,
          title: row.title,
          body: row.body,
          payload: row.payload,
          expiresAt: row.expires_at,
        });
        outcomes.push(sent.outcome);
        if (sent.outcome !== 'SUCCESS') lastError = `${sent.httpStatus ?? 'ERR'} ${sent.reason ?? ''}`.trim();
        await deps.store.recordAttempt({
          notification_id: row.id,
          device_id: device.id,
          attempt,
          outcome: sent.outcome,
          http_status: sent.httpStatus,
          apns_id: sent.apnsId,
          reason: sent.reason,
        });
        if (sent.outcome === 'INVALID_TOKEN') {
          await deps.store.deactivateDevice(device.id, 'APNS_INVALID_TOKEN');
          summary.invalidated_devices += 1;
        }
      }
      const result = resolveDeliveryResult(outcomes, attempt, deps.now?.() ?? new Date(), row.expires_at);
      await deps.store.finish(row.id, {
        status: result.status,
        status_reason: result.status_reason,
        attempts: devices.length > 0 ? attempt : row.attempts,
        ...(result.next_attempt_at ? { next_attempt_at: result.next_attempt_at } : {}),
        last_error: lastError,
        sent_at: result.status === 'SENT' ? (deps.now?.() ?? new Date()).toISOString() : null,
      });
      if (result.status === 'SENT') summary.sent += 1;
      else if (result.status === 'PENDING') summary.retried += 1;
      else if (result.status === 'FAILED') summary.failed += 1;
      else summary.skipped += 1;
    } catch (error) {
      // 行は SENDING のまま。持ち時間(lease)が過ぎたら次の実行がもう一度取り出す
      summary.errors.push(`${row.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return summary;
}
