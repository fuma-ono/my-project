import { expiresAtFor, type NotificationInboxInsert } from './notificationInbox.js';
import { formatIsoSeconds } from './notifications.js';

/**
 * レートアラート (api-design.md §24.12-§24.14, notification-inbox-spec.md §7).
 * Pure rules: when an alert has crossed, and the RATE_ALERT inbox row it
 * produces. The repository (src/repositories/rateAlertsRepository.ts) only
 * reads/writes rows.
 */

export const RATE_ALERT_DIRECTIONS = ['ABOVE', 'BELOW'] as const;
export type RateAlertDirection = (typeof RATE_ALERT_DIRECTIONS)[number];

/** notification_inbox.trigger of every RATE_ALERT row. */
export const RATE_ALERT_TRIGGER = 'CROSSED';

/** A rate_alerts row joined with its fx_pairs row. */
export interface RateAlertRow {
  id: string;
  user_id: string;
  fx_pair_id: string;
  symbol: string;
  base_currency: string;
  quote_currency: string;
  direction: RateAlertDirection;
  target_price: number;
  is_active: boolean;
  triggered_at: string | null;
  created_at: string;
}

/** GET /rate-alerts item (§24.12). */
export interface RateAlertItem {
  id: string;
  fx_pair_id: string;
  symbol: string;
  direction: RateAlertDirection;
  target_price: number;
  is_active: boolean;
  triggered_at: string | null;
  created_at: string;
}

export function toRateAlertItem(row: RateAlertRow): RateAlertItem {
  return {
    id: row.id,
    fx_pair_id: row.fx_pair_id,
    symbol: row.symbol,
    direction: row.direction,
    target_price: Number(row.target_price),
    is_active: row.is_active,
    triggered_at: row.triggered_at === null ? null : formatIsoSeconds(new Date(row.triggered_at)),
    created_at: formatIsoSeconds(new Date(row.created_at)),
  };
}

/** ABOVE fires when price >= target, BELOW when price <= target. */
export function hasRateAlertCrossed(direction: RateAlertDirection, targetPrice: number, price: number): boolean {
  if (!Number.isFinite(price) || !Number.isFinite(targetPrice)) return false;
  return direction === 'ABOVE' ? price >= targetPrice : price <= targetPrice;
}

/** 「USD/JPY」 from the pair's currencies. */
export function fxPairLabel(baseCurrency: string, quoteCurrency: string): string {
  return `${baseCurrency}/${quoteCurrency}`;
}

function decimalsOf(value: number): number {
  const text = String(value);
  if (text.includes('e')) return 6;
  const dot = text.indexOf('.');
  return dot < 0 ? 0 : text.length - dot - 1;
}

/**
 * Price text: JPY-quoted pairs with 2 decimals (155.00), others with 4
 * (1.0821) — more when the value itself has more (155.125), at most 6
 * (the numeric(12, 6) scale).
 */
export function formatRatePrice(value: number, quoteCurrency: string): string {
  const base = quoteCurrency === 'JPY' ? 2 : 4;
  return value.toFixed(Math.min(Math.max(base, decimalsOf(value)), 6));
}

type AlertForText = Pick<RateAlertRow, 'base_currency' | 'quote_currency' | 'direction' | 'target_price'>;

/** 「USD/JPY が 155.00 を上回りました」 / 「…を下回りました」. */
export function rateAlertTitle(alert: AlertForText): string {
  const verb = alert.direction === 'ABOVE' ? '上回りました' : '下回りました';
  const target = formatRatePrice(Number(alert.target_price), alert.quote_currency);
  return `${fxPairLabel(alert.base_currency, alert.quote_currency)} が ${target} を${verb}`;
}

/** 「現在 155.12（アラート: 155.00 以上）」 / 「…以下）」. */
export function rateAlertBody(alert: AlertForText, price: number): string {
  const bound = alert.direction === 'ABOVE' ? '以上' : '以下';
  const current = formatRatePrice(price, alert.quote_currency);
  const target = formatRatePrice(Number(alert.target_price), alert.quote_currency);
  return `現在 ${current}（アラート: ${target} ${bound}）`;
}

/** The RATE_ALERT inbox row for an alert that crossed at `now`. */
export function rateAlertInboxRow(alert: RateAlertRow, price: number, now: Date): NotificationInboxInsert {
  return {
    user_id: alert.user_id,
    kind: 'RATE_ALERT',
    target_id: alert.id,
    trigger: RATE_ALERT_TRIGGER,
    title: rateAlertTitle(alert),
    body: rateAlertBody(alert, price),
    display_name: null,
    speaker_name: null,
    country_code: null,
    importance: 'HIGH',
    scheduled_at: null,
    notify_at: formatIsoSeconds(now),
    expires_at: formatIsoSeconds(expiresAtFor('RATE_ALERT', now)),
  };
}

/**
 * The alerts of one user that are evaluated: active ones, oldest first, cut
 * to the plan's `max` — so alerts created while on PRO stop firing beyond
 * the FREE limit once the user is FREE (like applyNotificationPlanLimits).
 */
export function evaluableRateAlerts<T extends Pick<RateAlertRow, 'is_active' | 'created_at' | 'id'>>(
  alerts: readonly T[],
  max: number,
): T[] {
  return alerts
    .filter((alert) => alert.is_active)
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.id.localeCompare(b.id))
    .slice(0, Math.max(0, max));
}

export interface CrossedRateAlert {
  alert: RateAlertRow;
  price: number;
}

/** Alerts whose pair has a latest price that crossed the target. */
export function selectCrossedRateAlerts(
  alerts: readonly RateAlertRow[],
  latestPrices: ReadonlyMap<string, number>,
): CrossedRateAlert[] {
  const crossed: CrossedRateAlert[] = [];
  for (const alert of alerts) {
    if (!alert.is_active) continue;
    const price = latestPrices.get(alert.fx_pair_id);
    if (price === undefined) continue;
    if (hasRateAlertCrossed(alert.direction, Number(alert.target_price), price)) crossed.push({ alert, price });
  }
  return crossed;
}
