import type { SupabaseClient } from '@supabase/supabase-js';
import { ApiError } from '../errors/ApiError.js';
import type { Importance } from '../domain/importance.js';
import { ensureProfile } from './profilesRepository.js';

export interface UserSettingsRow {
  notify_push: boolean;
  notify_indicators: boolean;
  notify_speeches: boolean;
  /** null = すべての通貨ペア */
  notify_fx_pair_symbols: string[] | null;
  notify_importances: Importance[];
  /** 0 / 5 / 10 / 15 / 30 / 60 (DB CHECK) */
  notify_lead_minutes: number;
  notify_quiet_hours_enabled: boolean;
  /** "HH:MM" — the DB `time` value ("23:00:00") with the seconds dropped. */
  notify_quiet_start: string;
  /** "HH:MM" */
  notify_quiet_end: string;
  display_language: string;
  display_region: string;
  display_timezone: string;
  chart_default_fx_pair_symbol: string | null;
  chart_default_timeframe: string;
  updated_at: string;
}

export type UserSettingsUpdate = Partial<Omit<UserSettingsRow, 'updated_at'>>;

const COLUMNS =
  'notify_push, notify_indicators, notify_speeches, notify_fx_pair_symbols, notify_importances, notify_lead_minutes, notify_quiet_hours_enabled, notify_quiet_start, notify_quiet_end, display_language, display_region, display_timezone, chart_default_fx_pair_symbol, chart_default_timeframe, updated_at';

/** Postgres foreign_key_violation — only chart_default_fx_pair_symbol has an
 * FK a client value can break (an fx_pairs.symbol that doesn't exist). */
const FOREIGN_KEY_VIOLATION = '23503';

/** Postgres `time` → "HH:MM" ("23:00:00" → "23:00"). The DB CHECK keeps
 * seconds at 0, so nothing is lost. Writes pass "HH:MM" through as-is —
 * Postgres accepts it for a `time` column. */
function toHourMinute(time: string): string {
  return time.slice(0, 5);
}

function toUserSettingsRow(data: UserSettingsRow): UserSettingsRow {
  return {
    ...data,
    notify_quiet_start: toHourMinute(data.notify_quiet_start),
    notify_quiet_end: toHourMinute(data.notify_quiet_end),
  };
}

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
  return toUserSettingsRow(data);
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
  return toUserSettingsRow(data);
}
