import type { SupabaseClient } from '@supabase/supabase-js';

export interface EntitlementRow {
  feature_code: string;
  enabled: boolean;
  expires_at: string | null;
}

export async function listEntitlements(supabase: SupabaseClient, userId: string): Promise<EntitlementRow[]> {
  const { data, error } = await supabase
    .from('entitlements')
    .select('feature_code, enabled, expires_at')
    .eq('user_id', userId);
  if (error) throw error;
  return data ?? [];
}
