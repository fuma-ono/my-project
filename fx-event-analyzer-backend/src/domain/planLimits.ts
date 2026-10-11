import { FEATURE_CODES } from '../authorization/entitlements.js';
import { IMPORTANCES_DESC, type Importance } from './importance.js';
import { formatIsoSeconds } from './notifications.js';
import { localYearMonth, startOfLocalDayUtc } from './timezone.js';

/**
 * FREE / PRO usage limits (HQ決定 2026-10-08, api-design.md §28.1). Every
 * per-plan number lives here and nowhere else; routes ask
 * `planLimitsFor(plan)` and the helpers below.
 *
 * The plan itself is not stored anywhere — it is derived from the user's
 * active entitlements (`planFromFeatures`): PRO = has an active
 * VIEW_ADVANCED_STATS row (granted by POST /subscription/verify, §28),
 * FREE = any other authenticated user.
 */
export const PLANS = ['FREE', 'PRO'] as const;
export type Plan = (typeof PLANS)[number];

/** How far back GET /calendar may go: N months before the current month,
 * or Jan 1st of N years before the current year (both in the request's
 * timezone, at 00:00). */
export type CalendarPastLimit = { unit: 'MONTHS'; count: number } | { unit: 'YEARS'; count: number };

export interface PlanLimits {
  calendar_past: CalendarPastLimit;
  /** `to` may not exceed Jan 1st of (current year + this), 00:00 local. */
  calendar_future_years: number;
  /** お気に入り (stored on-device; the Backend only reports the number). null = unlimited. */
  favorites_max: number | null;
  /** 通知できる重要度. Always ordered HIGH, MEDIUM, LOW. */
  notification_importances: readonly Importance[];
  /** 通知の対象通貨ペアの上限. null = unlimited, including "all pairs" (fx_pairs = null). */
  notification_fx_pairs_max: number | null;
  /** 過去イベント比較に使う過去の発表回の上限 (most recent first). */
  history_events_max: number;
}

export const PLAN_LIMITS: Readonly<Record<Plan, PlanLimits>> = {
  FREE: {
    calendar_past: { unit: 'MONTHS', count: 1 },
    calendar_future_years: 2,
    favorites_max: 3,
    notification_importances: ['HIGH'],
    notification_fx_pairs_max: 1,
    history_events_max: 5,
  },
  PRO: {
    calendar_past: { unit: 'YEARS', count: 5 },
    calendar_future_years: 2,
    favorites_max: null,
    notification_importances: IMPORTANCES_DESC,
    notification_fx_pairs_max: null,
    history_events_max: 20,
  },
};

/** FREE can't use "all pairs": a stored fx_pairs = null (e.g. a lapsed PRO
 * user, or the column default) is evaluated as this one pair. */
export const FREE_DEFAULT_NOTIFICATION_FX_PAIR = 'USDJPY';

export function planLimitsFor(plan: Plan): PlanLimits {
  return PLAN_LIMITS[plan];
}

/** `features` = the user's *active* feature_codes (enabled, not expired). */
export function planFromFeatures(features: readonly string[]): Plan {
  return features.includes(FEATURE_CODES.VIEW_ADVANCED_STATS) ? 'PRO' : 'FREE';
}

/** Earliest `from` GET /calendar accepts for `plan` (inclusive). */
export function calendarEarliestFrom(plan: Plan, now: Date, timeZone: string): Date {
  const past = planLimitsFor(plan).calendar_past;
  const { year, month } = localYearMonth(now, timeZone);
  return past.unit === 'MONTHS'
    ? startOfLocalDayUtc(year, month - past.count, 1, timeZone)
    : startOfLocalDayUtc(year - past.count, 1, 1, timeZone);
}

/** Latest `to` GET /calendar accepts for `plan` (`to` is exclusive, so this
 * is the end of the year before). */
export function calendarLatestTo(plan: Plan, now: Date, timeZone: string): Date {
  const { year } = localYearMonth(now, timeZone);
  return startOfLocalDayUtc(year + planLimitsFor(plan).calendar_future_years, 1, 1, timeZone);
}

/** GET /entitlements `limits` (api-design.md §27). */
export interface EntitlementLimits {
  calendar_earliest_from: string;
  calendar_latest_to: string;
  favorites_max: number | null;
  notification_importances: Importance[];
  notification_fx_pairs_max: number | null;
  history_events_max: number;
}

export function toEntitlementLimits(plan: Plan, now: Date, timeZone: string): EntitlementLimits {
  const limits = planLimitsFor(plan);
  return {
    calendar_earliest_from: formatIsoSeconds(calendarEarliestFrom(plan, now, timeZone)),
    calendar_latest_to: formatIsoSeconds(calendarLatestTo(plan, now, timeZone)),
    favorites_max: limits.favorites_max,
    notification_importances: [...limits.notification_importances],
    notification_fx_pairs_max: limits.notification_fx_pairs_max,
    history_events_max: limits.history_events_max,
  };
}

/**
 * GET /calendar range check against the plan.
 * - `ok`: allowed.
 * - `PLAN_LIMIT_EXCEEDED`: this plan can't, but PRO could → 403 with required_plan.
 * - `OUT_OF_RANGE`: no plan allows it → 422.
 */
export type CalendarRangeVerdict =
  | { kind: 'OK' }
  | { kind: 'PLAN_LIMIT_EXCEEDED'; field: 'from'; bound: Date; requiredPlan: Plan }
  | { kind: 'OUT_OF_RANGE'; field: 'from' | 'to'; bound: Date };

export function checkCalendarRange(
  plan: Plan,
  from: Date,
  to: Date,
  now: Date,
  timeZone: string,
): CalendarRangeVerdict {
  const latestTo = calendarLatestTo(plan, now, timeZone);
  if (to.getTime() > latestTo.getTime()) {
    return { kind: 'OUT_OF_RANGE', field: 'to', bound: latestTo };
  }
  const earliestFrom = calendarEarliestFrom(plan, now, timeZone);
  if (from.getTime() < earliestFrom.getTime()) {
    const upgrade = PLANS.slice(PLANS.indexOf(plan) + 1).find(
      (candidate) => from.getTime() >= calendarEarliestFrom(candidate, now, timeZone).getTime(),
    );
    return upgrade
      ? { kind: 'PLAN_LIMIT_EXCEEDED', field: 'from', bound: earliestFrom, requiredPlan: upgrade }
      : { kind: 'OUT_OF_RANGE', field: 'from', bound: earliestFrom };
  }
  return { kind: 'OK' };
}

/**
 * PATCH /settings: the notification fields the plan doesn't allow. Only
 * the fields present in the PATCH are checked (undefined = not sent).
 * Returns a message for 403 PLAN_LIMIT_EXCEEDED, or null when allowed.
 */
export function notificationPlanViolation(
  plan: Plan,
  notifications: { importances?: readonly Importance[] | undefined; fx_pairs?: readonly string[] | null | undefined },
): string | null {
  const limits = planLimitsFor(plan);
  const { importances, fx_pairs: fxPairs } = notifications;
  if (importances !== undefined) {
    const notAllowed = importances.filter((level) => !limits.notification_importances.includes(level));
    if (notAllowed.length > 0) {
      return `notifications.importances: ${notAllowed.join(', ')} is not available on the ${plan} plan (allowed: ${limits.notification_importances.join(', ')}).`;
    }
  }
  if (fxPairs !== undefined && limits.notification_fx_pairs_max !== null) {
    if (fxPairs === null) {
      return `notifications.fx_pairs: all pairs (null) is not available on the ${plan} plan; choose up to ${limits.notification_fx_pairs_max}.`;
    }
    if (fxPairs.length > limits.notification_fx_pairs_max) {
      return `notifications.fx_pairs: at most ${limits.notification_fx_pairs_max} pair(s) on the ${plan} plan.`;
    }
  }
  return null;
}

/**
 * GET /notifications/upcoming: applies the plan's limits to the *stored*
 * settings at evaluation time, so wider settings saved while on PRO stop
 * applying once the user is FREE. Importances outside the plan are dropped
 * (none left → the plan's own levels); fx_pairs is cut to the first N
 * stored pairs, and "all pairs" (null) becomes FREE_DEFAULT_NOTIFICATION_FX_PAIR.
 */
export function applyNotificationPlanLimits(
  plan: Plan,
  stored: { importances: readonly Importance[]; fxPairSymbols: readonly string[] | null },
): { importances: Importance[]; fxPairSymbols: string[] | null } {
  const limits = planLimitsFor(plan);
  const allowed = stored.importances.filter((level) => limits.notification_importances.includes(level));
  const importances = allowed.length > 0 ? allowed : [...limits.notification_importances];

  const max = limits.notification_fx_pairs_max;
  let fxPairSymbols: string[] | null;
  if (max === null) {
    fxPairSymbols = stored.fxPairSymbols === null ? null : [...stored.fxPairSymbols];
  } else if (stored.fxPairSymbols === null) {
    fxPairSymbols = [FREE_DEFAULT_NOTIFICATION_FX_PAIR];
  } else {
    fxPairSymbols = stored.fxPairSymbols.slice(0, max);
  }
  return { importances, fxPairSymbols };
}

/** GET /indicators/{id}/comparison `history_limit` (api-design.md §21). */
export interface HistoryLimit {
  /** Past releases actually used for stats/events (= min(released, max_for_plan)). */
  applied: number;
  max_for_plan: number;
  pro_max: number;
}

export function historyLimitFor(plan: Plan, usedCount: number): HistoryLimit {
  return {
    applied: usedCount,
    max_for_plan: planLimitsFor(plan).history_events_max,
    pro_max: PLAN_LIMITS.PRO.history_events_max,
  };
}

/**
 * Restricts an inclusive PostgREST row range to the first `cap` rows.
 * null = the page lies entirely past the cap (nothing to fetch).
 */
export function capRowRange(range: { from: number; to: number }, cap: number): { from: number; to: number } | null {
  if (range.from >= cap) return null;
  return { from: range.from, to: Math.min(range.to, cap - 1) };
}
