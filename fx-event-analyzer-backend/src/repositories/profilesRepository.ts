import type { SupabaseClient } from '@supabase/supabase-js';

export interface ProfileRow {
  id: string;
  display_name: string | null;
  created_at: string;
  updated_at: string;
}

export async function getProfile(supabase: SupabaseClient, userId: string): Promise<ProfileRow | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, display_name, created_at, updated_at')
    .eq('id', userId)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function updateProfile(
  supabase: SupabaseClient,
  userId: string,
  updates: { display_name?: string | null | undefined },
): Promise<ProfileRow> {
  const { data, error } = await supabase
    .from('profiles')
    .update(updates)
    .eq('id', userId)
    .select('id, display_name, created_at, updated_at')
    .single();
  if (error) throw error;
  return data;
}
