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

/** feature_codes every authenticated user has unless an explicit
 * `entitlements` row for the same feature_code says otherwise
 * (db-design.md §3.3.1 default_entitlements, HQ instruction 2026-10-16). */
export async function listDefaultFeatureCodes(supabase: SupabaseClient): Promise<string[]> {
  const { data, error } = await supabase.from('default_entitlements').select('feature_code').order('feature_code');
  if (error) throw error;
  return ((data ?? []) as { feature_code: string }[]).map((row) => row.feature_code);
}
