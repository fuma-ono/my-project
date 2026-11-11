import type { SupabaseClient } from '@supabase/supabase-js';
import { planLimitsFor } from '../domain/planLimits.js';
import type { PushTarget } from '../domain/pushNotifications.js';
import { loadNotificationPreferences } from '../notifications/preferences.js';
import type { ClaimedPushNotification, PushDeviceRow, PushStore } from '../push/pushJobs.js';
import { listNotificationCandidates, listNotificationCandidatesByIds } from './notificationsRepository.js';
import { listPushDisabledUserIds } from './userSettingsRepository.js';

/**
 * プッシュ通知の表(migration 20261110000005)の読み書き。Backend(service_role)だけが書く。
 * 利用者の API(routes/pushNotifications.ts)は、どの関数でも user_id で自分の行だけに絞る。
 */

export interface PushDeviceView {
  id: string;
  platform: string;
  environment: 'SANDBOX' | 'PRODUCTION';
  /** トークンの末尾8文字(全体は返さない) */
  token_suffix: string;
  app_version: string | null;
  is_active: boolean;
  last_registered_at: string;
  disabled_reason: string | null;
}

const DEVICE_COLUMNS =
  'id, user_id, platform, device_token, environment, app_version, is_active, last_registered_at, disabled_reason';

interface DeviceDbRow {
  id: string;
  user_id: string;
  platform: string;
  device_token: string;
  environment: 'SANDBOX' | 'PRODUCTION';
  app_version: string | null;
  is_active: boolean;
  last_registered_at: string;
  disabled_reason: string | null;
}

function toDeviceView(row: DeviceDbRow): PushDeviceView {
  return {
    id: row.id,
    platform: row.platform,
    environment: row.environment,
    token_suffix: row.device_token.slice(-8),
    app_version: row.app_version,
    is_active: row.is_active,
    last_registered_at: new Date(row.last_registered_at).toISOString(),
    disabled_reason: row.disabled_reason,
  };
}

/**
 * 端末を登録する(同じトークン・環境の行があればこの利用者のものにして有効に戻す — 端末で別の利用者がログインした場合)。
 * 戻り値の created = 新しく作ったか。
 */
export async function registerPushDevice(
  supabase: SupabaseClient,
  userId: string,
  input: { device_token: string; environment: 'SANDBOX' | 'PRODUCTION'; app_version: string | null },
): Promise<{ device: PushDeviceView; created: boolean }> {
  const token = input.device_token.toLowerCase();
  const existing = await supabase
    .from('push_devices')
    .select('id, user_id')
    .eq('device_token', token)
    .eq('environment', input.environment)
    .maybeSingle();
  if (existing.error) throw existing.error;
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('push_devices')
    .upsert(
      {
        user_id: userId,
        platform: 'IOS',
        device_token: token,
        environment: input.environment,
        app_version: input.app_version,
        is_active: true,
        last_registered_at: now,
        disabled_at: null,
        disabled_reason: null,
      },
      { onConflict: 'device_token,environment' },
    )
    .select(DEVICE_COLUMNS)
    .single();
  if (error) throw error;
  return { device: toDeviceView(data), created: !existing.data };
}

export async function listPushDevicesForUser(supabase: SupabaseClient, userId: string): Promise<PushDeviceView[]> {
  const { data, error } = await supabase
    .from('push_devices')
    .select(DEVICE_COLUMNS)
    .eq('user_id', userId)
    .order('last_registered_at', { ascending: false });
  if (error) throw error;
  return ((data ?? []) as DeviceDbRow[]).map(toDeviceView);
}

/** 自分の端末だけを外す。他人の端末・無い id は null(404)。 */
export async function unregisterPushDevice(
  supabase: SupabaseClient,
  userId: string,
  deviceId: string,
): Promise<PushDeviceView | null> {
  const { data, error } = await supabase
    .from('push_devices')
    .update({ is_active: false, disabled_at: new Date().toISOString(), disabled_reason: 'USER_UNREGISTERED' })
    .eq('id', deviceId)
    .eq('user_id', userId)
    .select(DEVICE_COLUMNS)
    .maybeSingle();
  if (error) throw error;
  return data ? toDeviceView(data) : null;
}

export async function listFavoriteCurrencies(supabase: SupabaseClient, userId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('push_favorite_currencies')
    .select('currency_code')
    .eq('user_id', userId)
    .order('currency_code');
  if (error) throw error;
  return ((data ?? []) as { currency_code: string }[]).map((r) => r.currency_code);
}

/** お気に入り通貨を置き換える(呼び出し側で検証・プランの上限を確認済み)。 */
export async function replaceFavoriteCurrencies(
  supabase: SupabaseClient,
  userId: string,
  codes: readonly string[],
): Promise<string[]> {
  const unique = [...new Set(codes)].sort();
  const del = await supabase.from('push_favorite_currencies').delete().eq('user_id', userId);
  if (del.error) throw del.error;
  if (unique.length > 0) {
    const ins = await supabase
      .from('push_favorite_currencies')
      .insert(unique.map((currency_code) => ({ user_id: userId, currency_code })));
    if (ins.error) throw ins.error;
  }
  return unique;
}

export interface PushHistoryItem {
  id: string;
  push_type: string;
  target_kind: string;
  target_id: string;
  reason: string;
  title: string;
  body: string;
  status: string;
  status_reason: string | null;
  scheduled_send_at: string;
  sent_at: string | null;
  attempts: number;
  /**
   * 端末ごとの内訳(HQ指示 2026-11-10「複数端末配信・部分失敗対応」で追加。項目を足しただけで、既存の項目は変えていない)。
   * まだ1回も送っていない通知は total 0。
   */
  devices: { total: number; success: number; failed: number; pending: number; cancelled: number };
}

export async function listPushHistory(
  supabase: SupabaseClient,
  userId: string,
  sinceIso: string,
  limit: number,
): Promise<PushHistoryItem[]> {
  const { data, error } = await supabase
    .from('push_notifications')
    .select(
      'id, push_type, target_kind, target_id, reason, title, body, status, status_reason, scheduled_send_at, sent_at, attempts, push_notification_targets(status)',
    )
    .eq('user_id', userId)
    .gte('created_at', sinceIso)
    .order('scheduled_send_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  type Row = Omit<PushHistoryItem, 'devices'> & { push_notification_targets: { status: string }[] | null };
  return ((data ?? []) as unknown as Row[]).map(({ push_notification_targets: targets, ...r }) => {
    const list = targets ?? [];
    const count = (...statuses: string[]) => list.filter((t) => statuses.includes(t.status)).length;
    return {
      ...r,
      scheduled_send_at: new Date(r.scheduled_send_at).toISOString(),
      sent_at: r.sent_at ? new Date(r.sent_at).toISOString() : null,
      devices: {
        total: list.length,
        success: count('SUCCESS'),
        failed: count('FAILED'),
        pending: count('PENDING', 'RETRY'),
        cancelled: count('CANCELLED'),
      },
    };
  });
}

function toNotificationRow(row: Record<string, unknown>): ClaimedPushNotification {
  const isoOf = (v: unknown) => new Date(String(v)).toISOString();
  return {
    ...(row as unknown as ClaimedPushNotification),
    claim_token: String(row.claim_token),
    recovery_count: Number(row.recovery_count ?? 0),
    event_scheduled_at: isoOf(row.event_scheduled_at),
    scheduled_send_at: isoOf(row.scheduled_send_at),
    expires_at: isoOf(row.expires_at),
    next_attempt_at: isoOf(row.next_attempt_at),
    payload: (row.payload as Record<string, unknown> | null) ?? {},
  };
}

/** 送信のジョブの PushStore(service_role)。 */
export function createPushStore(supabase: SupabaseClient): PushStore {
  return {
    async listPushUserIds() {
      const { data, error } = await supabase.from('push_devices').select('user_id').eq('is_active', true);
      if (error) throw error;
      const ids = [...new Set(((data ?? []) as { user_id: string }[]).map((r) => r.user_id))];
      const disabled = await listPushDisabledUserIds(supabase, ids);
      return ids.filter((id) => !disabled.has(id)).sort();
    },

    async loadUserContext(userId) {
      const { prefs, plan, language } = await loadNotificationPreferences(supabase, userId);
      const favorites = await listFavoriteCurrencies(supabase, userId);
      const max = plan ? planLimitsFor(plan).favorites_max : null;
      return {
        userId,
        prefs,
        language,
        favoriteCurrencies: max === null ? favorites : favorites.slice(0, max),
      };
    },

    listCandidates(fromIso, toIso, kinds, includePast) {
      return listNotificationCandidates(supabase, fromIso, toIso, kinds, { includePast });
    },

    listCandidatesByIds(ids) {
      return listNotificationCandidatesByIds(supabase, ids);
    },

    async enqueue(items) {
      if (items.length === 0) return 0;
      const { data, error } = await supabase
        .from('push_notifications')
        .upsert(
          items.map((i) => ({ ...i, next_attempt_at: i.scheduled_send_at })),
          {
            onConflict: 'user_id,push_type,target_kind,target_id,event_scheduled_at',
            ignoreDuplicates: true,
          },
        )
        .select('id');
      if (error) throw error;
      return (data ?? []).length;
    },

    async expireOverdue() {
      const { data, error } = await supabase.rpc('expire_push_notifications');
      if (error) throw error;
      return Number(data ?? 0);
    },

    async claimDue(limit, leaseSeconds, maxRecoveries) {
      const { data, error } = await supabase.rpc('claim_due_push_notifications', {
        p_limit: limit,
        p_lease_seconds: leaseSeconds,
        p_max_recoveries: maxRecoveries,
      });
      if (error) throw error;
      return ((data ?? []) as Record<string, unknown>[]).map(toNotificationRow);
    },

    async renewLease(notificationId, claimToken, leaseSeconds) {
      const { data, error } = await supabase.rpc('renew_push_notification_lease', {
        p_id: notificationId,
        p_claim_token: claimToken,
        p_lease_seconds: leaseSeconds,
      });
      if (error) throw error;
      return data === true;
    },

    async ensureTargets(notificationId, deviceIds) {
      const read = async () => {
        const { data, error } = await supabase
          .from('push_notification_targets')
          .select('device_id, status, status_reason, attempts')
          .eq('notification_id', notificationId)
          .order('device_id');
        if (error) throw error;
        return (data ?? []) as PushTarget[];
      };
      const existing = await read();
      if (existing.length > 0 || deviceIds.length === 0) return existing;
      // 最初に送るとき: 今の有効な端末を対象にする(この行を取り出している worker だけがここに来る)
      const { error } = await supabase.from('push_notification_targets').upsert(
        deviceIds.map((device_id) => ({ notification_id: notificationId, device_id })),
        { onConflict: 'notification_id,device_id', ignoreDuplicates: true },
      );
      if (error) throw error;
      return read();
    },

    async cancelTargets(notificationId, deviceIds, reason) {
      if (deviceIds.length === 0) return;
      const { error } = await supabase
        .from('push_notification_targets')
        .update({ status: 'CANCELLED', status_reason: reason })
        .eq('notification_id', notificationId)
        .in('device_id', [...deviceIds])
        .in('status', ['PENDING', 'RETRY']);
      if (error) throw error;
    },

    async expireOpenTargets(notificationId) {
      const { error } = await supabase
        .from('push_notification_targets')
        .update({ status: 'FAILED', status_reason: 'EXPIRED' })
        .eq('notification_id', notificationId)
        .in('status', ['PENDING', 'RETRY']);
      if (error) throw error;
    },

    async startAttempt(attempt) {
      const { data, error } = await supabase
        .from('push_delivery_attempts')
        .insert({ ...attempt, outcome: 'IN_FLIGHT' })
        .select('id')
        .single();
      if (error) throw error;
      return String(data.id);
    },

    async completeAttempt(attemptId, result, maxAttempts) {
      const { data, error } = await supabase.rpc('complete_push_delivery_attempt', {
        p_attempt_id: attemptId,
        p_outcome: result.outcome,
        p_http_status: result.http_status,
        p_apns_id: result.apns_id,
        p_reason: result.reason,
        p_max_attempts: maxAttempts,
      });
      if (error) throw error;
      const [row] = (data ?? []) as PushTarget[];
      if (!row) throw new Error(`no push target for attempt ${attemptId}`);
      return {
        device_id: row.device_id,
        status: row.status,
        status_reason: row.status_reason,
        attempts: row.attempts,
      };
    },

    async listActiveDevices(userId): Promise<PushDeviceRow[]> {
      const { data, error } = await supabase
        .from('push_devices')
        .select('id, user_id, device_token, environment')
        .eq('user_id', userId)
        .eq('is_active', true);
      if (error) throw error;
      return data ?? [];
    },

    async deactivateDevice(deviceId, reason) {
      const { error } = await supabase
        .from('push_devices')
        .update({ is_active: false, disabled_at: new Date().toISOString(), disabled_reason: reason })
        .eq('id', deviceId);
      if (error) throw error;
    },

    async finish(notificationId, claimToken, update) {
      const { data, error } = await supabase
        .from('push_notifications')
        .update({ ...update, lease_until: null, claim_token: null })
        .eq('id', notificationId)
        .eq('claim_token', claimToken)
        .eq('status', 'SENDING')
        .select('id');
      if (error) throw error;
      return (data ?? []).length === 1;
    },
  };
}

/** 運用の集計(migration の push_queue_stats)。 */
export async function getPushQueueStats(supabase: SupabaseClient, sinceIso: string): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.rpc('push_queue_stats', { p_since: sinceIso });
  if (error) throw error;
  return (data ?? {}) as Record<string, unknown>;
}

/** 古い行の整理(migration の cleanup_push_notifications)。戻り値 = 消した件数。 */
export async function cleanupPushNotifications(
  supabase: SupabaseClient,
  keepDays = 30,
  keepFailedDays = 90,
): Promise<number> {
  const { data, error } = await supabase.rpc('cleanup_push_notifications', {
    p_keep_days: keepDays,
    p_keep_failed_days: keepFailedDays,
  });
  if (error) throw error;
  return Number(data ?? 0);
}
