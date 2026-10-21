import type { SupabaseClient } from '@supabase/supabase-js';
import {
  evaluableRateAlerts,
  rateAlertInboxRow,
  selectCrossedRateAlerts,
  type RateAlertDirection,
  type RateAlertRow,
} from '../domain/rateAlerts.js';
import { resolvePlan } from '../authorization/plan.js';
import { planLimitsFor } from '../domain/planLimits.js';
import { listLatestFxPrices } from './fxPairsRepository.js';
import { insertInboxNotifications } from './notificationInboxRepository.js';
import { listPushDisabledUserIds } from './userSettingsRepository.js';

/**
 * rate_alerts (supabase/migrations/20261015000001_rate_alerts.sql,
 * api-design.md §24.12-§24.14). Every user-facing query is scoped to
 * `userId` — the service_role client bypasses RLS, so this is the
 * ownership check.
 */

const COLUMNS =
  'id, user_id, fx_pair_id, direction, target_price, is_active, triggered_at, created_at, fx_pairs!inner(symbol, base_currency, quote_currency)';

interface RateAlertDbRow {
  id: string;
  user_id: string;
  fx_pair_id: string;
  direction: RateAlertDirection;
  target_price: number | string;
  is_active: boolean;
  triggered_at: string | null;
  created_at: string;
  fx_pairs: unknown;
}

function toRow(row: RateAlertDbRow): RateAlertRow {
  const pair = row.fx_pairs as { symbol: string; base_currency: string; quote_currency: string };
  return {
    id: row.id,
    user_id: row.user_id,
    fx_pair_id: row.fx_pair_id,
    symbol: pair.symbol,
    base_currency: pair.base_currency,
    quote_currency: pair.quote_currency,
    direction: row.direction,
    target_price: Number(row.target_price),
    is_active: row.is_active,
    triggered_at: row.triggered_at,
    created_at: row.created_at,
  };
}

/** The user's alerts (active and fired), oldest first. */
export async function listRateAlertsForUser(supabase: SupabaseClient, userId: string): Promise<RateAlertRow[]> {
  const { data, error } = await supabase
    .from('rate_alerts')
    .select(COLUMNS)
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row) => toRow(row as RateAlertDbRow));
}

export async function countActiveRateAlerts(supabase: SupabaseClient, userId: string): Promise<number> {
  const { count, error } = await supabase
    .from('rate_alerts')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('is_active', true);
  if (error) throw error;
  return count ?? 0;
}

export async function insertRateAlert(
  supabase: SupabaseClient,
  input: { user_id: string; fx_pair_id: string; direction: RateAlertDirection; target_price: number },
): Promise<RateAlertRow> {
  const { data, error } = await supabase.from('rate_alerts').insert(input).select(COLUMNS).single();
  if (error) throw error;
  return toRow(data);
}

/** Deletes one of the user's alerts; false when it doesn't exist or isn't theirs. */
export async function deleteRateAlert(supabase: SupabaseClient, userId: string, id: string): Promise<boolean> {
  const { data, error } = await supabase.from('rate_alerts').delete().eq('id', id).eq('user_id', userId).select('id');
  if (error) throw error;
  return (data ?? []).length > 0;
}

/** Every user's active alerts (the job), grouped by user. */
export async function listAllActiveRateAlerts(supabase: SupabaseClient): Promise<Map<string, RateAlertRow[]>> {
  const { data, error } = await supabase
    .from('rate_alerts')
    .select(COLUMNS)
    .eq('is_active', true)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true });
  if (error) throw error;
  const byUser = new Map<string, RateAlertRow[]>();
  for (const row of (data ?? []).map((entry) => toRow(entry as RateAlertDbRow))) {
    const list = byUser.get(row.user_id) ?? [];
    list.push(row);
    byUser.set(row.user_id, list);
  }
  return byUser;
}

/**
 * Fires the crossed ones among `alerts` (already scoped to what may be
 * evaluated) against the latest prices: inserts the RATE_ALERT inbox rows
 * first (ON CONFLICT DO NOTHING on (user_id, kind, target_id, trigger), so
 * concurrent callers never duplicate), then sets is_active = false /
 * triggered_at = now for those still active. Returns the fired alert ids.
 */
export async function fireCrossedRateAlerts(
  supabase: SupabaseClient,
  alerts: readonly RateAlertRow[],
  now: Date,
  latestPrices?: ReadonlyMap<string, number>,
): Promise<string[]> {
  if (alerts.length === 0) return [];
  const prices =
    latestPrices ??
    (await listLatestFxPrices(
      supabase,
      alerts.map((alert) => alert.fx_pair_id),
    ));
  const crossed = selectCrossedRateAlerts(alerts, prices);
  if (crossed.length === 0) return [];

  await insertInboxNotifications(
    supabase,
    crossed.map(({ alert, price }) => rateAlertInboxRow(alert, price, now)),
  );
  const ids = crossed.map(({ alert }) => alert.id);
  const { error } = await supabase
    .from('rate_alerts')
    .update({ is_active: false, triggered_at: now.toISOString() })
    .in('id', ids)
    .eq('is_active', true);
  if (error) throw error;
  return ids;
}

/** GET /notifications: the caller's active alerts, cut to the plan's max, fired if crossed. */
export async function evaluateRateAlertsForUser(
  supabase: SupabaseClient,
  userId: string,
  maxActive: number,
  now: Date,
): Promise<string[]> {
  const alerts = (await listRateAlertsForUser(supabase, userId)).filter((alert) => alert.is_active);
  return fireCrossedRateAlerts(supabase, evaluableRateAlerts(alerts, maxActive), now);
}

/**
 * `npm run jobs:evaluate-rate-alerts`: the same evaluation as GET
 * /notifications for every user with an active alert — skipping users
 * whose push is off (like GET /notifications) and cutting each user's
 * alerts to their plan's max. Prices are fetched once per pair.
 */
export async function evaluateAllRateAlerts(
  supabase: SupabaseClient,
  now: Date,
): Promise<{ users: number; evaluated: number; fired: number }> {
  const byUser = await listAllActiveRateAlerts(supabase);
  const userIds = [...byUser.keys()];
  const pushOff = await listPushDisabledUserIds(supabase, userIds);

  const evaluable: RateAlertRow[] = [];
  for (const userId of userIds) {
    if (pushOff.has(userId)) continue;
    const plan = await resolvePlan(supabase, userId);
    evaluable.push(...evaluableRateAlerts(byUser.get(userId) ?? [], planLimitsFor(plan).rate_alerts_max));
  }
  const prices = await listLatestFxPrices(
    supabase,
    evaluable.map((alert) => alert.fx_pair_id),
  );
  const fired = await fireCrossedRateAlerts(supabase, evaluable, now, prices);
  return { users: userIds.length - pushOff.size, evaluated: evaluable.length, fired: fired.length };
}
