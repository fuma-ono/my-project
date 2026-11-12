import { speakerDisplayName } from './homeSpeeches.js';
import {
  expiresAtFor,
  formatMonthDayTime,
  IMPORTANCE_LABELS,
  NOTIFICATION_RETENTION_DAYS,
  type NotificationInboxInsert,
} from './notificationInbox.js';
import {
  formatIsoSeconds,
  isNotificationEligible,
  type NotificationCandidate,
  type NotificationPreferences,
} from './notifications.js';

/**
 * カレンダー更新 (notification-inbox-spec.md §8, api-design.md §24.9 v1.27).
 * event_schedule_changes rows (written by DB triggers when a scheduled
 * release / speech is moved or cancelled) become CALENDAR_UPDATE inbox
 * rows for users who would be notified about that event. Pure; the
 * repository fetches the changes and the events.
 */

export const SCHEDULE_CHANGE_TYPES = ['RESCHEDULED', 'CANCELLED'] as const;
export type ScheduleChangeType = (typeof SCHEDULE_CHANGE_TYPES)[number];

export interface ScheduleChangeRow {
  id: string;
  kind: 'INDICATOR' | 'SPEECH';
  target_id: string;
  change_type: ScheduleChangeType;
  old_datetime: string;
  new_datetime: string | null;
  changed_at: string;
}

/** Any status: a cancelled event is exactly what a CANCELLED change is about. */
const CALENDAR_UPDATE_STATUSES = ['SCHEDULED', 'RELEASED', 'DELIVERED', 'CANCELLED'] as const;

const DAY_MS = 86_400_000;

/** Key of a candidate / change target: "INDICATOR|<id>" / "SPEECH|<id>". */
export function candidateKey(kind: 'INDICATOR' | 'SPEECH', id: string): string {
  return `${kind}|${id}`;
}

/** Country label used in front of an indicator's display_name (表示名に国名は入らないため). */
const COUNTRY_LABELS: Readonly<Record<string, string>> = {
  US: '米国',
  JP: '日本',
  EU: 'ユーロ圏',
  GB: '英国',
  AU: '豪州',
  NZ: 'ニュージーランド',
  CA: 'カナダ',
  CH: 'スイス',
  CN: '中国',
  DE: 'ドイツ',
};

/**
 * What the change is about: indicators 「日本の消費者物価指数（CPI）」
 * (country + display_name; without a display_name the formal name, which
 * already carries the country, e.g. 「米国CPI(消費者物価指数)」), speeches
 * 「パウエルFRB理事」 (speakerDisplayName, like GET /home speeches).
 */
export function calendarUpdateSubject(candidate: NotificationCandidate): string {
  if (candidate.kind === 'INDICATOR') {
    const displayName = candidate.display_name?.trim();
    if (!displayName) return candidate.title;
    const country = COUNTRY_LABELS[candidate.country_code] ?? candidate.country_code;
    return `${country}の${displayName}`;
  }
  return candidate.speaker_title
    ? speakerDisplayName(candidate.speaker_name, candidate.speaker_title)
    : candidate.speaker_name;
}

function noun(kind: 'INDICATOR' | 'SPEECH'): string {
  return kind === 'SPEECH' ? '発言' : '発表';
}

/** 「日本の消費者物価指数（CPI）の発表日時が変更されました」 / 「…の発表が中止されました」 (SPEECH: 発言). */
export function calendarUpdateTitle(candidate: NotificationCandidate, changeType: ScheduleChangeType): string {
  const subject = calendarUpdateSubject(candidate);
  const what = noun(candidate.kind);
  return changeType === 'CANCELLED' ? `${subject}の${what}が中止されました` : `${subject}の${what}日時が変更されました`;
}

/**
 * 「発表日時 10/16 8:30 → 10/17 21:30（重要度 高）」 /
 * 「10/16 8:30の発表は行われません（重要度 高）」. Times as M/d H:mm in
 * `timeZone` (formatMonthDayTime, the same as the other inbox bodies).
 */
export function calendarUpdateBody(
  change: Pick<ScheduleChangeRow, 'kind' | 'change_type' | 'old_datetime' | 'new_datetime'>,
  importance: string,
  timeZone: string,
): string {
  const what = noun(change.kind);
  const level = IMPORTANCE_LABELS[importance] ?? importance;
  const oldText = formatMonthDayTime(new Date(change.old_datetime), timeZone);
  if (change.change_type === 'CANCELLED' || change.new_datetime === null) {
    return `${oldText}の${what}は行われません（重要度 ${level}）`;
  }
  const newText = formatMonthDayTime(new Date(change.new_datetime), timeZone);
  return `${what}日時 ${oldText} → ${newText}（重要度 ${level}）`;
}

/**
 * Range of changed_at GET /notifications looks at: the CALENDAR_UPDATE
 * retention (7 days) and never before `notBefore` (user_settings.updated_at,
 * the same backfill floor as the other inbox rows).
 */
export function resolveCalendarUpdateWindow(now: Date, notBefore: Date | null): { from: Date; to: Date } {
  let fromMs = now.getTime() - NOTIFICATION_RETENTION_DAYS.CALENDAR_UPDATE * DAY_MS;
  if (notBefore && !Number.isNaN(notBefore.getTime())) {
    fromMs = Math.min(Math.max(fromMs, notBefore.getTime()), now.getTime());
  }
  return { from: new Date(fromMs), to: now };
}

/**
 * CALENDAR_UPDATE rows for `userId` at `now`: each change in `window`
 * whose event (in `candidates`, keyed by candidateKey) passes the same
 * settings rules as GET /notifications/upcoming — push, per-kind switch,
 * EXACT release time for indicators, importance and fx_pairs, all with the
 * plan's limits already applied to `prefs`. Lead minutes and quiet hours
 * don't apply (a change is not "N minutes before" anything).
 *
 * target_id = the change id, trigger = change_type, notify_at = changed_at,
 * scheduled_at = new datetime (old when cancelled), importance = the
 * event's current importance.
 */
export function selectCalendarUpdateDeliveries(
  userId: string,
  prefs: NotificationPreferences,
  changes: readonly ScheduleChangeRow[],
  candidates: ReadonlyMap<string, NotificationCandidate>,
  window: { from: Date; to: Date },
  now: Date,
): NotificationInboxInsert[] {
  if (!prefs.push) return [];
  const fromMs = window.from.getTime();
  const toMs = window.to.getTime();
  const rows: NotificationInboxInsert[] = [];
  for (const change of changes) {
    const changedAt = new Date(change.changed_at);
    const changedAtMs = changedAt.getTime();
    if (Number.isNaN(changedAtMs) || changedAtMs < fromMs || changedAtMs > toMs) continue;
    const candidate = candidates.get(candidateKey(change.kind, change.target_id));
    if (!candidate) continue;
    if (!isNotificationEligible(candidate, prefs, CALENDAR_UPDATE_STATUSES)) continue;

    const expiresAt = expiresAtFor('CALENDAR_UPDATE', changedAt);
    if (expiresAt.getTime() <= now.getTime()) continue;
    const scheduledAt =
      change.change_type === 'CANCELLED' ? change.old_datetime : (change.new_datetime ?? change.old_datetime);
    rows.push({
      user_id: userId,
      kind: 'CALENDAR_UPDATE',
      target_id: change.id,
      trigger: change.change_type,
      title: calendarUpdateTitle(candidate, change.change_type),
      body: calendarUpdateBody(change, candidate.importance, prefs.timeZone),
      display_name: candidate.kind === 'INDICATOR' ? (candidate.display_name ?? null) : null,
      speaker_name: candidate.kind === 'SPEECH' ? candidate.speaker_name : null,
      country_code: candidate.country_code,
      importance: candidate.importance,
      scheduled_at: formatIsoSeconds(new Date(scheduledAt)),
      notify_at: formatIsoSeconds(changedAt),
      expires_at: formatIsoSeconds(expiresAt),
    });
  }
  return rows;
}
