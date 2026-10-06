import type { SupabaseClient } from '@supabase/supabase-js';

export interface ProfileRow {
  id: string;
  display_name: string | null;
  /** YYYY-MM-DD (Postgres `date`), or null when not set. */
  birth_date: string | null;
  created_at: string;
  updated_at: string;
}

export async function getProfile(supabase: SupabaseClient, userId: string): Promise<ProfileRow | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, display_name, birth_date, created_at, updated_at')
    .eq('id', userId)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** Profiles are not created by a DB trigger on sign-up, so any write that
 * needs one as its FK target creates it first (no-op if it already exists). */
export async function ensureProfile(supabase: SupabaseClient, userId: string): Promise<void> {
  const { error } = await supabase
    .from('profiles')
    .upsert({ id: userId }, { onConflict: 'id', ignoreDuplicates: true });
  if (error) throw error;
}

/**
 * Permanently deletes the user (SCR-026, HQ確定 2026-10-02: physical
 * deletion, not the soft delete db-design.md §3.1 originally described).
 * Deleting the auth.users row cascades to profiles, and from there to
 * subscriptions / entitlements / user_settings / support_requests (db-design.md §7).
 */
export async function deleteUserAccount(supabase: SupabaseClient, userId: string): Promise<void> {
  const { error } = await supabase.auth.admin.deleteUser(userId);
  if (error) throw error;
}

export async function updateProfile(
  supabase: SupabaseClient,
  userId: string,
  updates: { display_name?: string | null | undefined; birth_date?: string | null | undefined },
): Promise<ProfileRow> {
  const { data, error } = await supabase
    .from('profiles')
    .update(updates)
    .eq('id', userId)
    .select('id, display_name, birth_date, created_at, updated_at')
    .single();
  if (error) throw error;
  return data;
}
