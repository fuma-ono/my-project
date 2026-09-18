import type { SupabaseClient } from '@supabase/supabase-js';

export interface SubscriptionRow {
  plan: string;
  status: string;
  started_at: string;
  expires_at: string | null;
}

/** The unique partial index on (user_id) WHERE status = 'ACTIVE' means at
 * most one row can match this — but a user may have none yet (never
 * subscribed), which is a legitimate state, not an error. */
export async function getActiveSubscription(supabase: SupabaseClient, userId: string): Promise<SubscriptionRow | null> {
  const { data, error } = await supabase
    .from('subscriptions')
    .select('plan, status, started_at, expires_at')
    .eq('user_id', userId)
    .eq('status', 'ACTIVE')
    .maybeSingle();
  if (error) throw error;
  return data;
}
