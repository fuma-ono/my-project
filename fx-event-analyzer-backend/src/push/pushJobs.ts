/**
 * プッシュ通知の2つの処理(HQ指示 2026-11-10「プッシュ通知バックエンド実装」「障害復旧・信頼性強化」):
 *   enqueuePushNotifications — 通知を送る予定を作る(push_notifications に PENDING の行。重複は DB の unique で入らない)
 *   sendDuePushNotifications — 送る時刻になった行を取り出し(claim)、送る直前に確かめてから端末ごとに送り、結果を記録する
 * 判定は domain/pushNotifications.ts。DB は PushStore(repositories/pushRepository.ts)、送信は PushSender(push/apnsSender.ts)。
 *
 * 保証の範囲(push-notifications-spec.md §5.2): **At Least Once**(期限まで)。APNs に送った後、記録の前に止まると、その端末の
 * 結果は分からない(UNKNOWN)ので、取り直したときにもう一度送る — 二重に届くことがある(apns-collapse-id = 通知の id なので、
 * 通知センターでは1件にまとまる)。結果が記録できた端末(SUCCESS・送っても無駄な失敗)には二度送らない。
 * 端末ごとの状態(push_notification_targets、HQ指示 2026-11-10「複数端末配信・部分失敗対応」): 対象の端末は最初に送るときの
 * 有効な端末。1台の成功でほかの端末の再試行は止めない。すべての端末が SUCCESS / FAILED / CANCELLED になったら通知を最終の
 * 状態(SENT / PARTIAL_FAILURE / FAILED / SKIPPED)にする(domain の resolveNotificationState)。
 */
import {
  decidePushSend,
  planPreReleasePushes,
  planReleasedPushes,
  PRE_RELEASE_HORIZON_MINUTES,
  RELEASED_MAX_AGE_MINUTES,
  isOpenTarget,
  MAX_DELIVERY_ATTEMPTS,
  resolveNotificationState,
  type DeliveryOutcome,
  type PushNotificationRow,
  type PushPlanItem,
  type PushTarget,
  type PushUserContext,
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
  status: 'PENDING' | 'SENT' | 'PARTIAL_FAILURE' | 'FAILED' | 'CANCELLED' | 'SKIPPED';
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
  /**
   * この通知の端末ごとの状態。まだ無ければ deviceIds(今の有効な端末)で作る(対象の端末はここで決まり、後から増えない)。
   */
  ensureTargets(notificationId: string, deviceIds: readonly string[]): Promise<PushTarget[]>;
  /** まだ送る端末(PENDING・RETRY)を CANCELLED にする(端末が外れた)。 */
  cancelTargets(notificationId: string, deviceIds: readonly string[], reason: 'DEVICE_REMOVED'): Promise<void>;
  /** まだ送る端末を FAILED EXPIRED にする(期限までに再試行できない)。 */
  expireOpenTargets(notificationId: string): Promise<void>;
  /** 送る前に IN_FLIGHT の記録を作る。戻り値 = 記録の id。 */
  startAttempt(attempt: AttemptStart): Promise<string>;
  /** APNs の応答で記録を終え、同じ transaction で端末の状態を進める。戻り値 = 端末の新しい状態。 */
  completeAttempt(attemptId: string, result: AttemptResult, maxAttempts: number): Promise<PushTarget>;
  deactivateDevice(deviceId: string, reason: 'APNS_INVALID_TOKEN'): Promise<void>;
  /** 行の状態を書く。claim_token が一致し SENDING のときだけ(false = 取り出しを失っていた)。 */
  finish(notificationId: string, claimToken: string, update: PushRowUpdate): Promise<boolean>;
}

export interface EnqueueResult {
  users: number;
  planned: number;
  inserted: number;
  /** APNs が未設定で、予定を作らなかった(キューを増やさない) */
  skipped_not_configured: boolean;
  errors: string[];
}

/**
 * 全員分の予定を作る。1人の失敗で全体を止めない(errors に入れて次の人へ)。
 * apnsConfigured = false(APNs が未設定)なら何も作らない: 送れない予定でキューを増やさない(HQ指示 2026-11-10「APNs 未設定時の
 * 滞留対策」)。設定が直った後は、その時点からの予定だけを作る(過ぎた通知は作らない・送らない)。
 */
export async function enqueuePushNotifications(deps: {
  store: PushStore;
  now?: () => Date;
  apnsConfigured?: boolean;
}): Promise<EnqueueResult> {
  const now = deps.now?.() ?? new Date();
  const result: EnqueueResult = { users: 0, planned: 0, inserted: 0, skipped_not_configured: false, errors: [] };
  if (deps.apnsConfigured === false) {
    result.skipped_not_configured = true;
    return result;
  }
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
  /** 届いた端末と、最終的に届かなかった端末がある */
  partial_failure: number;
  retried: number;
  failed: number;
  cancelled: number;
  skipped: number;
  invalidated_devices: number;
  /** 取り直した行で、まだ届いていない端末に送り直した回数(At Least Once の二重の可能性) */
  resent_unknown: number;
  /** 再試行の間に外れた端末(CANCELLED DEVICE_REMOVED) */
  cancelled_devices: number;
  /** 送信の途中で取り出しを失った(持ち時間切れで別のジョブが取った)行 */
  lost_claims: number;
  /** CONFIG_ERROR で止め、差し戻した行 */
  released_config_error: number;
  config_error: boolean;
  errors: string[];
}

/**
 * 送る時刻になった行を送る。
 * - APNs が未設定(sender = null): 期限切れの整理だけして、取り出さない(キューは壊れない。期限で SKIPPED になる)。
 * - 1件ごとに: 今の候補と設定で確かめる(decidePushSend)→ 端末ごとに [持ち時間の延長 → IN_FLIGHT の記録 → 送信 → 記録を終える]
 *   → 無効な端末を外す → 行の状態を決める(claim_token が一致するときだけ書く)。
 * - 端末ごと: SUCCESS・FAILED・CANCELLED の端末には送らない。PENDING・RETRY の端末だけに送る(取り直した行の UNKNOWN の
 *   端末も、状態は PENDING / RETRY のままなので送り直す — At Least Once)。
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
    partial_failure: 0,
    retried: 0,
    failed: 0,
    cancelled: 0,
    skipped: 0,
    invalidated_devices: 0,
    resent_unknown: 0,
    cancelled_devices: 0,
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

      const active = await deps.store.listActiveDevices(row.user_id);
      const activeById = new Map(active.map((d) => [d.id, d]));
      let targets = await deps.store.ensureTargets(
        row.id,
        active.map((d) => d.id),
      );
      // 再試行の間に外れた端末は送らない(CANCELLED)。後から登録した端末は対象にしない(ensureTargets は最初の1回だけ作る)
      const removed = targets.filter((t) => isOpenTarget(t) && !activeById.has(t.device_id)).map((t) => t.device_id);
      if (removed.length > 0) {
        await deps.store.cancelTargets(row.id, removed, 'DEVICE_REMOVED');
        targets = targets.map((t) =>
          removed.includes(t.device_id) ? { ...t, status: 'CANCELLED', status_reason: 'DEVICE_REMOVED' } : t,
        );
        summary.cancelled_devices += removed.length;
      }
      const round = row.attempts + 1;
      let sentThisRun = 0;
      let lastError: string | null = null;
      let lost = false;
      let configError: string | null = null;

      for (const target of targets.filter(isOpenTarget)) {
        const device = activeById.get(target.device_id)!;
        if (!(await deps.store.renewLease(row.id, row.claim_token, leaseSeconds))) {
          lost = true; // 別のジョブが取り直した — この行には何も書かない
          break;
        }
        if (row.recovery_count > 0) summary.resent_unknown += 1;
        const attemptId = await deps.store.startAttempt({
          notification_id: row.id,
          device_id: device.id,
          attempt: round,
          claim_token: row.claim_token,
        });
        const sent = await deps.sender.send(device, {
          notificationId: row.id,
          title: row.title,
          body: row.body,
          payload: row.payload,
          expiresAt: row.expires_at,
        });
        const updated = await deps.store.completeAttempt(
          attemptId,
          { outcome: sent.outcome, http_status: sent.httpStatus, apns_id: sent.apnsId, reason: sent.reason },
          MAX_DELIVERY_ATTEMPTS,
        );
        if (sent.outcome === 'CONFIG_ERROR') {
          configError = `${sent.httpStatus ?? 'ERR'} ${sent.reason ?? ''}`.trim();
          break;
        }
        sentThisRun += 1;
        targets = targets.map((t) => (t.device_id === updated.device_id ? updated : t));
        if (sent.outcome !== 'SUCCESS') lastError = `${sent.httpStatus ?? 'ERR'} ${sent.reason ?? ''}`.trim();
        if (sent.outcome === 'INVALID_TOKEN') {
          await deps.store.deactivateDevice(device.id, 'APNS_INVALID_TOKEN');
          summary.invalidated_devices += 1;
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
      const attempts = sentThisRun > 0 ? round : row.attempts;
      const result = resolveNotificationState(targets, attempts, now(), row.expires_at);
      if (result.expire_open_targets) await deps.store.expireOpenTargets(row.id);
      const delivered = result.status === 'SENT' || result.status === 'PARTIAL_FAILURE';
      const ok = await deps.store.finish(row.id, row.claim_token, {
        status: result.status,
        status_reason: result.status_reason,
        attempts,
        ...(result.next_attempt_at ? { next_attempt_at: result.next_attempt_at } : {}),
        last_error: lastError,
        sent_at: delivered ? now().toISOString() : null,
      });
      if (!ok) summary.lost_claims += 1;
      else if (result.status === 'SENT') summary.sent += 1;
      else if (result.status === 'PARTIAL_FAILURE') summary.partial_failure += 1;
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
