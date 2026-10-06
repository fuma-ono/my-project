import type { SupabaseClient } from '@supabase/supabase-js';
import { ApiError } from '../errors/ApiError.js';
import type { AppStoreSubscriptionState } from '../storekit/appStoreTransaction.js';

export interface SubscriptionRow {
  plan: string;
  status: string;
  started_at: string;
  expires_at: string | null;
  /** App Store product (月額/年額). SCR-017 shows it; absent from the verify RPC result. */
  product_id?: string | null;
}

/**
 * The subscription that currently applies to the user, or null (never
 * subscribed / everything lapsed) — a legitimate state, not an error.
 *
 * ACTIVE and TRIAL count, and so does CANCELED until its expires_at
 * (api-design.md §26: "CANCELEDになってもexpires_atまでは有効"). The
 * one-ACTIVE-per-user index keeps ACTIVE unique, but CANCELED/TRIAL rows
 * aren't covered by it, so the latest-expiring one wins.
 */
export async function getActiveSubscription(supabase: SupabaseClient, userId: string): Promise<SubscriptionRow | null> {
  const { data, error } = await supabase
    .from('subscriptions')
    .select('plan, status, started_at, expires_at, product_id')
    .eq('user_id', userId)
    .in('status', ['ACTIVE', 'TRIAL', 'CANCELED'])
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
    .order('expires_at', { ascending: false, nullsFirst: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** Raised by apply_app_store_subscription() when the App Store subscription
 * already belongs to a different user. */
const SUBSCRIPTION_OWNED_BY_ANOTHER_USER = 'P0409';

/** Stores a verified App Store subscription and syncs the PRO entitlements,
 * atomically (supabase/migrations/…_subscriptions_app_store.sql). */
export async function applyAppStoreSubscription(
  supabase: SupabaseClient,
  userId: string,
  state: AppStoreSubscriptionState,
  proFeatureCodes: readonly string[],
): Promise<SubscriptionRow> {
  const { data, error } = await supabase
    .rpc('apply_app_store_subscription', {
      p_user_id: userId,
      p_original_transaction_id: state.originalTransactionId,
      p_transaction_id: state.transactionId,
      p_product_id: state.productId,
      p_environment: state.environment,
      p_status: state.status,
      p_started_at: state.startedAt,
      p_expires_at: state.expiresAt,
      p_auto_renew: state.autoRenew,
      p_revoked_at: state.revokedAt,
      p_pro_feature_codes: proFeatureCodes,
    })
    .single<SubscriptionRow>();
  if (error) {
    if (error.code === SUBSCRIPTION_OWNED_BY_ANOTHER_USER) {
      throw new ApiError('CONFLICT', 'This App Store subscription is already linked to another account.');
    }
    throw error;
  }
  return data;
}
