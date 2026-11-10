import type { SupabaseClient } from '@supabase/supabase-js';
import { planLimitsFor } from '../domain/planLimits.js';
import type { PushNotificationRow } from '../domain/pushNotifications.js';
import { loadNotificationPreferences } from '../notifications/preferences.js';
import type { PushDeviceRow, PushStore } from '../push/pushJobs.js';
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
      'id, push_type, target_kind, target_id, reason, title, body, status, status_reason, scheduled_send_at, sent_at, attempts',
    )
    .eq('user_id', userId)
    .gte('created_at', sinceIso)
    .order('scheduled_send_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return ((data ?? []) as PushHistoryItem[]).map((r) => ({
    ...r,
    scheduled_send_at: new Date(r.scheduled_send_at).toISOString(),
    sent_at: r.sent_at ? new Date(r.sent_at).toISOString() : null,
  }));
}

function toNotificationRow(row: Record<string, unknown>): PushNotificationRow {
  const isoOf = (v: unknown) => new Date(String(v)).toISOString();
  return {
    ...(row as unknown as PushNotificationRow),
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

    async claimDue(limit, leaseSeconds) {
      const { data, error } = await supabase.rpc('claim_due_push_notifications', {
        p_limit: limit,
        p_lease_seconds: leaseSeconds,
      });
      if (error) throw error;
      return ((data ?? []) as Record<string, unknown>[]).map(toNotificationRow);
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

    async recordAttempt(attempt) {
      const { error } = await supabase.from('push_delivery_attempts').insert(attempt);
      if (error) throw error;
    },

    async deactivateDevice(deviceId, reason) {
      const { error } = await supabase
        .from('push_devices')
        .update({ is_active: false, disabled_at: new Date().toISOString(), disabled_reason: reason })
        .eq('id', deviceId);
      if (error) throw error;
    },

    async finish(notificationId, update) {
      const { error } = await supabase
        .from('push_notifications')
        .update({ ...update, lease_until: null })
        .eq('id', notificationId)
        .eq('status', 'SENDING');
      if (error) throw error;
    },
  };
}
