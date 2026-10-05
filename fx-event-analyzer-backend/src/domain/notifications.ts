import { ApiError } from '../errors/ApiError.js';
import type { Importance } from './importance.js';

/**
 * SCR-016 通知設定 v2 (HQ指示 2026-10-05): notifications are scheduled as
 * on-device local notifications by iOS from GET /notifications/upcoming
 * (api-design.md §24.6). Everything here is pure — the repository only
 * fetches candidates, this module decides what gets notified and when.
 */

/** 通知タイミング: 発表の何分前か (0 = 発表時). */
export const NOTIFICATION_LEAD_MINUTES = [0, 5, 10, 15, 30, 60] as const;
export type NotificationLeadMinutes = (typeof NOTIFICATION_LEAD_MINUTES)[number];

/** iOS keeps at most 64 pending local notifications per app; leave headroom. */
export const MAX_UPCOMING_NOTIFICATIONS = 60;
export const DEFAULT_UPCOMING_WINDOW_DAYS = 7;
export const MAX_UPCOMING_WINDOW_DAYS = 14;

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;

export interface NotificationPreferences {
  push: boolean;
  indicators: boolean;
  speeches: boolean;
  /** null = すべての通貨ペア */
  fxPairSymbols: readonly string[] | null;
  importances: readonly Importance[];
  leadMinutes: number;
}

interface CandidateBase {
  id: string;
  title: string;
  importance: string;
  status: string;
  scheduled_at: string;
  country_code: string;
  currency_code: string;
  related_fx_pairs: string[];
}

export interface IndicatorNotificationCandidate extends CandidateBase {
  kind: 'INDICATOR';
  release_datetime_precision: string;
}

export interface SpeechNotificationCandidate extends CandidateBase {
  kind: 'SPEECH';
  speaker_name: string;
}

export type NotificationCandidate = IndicatorNotificationCandidate | SpeechNotificationCandidate;

export interface UpcomingNotificationItem {
  kind: 'INDICATOR' | 'SPEECH';
  id: string;
  title: string;
  speaker_name: string | null;
  importance: string;
  scheduled_at: string;
  notify_at: string;
  country_code: string;
  currency_code: string;
  related_fx_pairs: string[];
}

export interface NotificationWindow {
  from: Date;
  to: Date;
}

/** ISO 8601 in UTC *without* fractional seconds — iOS decodes with
 * JSONDecoder's `.iso8601` strategy, which rejects `.000`. */
export function formatIsoSeconds(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Defaults: from = now, to = from + 7 days. Rejects to <= from and ranges
 * longer than 14 days with 422 (api-design.md §24.6).
 */
export function resolveUpcomingWindow(
  query: { from?: string | undefined; to?: string | undefined },
  now: Date,
): NotificationWindow {
  const from = query.from ? new Date(query.from) : now;
  const to = query.to ? new Date(query.to) : new Date(from.getTime() + DEFAULT_UPCOMING_WINDOW_DAYS * DAY_MS);

  if (to.getTime() <= from.getTime()) {
    throw ApiError.validation('to must be later than from.');
  }
  if (to.getTime() - from.getTime() > MAX_UPCOMING_WINDOW_DAYS * DAY_MS) {
    throw ApiError.validation(`The from/to range must be ${MAX_UPCOMING_WINDOW_DAYS} days or less.`);
  }
  return { from, to };
}

/** Pairs a speaker's currency moves: every pair whose base or quote is it. */
export function fxPairsForCurrency(
  currencyCode: string,
  fxPairs: readonly { symbol: string; base_currency: string; quote_currency: string }[],
): string[] {
  return fxPairs
    .filter((pair) => pair.base_currency === currencyCode || pair.quote_currency === currencyCode)
    .map((pair) => pair.symbol);
}

function isEligible(candidate: NotificationCandidate, prefs: NotificationPreferences): boolean {
  if (candidate.status !== 'SCHEDULED') return false;
  if (candidate.kind === 'INDICATOR') {
    if (!prefs.indicators) return false;
    // Only an exact release time can be notified "N minutes before".
    if (candidate.release_datetime_precision !== 'EXACT') return false;
  } else if (!prefs.speeches) {
    return false;
  }
  if (!(prefs.importances as readonly string[]).includes(candidate.importance)) return false;
  if (prefs.fxPairSymbols !== null) {
    const wanted = prefs.fxPairSymbols;
    if (!candidate.related_fx_pairs.some((symbol) => wanted.includes(symbol))) return false;
  }
  return true;
}

/**
 * Applies the user's notification settings to candidate events/speeches:
 * push off → nothing; per-kind switches; SCHEDULED only; indicators need
 * an EXACT release time; importance ∈ importances; fx_pairs (when set)
 * must intersect related_fx_pairs; notify_at >= from and scheduled_at <=
 * to. Sorted by notify_at ascending and capped at 60.
 */
export function buildUpcomingNotifications(
  prefs: NotificationPreferences,
  candidates: readonly NotificationCandidate[],
  window: NotificationWindow,
): UpcomingNotificationItem[] {
  if (!prefs.push) return [];

  const leadMs = prefs.leadMinutes * MINUTE_MS;
  const fromMs = window.from.getTime();
  const toMs = window.to.getTime();

  const items: Array<{ notifyAtMs: number; scheduledAtMs: number; item: UpcomingNotificationItem }> = [];
  for (const candidate of candidates) {
    if (!isEligible(candidate, prefs)) continue;

    const scheduledAtMs = new Date(candidate.scheduled_at).getTime();
    if (Number.isNaN(scheduledAtMs)) continue;
    const notifyAtMs = scheduledAtMs - leadMs;
    if (notifyAtMs < fromMs || scheduledAtMs > toMs) continue;

    items.push({
      notifyAtMs,
      scheduledAtMs,
      item: {
        kind: candidate.kind,
        id: candidate.id,
        title: candidate.title,
        speaker_name: candidate.kind === 'SPEECH' ? candidate.speaker_name : null,
        importance: candidate.importance,
        scheduled_at: formatIsoSeconds(new Date(scheduledAtMs)),
        notify_at: formatIsoSeconds(new Date(notifyAtMs)),
        country_code: candidate.country_code,
        currency_code: candidate.currency_code,
        related_fx_pairs: candidate.related_fx_pairs,
      },
    });
  }

  items.sort(
    (a, b) =>
      a.notifyAtMs - b.notifyAtMs ||
      a.scheduledAtMs - b.scheduledAtMs ||
      a.item.kind.localeCompare(b.item.kind) ||
      a.item.id.localeCompare(b.item.id),
  );
  return items.slice(0, MAX_UPCOMING_NOTIFICATIONS).map((entry) => entry.item);
}
