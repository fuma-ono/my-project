import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  NotificationInboxInsert,
  NotificationInboxKind,
  NotificationInboxRow,
} from '../domain/notificationInbox.js';

/**
 * notification_inbox (supabase/migrations/20261013000002_notification_inbox.sql,
 * api-design.md §24.9-§24.11). Expired = expires_at <= now; every read
 * here only sees expires_at > now. Every query is scoped to `userId` —
 * the service_role client bypasses RLS, so this is the ownership check.
 */

const COLUMNS =
  'id, kind, target_id, trigger, title, body, display_name, speaker_name, country_code, importance, scheduled_at, notify_at, read_at, expires_at';

/** INSERT … ON CONFLICT (user_id, kind, target_id, trigger) DO NOTHING. */
export async function insertInboxNotifications(
  supabase: SupabaseClient,
  rows: readonly NotificationInboxInsert[],
): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await supabase
    .from('notification_inbox')
    .upsert([...rows], { onConflict: 'user_id,kind,target_id,trigger', ignoreDuplicates: true });
  if (error) throw error;
}

export async function deleteExpiredInboxNotificationsForUser(
  supabase: SupabaseClient,
  userId: string,
  nowIso: string,
): Promise<void> {
  const { error } = await supabase.from('notification_inbox').delete().eq('user_id', userId).lte('expires_at', nowIso);
  if (error) throw error;
}

export async function listInboxNotifications(
  supabase: SupabaseClient,
  userId: string,
  nowIso: string,
  options: { order: 'asc' | 'desc'; kind?: NotificationInboxKind | undefined },
): Promise<NotificationInboxRow[]> {
  const ascending = options.order === 'asc';
  let query = supabase.from('notification_inbox').select(COLUMNS).eq('user_id', userId).gt('expires_at', nowIso);
  if (options.kind) query = query.eq('kind', options.kind);
  const { data, error } = await query
    .order('notify_at', { ascending })
    .order('created_at', { ascending })
    .order('id', { ascending });
  if (error) throw error;
  return data ?? [];
}

/** Unread, non-expired rows of every kind. */
export async function countUnreadInboxNotifications(
  supabase: SupabaseClient,
  userId: string,
  nowIso: string,
): Promise<number> {
  const { count, error } = await supabase
    .from('notification_inbox')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .is('read_at', null)
    .gt('expires_at', nowIso);
  if (error) throw error;
  return count ?? 0;
}

/**
 * Marks one of the user's non-expired rows read. Idempotent: an already
 * read row keeps its first read_at. null when the row doesn't exist, is
 * someone else's, or has expired.
 */
export async function markInboxNotificationRead(
  supabase: SupabaseClient,
  userId: string,
  id: string,
  nowIso: string,
): Promise<{ id: string; read_at: string } | null> {
  const { error: updateError } = await supabase
    .from('notification_inbox')
    .update({ read_at: nowIso })
    .eq('id', id)
    .eq('user_id', userId)
    .is('read_at', null)
    .gt('expires_at', nowIso);
  if (updateError) throw updateError;

  const { data, error } = await supabase
    .from('notification_inbox')
    .select('id, read_at')
    .eq('id', id)
    .eq('user_id', userId)
    .gt('expires_at', nowIso)
    .maybeSingle();
  if (error) throw error;
  if (!data || data.read_at === null) return null;
  return { id: data.id as string, read_at: data.read_at as string };
}

/** Marks every unread, non-expired row of the user read; returns how many. */
export async function markAllInboxNotificationsRead(
  supabase: SupabaseClient,
  userId: string,
  nowIso: string,
): Promise<number> {
  const { data, error } = await supabase
    .from('notification_inbox')
    .update({ read_at: nowIso })
    .eq('user_id', userId)
    .is('read_at', null)
    .gt('expires_at', nowIso)
    .select('id');
  if (error) throw error;
  return (data ?? []).length;
}

/** The daily job (`npm run jobs:cleanup-notifications`): every user's expired rows. */
export async function deleteAllExpiredInboxNotifications(supabase: SupabaseClient): Promise<number> {
  const { data, error } = await supabase.rpc('delete_expired_notification_inbox');
  if (error) throw error;
  return typeof data === 'number' ? data : 0;
}
