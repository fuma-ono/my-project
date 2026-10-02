import type { SupabaseClient } from '@supabase/supabase-js';
import { ApiError } from '../errors/ApiError.js';
import { ensureProfile } from './profilesRepository.js';

export interface UserSettingsRow {
  notify_pre_release: boolean;
  notify_result: boolean;
  notify_favorites: boolean;
  notify_min_importance: number;
  display_language: string;
  display_region: string;
  display_timezone: string;
  chart_default_fx_pair_symbol: string | null;
  chart_default_timeframe: string;
  updated_at: string;
}

export type UserSettingsUpdate = Partial<Omit<UserSettingsRow, 'updated_at'>>;

const COLUMNS =
  'notify_pre_release, notify_result, notify_favorites, notify_min_importance, display_language, display_region, display_timezone, chart_default_fx_pair_symbol, chart_default_timeframe, updated_at';

/** Postgres foreign_key_violation — only chart_default_fx_pair_symbol has an
 * FK a client value can break (an fx_pairs.symbol that doesn't exist). */
const FOREIGN_KEY_VIOLATION = '23503';

/**
 * Returns the user's settings, creating the row on first access. Creating
 * it here (rather than returning hard-coded defaults when no row exists)
 * keeps the column defaults in supabase/migrations/…_user_settings.sql the
 * single source of truth for what a new user's settings are.
 */
export async function getOrCreateUserSettings(supabase: SupabaseClient, userId: string): Promise<UserSettingsRow> {
  await ensureProfile(supabase, userId);
  const { error: insertError } = await supabase
    .from('user_settings')
    .upsert({ user_id: userId }, { onConflict: 'user_id', ignoreDuplicates: true });
  if (insertError) throw insertError;

  const { data, error } = await supabase.from('user_settings').select(COLUMNS).eq('user_id', userId).single();
  if (error) throw error;
  return data;
}

export async function updateUserSettings(
  supabase: SupabaseClient,
  userId: string,
  updates: UserSettingsUpdate,
): Promise<UserSettingsRow> {
  const current = await getOrCreateUserSettings(supabase, userId);
  if (Object.keys(updates).length === 0) {
    return current;
  }

  const { data, error } = await supabase
    .from('user_settings')
    .update(updates)
    .eq('user_id', userId)
    .select(COLUMNS)
    .single();
  if (error) {
    if (error.code === FOREIGN_KEY_VIOLATION) {
      throw ApiError.validation('chart.default_fx_pair_symbol: unknown FX pair symbol');
    }
    throw error;
  }
  return data;
}
