/**
 * プッシュ通知の2つの処理(HQ指示 2026-11-10「プッシュ通知バックエンド実装」「障害復旧・信頼性強化」):
 *   enqueuePushNotifications — 通知を送る予定を作る(push_notifications に PENDING の行。重複は DB の unique で入らない)
 *   sendDuePushNotifications — 送る時刻になった行を取り出し(claim)、送る直前に確かめてから端末ごとに送り、結果を記録する
 * 判定は domain/pushNotifications.ts。DB は PushStore(repositories/pushRepository.ts)、送信は PushSender(push/apnsSender.ts)。
 *
 * 保証の範囲(push-notifications-spec.md §5.2): **At Least Once**(期限まで)。APNs に送った後、記録の前に止まると、その端末の
 * 結果は分からない(UNKNOWN)ので、取り直したときにもう一度送る — 二重に届くことがある(apns-collapse-id = 通知の id なので、
 * 通知センターでは1件にまとまる)。結果が記録できた端末(SUCCESS・送っても無駄な失敗)には二度送らない。
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
  type RecordedOutcome,
} from '../domain/pushNotifications.js';
import type { NotificationCandidate } from '../domain/notifications.js';
import type { PushDevice, PushSender } from './apnsSender.js';

const MINUTE_MS = 60_000;

/** APNs の鍵・設定の問題(CONFIG_ERROR)で止めた行を、次に試すまでの待ち。試行の回数には数えない。 */
export const CONFIG_ERROR_RETRY_MINUTES = 5;
/** 持ち時間切れで取り直す回数の上限(超えたら FAILED STUCK_IN_SENDING)。 */
export const MAX_RECOVERIES = 3;

export interface PushDeviceRow extends PushDevice {
  user_id: string;
}

/** 取り出した行(claim_token が付く)。recovery_count > 0 = 前の送信が途中で止まった行。 */
export interface ClaimedPushNotification extends PushNotificationRow {
  claim_token: string;
  recovery_count: number;
}

export interface AttemptStart {
  notification_id: string;
  device_id: string;
  attempt: number;
  claim_token: string;
}

export interface AttemptResult {
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
  /** 期限を過ぎた PENDING を SKIPPED EXPIRED にする。戻り値 = 件数。 */
  expireOverdue(): Promise<number>;
  /**
   * 送る時刻になった行と、持ち時間の切れた SENDING を取り出して SENDING にする(新しい claim_token)。同時に動いた別の
   * ジョブとは重ならない。取り直しの回数が上限を超えた行は FAILED STUCK_IN_SENDING にして返さない。
   */
  claimDue(limit: number, leaseSeconds: number, maxRecoveries: number): Promise<ClaimedPushNotification[]>;
  /** 持ち時間を延ばす。false = 取り出しを失った(別のジョブが取り直した・もう終わった)。 */
  renewLease(notificationId: string, claimToken: string, leaseSeconds: number): Promise<boolean>;
  listActiveDevices(userId: string): Promise<PushDeviceRow[]>;
  /** この通知の、端末ごとの最後の記録(取り直しのとき、どの端末に送り直すかを決める)。 */
  listLatestOutcomes(notificationId: string): Promise<Map<string, RecordedOutcome>>;
  /** 送る前に IN_FLIGHT の記録を作る。戻り値 = 記録の id。 */
  startAttempt(attempt: AttemptStart): Promise<string>;
  /** APNs の応答で記録を終える(IN_FLIGHT の記録だけ)。 */
  completeAttempt(attemptId: string, result: AttemptResult): Promise<void>;
  deactivateDevice(deviceId: string, reason: 'APNS_INVALID_TOKEN'): Promise<void>;
  /** 行の状態を書く。claim_token が一致し SENDING のときだけ(false = 取り出しを失っていた)。 */
  finish(notificationId: string, claimToken: string, update: PushRowUpdate): Promise<boolean>;
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
  expired: number;
  claimed: number;
  /** claimed のうち、前の送信が途中で止まって取り直した行 */
  recovered: number;
  sent: number;
  retried: number;
  failed: number;
  cancelled: number;
  skipped: number;
  invalidated_devices: number;
  /** 結果の分からない(UNKNOWN)端末に送り直した回数(At Least Once の二重の可能性) */
  resent_unknown: number;
  /** 送信の途中で取り出しを失った(持ち時間切れで別のジョブが取った)行 */
  lost_claims: number;
  /** CONFIG_ERROR で止め、差し戻した行 */
  released_config_error: number;
  config_error: boolean;
  errors: string[];
}

/** 送ってもむだな端末(結果が記録済みで、送り直さない)。UNKNOWN・RETRYABLE_ERROR・IN_FLIGHT は送り直す。 */
const TERMINAL_FOR_DEVICE: readonly RecordedOutcome[] = ['SUCCESS', 'PERMANENT_ERROR', 'INVALID_TOKEN'];

/**
 * 送る時刻になった行を送る。
 * - APNs が未設定(sender = null): 期限切れの整理だけして、取り出さない(キューは壊れない。期限で SKIPPED になる)。
 * - 1件ごとに: 今の候補と設定で確かめる(decidePushSend)→ 端末ごとに [持ち時間の延長 → IN_FLIGHT の記録 → 送信 → 記録を終える]
 *   → 無効な端末を外す → 行の状態を決める(claim_token が一致するときだけ書く)。
 * - 取り直した行: 記録が SUCCESS / 送ってもむだな失敗の端末には送らない。UNKNOWN の端末には送り直す(At Least Once)。
 * - CONFIG_ERROR(APNs の鍵・設定): その行と、まだ送っていない取り出し済みの行を PENDING に差し戻し(試行の回数は増やさない)、
 *   この回の送信をやめる。
 */
export async function sendDuePushNotifications(deps: {
  store: PushStore;
  sender: PushSender | null;
  now?: () => Date;
  limit?: number;
  leaseSeconds?: number;
}): Promise<SendResultSummary> {
  const now = () => deps.now?.() ?? new Date();
  const leaseSeconds = deps.leaseSeconds ?? 120;
  const summary: SendResultSummary = {
    expired: 0,
    claimed: 0,
    recovered: 0,
    sent: 0,
    retried: 0,
    failed: 0,
    cancelled: 0,
    skipped: 0,
    invalidated_devices: 0,
    resent_unknown: 0,
    lost_claims: 0,
    released_config_error: 0,
    config_error: false,
    errors: [],
  };
  summary.expired = await deps.store.expireOverdue();
  if (!deps.sender) {
    summary.errors.push('APNS_NOT_CONFIGURED');
    return summary;
  }
  const rows = await deps.store.claimDue(deps.limit ?? 200, leaseSeconds, MAX_RECOVERIES);
  summary.claimed = rows.length;
  summary.recovered = rows.filter((r) => r.recovery_count > 0).length;
  if (rows.length === 0) return summary;

  const candidates = await deps.store.listCandidatesByIds({
    indicators: rows.filter((r) => r.target_kind === 'INDICATOR').map((r) => r.target_id),
    speeches: rows.filter((r) => r.target_kind === 'SPEECH').map((r) => r.target_id),
  });
  const byKey = new Map(candidates.map((c) => [`${c.kind}:${c.id}`, c]));
  const contexts = new Map<string, PushUserContext | null>();

  const release = async (row: ClaimedPushNotification, error: string) => {
    await deps.store.finish(row.id, row.claim_token, {
      status: 'PENDING',
      status_reason: 'CONFIG_ERROR',
      next_attempt_at: new Date(now().getTime() + CONFIG_ERROR_RETRY_MINUTES * MINUTE_MS).toISOString(),
      last_error: error,
    });
    summary.released_config_error += 1;
  };

  for (const row of rows) {
    if (summary.config_error) {
      await release(row, 'not sent: APNs configuration error in this run');
      continue;
    }
    try {
      if (!contexts.has(row.user_id)) contexts.set(row.user_id, await deps.store.loadUserContext(row.user_id));
      const decision = decidePushSend(
        row,
        byKey.get(`${row.target_kind}:${row.target_id}`) ?? null,
        contexts.get(row.user_id)!,
        now(),
      );
      if (decision.action !== 'SEND') {
        const ok = await deps.store.finish(row.id, row.claim_token, {
          status: decision.action === 'CANCEL' ? 'CANCELLED' : 'SKIPPED',
          status_reason: decision.reason,
        });
        if (!ok) summary.lost_claims += 1;
        else if (decision.action === 'CANCEL') summary.cancelled += 1;
        else summary.skipped += 1;
        continue;
      }

      const previous =
        row.recovery_count > 0 || row.attempts > 0 ? await deps.store.listLatestOutcomes(row.id) : new Map();
      const alreadyDelivered = [...previous.values()].includes('SUCCESS');
      const devices = (await deps.store.listActiveDevices(row.user_id)).filter(
        (d) => !TERMINAL_FOR_DEVICE.includes(previous.get(d.id) as RecordedOutcome),
      );
      const attempt = row.attempts + 1;
      // 前の試行で結果の決まった失敗(送り直さない端末)も、今回の判定に入れる
      const carried = [...previous.values()].filter(
        (o): o is DeliveryOutcome => o === 'PERMANENT_ERROR' || o === 'INVALID_TOKEN',
      );
      const outcomes: DeliveryOutcome[] = alreadyDelivered ? ['SUCCESS'] : [...carried];
      let sentThisRun = 0;
      let lastError: string | null = null;
      let lost = false;
      let configError: string | null = null;

      if (!alreadyDelivered) {
        for (const device of devices) {
          if (!(await deps.store.renewLease(row.id, row.claim_token, leaseSeconds))) {
            lost = true; // 別のジョブが取り直した — この行には何も書かない
            break;
          }
          if (previous.get(device.id) === 'UNKNOWN' || previous.get(device.id) === 'IN_FLIGHT')
            summary.resent_unknown += 1;
          const attemptId = await deps.store.startAttempt({
            notification_id: row.id,
            device_id: device.id,
            attempt,
            claim_token: row.claim_token,
          });
          const sent = await deps.sender.send(device, {
            notificationId: row.id,
            title: row.title,
            body: row.body,
            payload: row.payload,
            expiresAt: row.expires_at,
          });
          await deps.store.completeAttempt(attemptId, {
            outcome: sent.outcome,
            http_status: sent.httpStatus,
            apns_id: sent.apnsId,
            reason: sent.reason,
          });
          if (sent.outcome === 'CONFIG_ERROR') {
            configError = `${sent.httpStatus ?? 'ERR'} ${sent.reason ?? ''}`.trim();
            break;
          }
          outcomes.push(sent.outcome);
          sentThisRun += 1;
          if (sent.outcome !== 'SUCCESS') lastError = `${sent.httpStatus ?? 'ERR'} ${sent.reason ?? ''}`.trim();
          if (sent.outcome === 'INVALID_TOKEN') {
            await deps.store.deactivateDevice(device.id, 'APNS_INVALID_TOKEN');
            summary.invalidated_devices += 1;
          }
        }
      }

      if (lost) {
        summary.lost_claims += 1;
        continue;
      }
      if (configError) {
        summary.config_error = true;
        summary.errors.push(`APNS_CONFIG_ERROR: ${configError}`);
        await release(row, configError);
        continue;
      }
      const result = resolveDeliveryResult(outcomes, attempt, now(), row.expires_at);
      const ok = await deps.store.finish(row.id, row.claim_token, {
        status: result.status,
        status_reason: result.status_reason,
        attempts: sentThisRun > 0 ? attempt : row.attempts,
        ...(result.next_attempt_at ? { next_attempt_at: result.next_attempt_at } : {}),
        last_error: lastError,
        sent_at: result.status === 'SENT' ? now().toISOString() : null,
      });
      if (!ok) summary.lost_claims += 1;
      else if (result.status === 'SENT') summary.sent += 1;
      else if (result.status === 'PENDING') summary.retried += 1;
      else if (result.status === 'FAILED') summary.failed += 1;
      else summary.skipped += 1;
    } catch (error) {
      // 行は SENDING のまま。持ち時間(lease)が過ぎたら次の実行が取り直す(IN_FLIGHT の記録は UNKNOWN になる)
      summary.errors.push(`${row.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return summary;
}
