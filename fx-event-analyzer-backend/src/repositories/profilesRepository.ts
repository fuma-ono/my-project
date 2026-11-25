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

/** The auth providers linked to a user (identities / app_metadata), or null
 * when they cannot be determined. Call before the user is deleted. */
export async function getAuthProviders(supabase: SupabaseClient, userId: string): Promise<string[] | null> {
  try {
    const { data, error } = await supabase.auth.admin.getUserById(userId);
    if (error || !data?.user) return null;
    const providers = new Set<string>();
    for (const identity of data.user.identities ?? []) providers.add(identity.provider);
    const fromMeta: unknown = data.user.app_metadata?.providers;
    if (Array.isArray(fromMeta)) {
      for (const p of fromMeta) if (typeof p === 'string') providers.add(p);
    }
    const single: unknown = data.user.app_metadata?.provider;
    if (typeof single === 'string') providers.add(single);
    return [...providers];
  } catch {
    return null;
  }
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
