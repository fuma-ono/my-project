import { attributionForOrganization, inboxSourceNote, type Attribution } from './attribution.js';
import {
  buildUpcomingNotifications,
  formatIsoSeconds,
  DEFAULT_NOTIFICATION_TIME_ZONE,
  type NotificationCandidate,
  type NotificationPreferences,
  type NotificationWindow,
  type UpcomingNotificationItem,
} from './notifications.js';

/**
 * アプリ内の通知一覧 (notification-inbox-spec.md §6, api-design.md §24.9).
 * GET /notifications materializes the notifications GET /notifications/upcoming
 * would have scheduled (same settings, plan limits, lead minutes, quiet hours)
 * once their notify_at has passed, into `notification_inbox`. Everything here
 * is pure; the repository only reads/writes rows.
 */

export const NOTIFICATION_INBOX_KINDS = ['INDICATOR', 'SPEECH', 'RATE_ALERT', 'CALENDAR_UPDATE', 'SYSTEM'] as const;
export type NotificationInboxKind = (typeof NOTIFICATION_INBOX_KINDS)[number];

/** 保存期間 (notification-inbox-spec.md §1): expires_at = notify_at + this. */
export const NOTIFICATION_RETENTION_DAYS: Readonly<Record<NotificationInboxKind, number>> = {
  INDICATOR: 30,
  SPEECH: 30,
  RATE_ALERT: 7,
  CALENDAR_UPDATE: 7,
  SYSTEM: 30,
};

/** Statuses an inbox notification may come from. An event notified 5
 * minutes before release is usually RELEASED / DELIVERED by the time the
 * inbox is opened; only CANCELLED never notifies. */
export const INBOX_CANDIDATE_STATUSES = ['SCHEDULED', 'RELEASED', 'DELIVERED'] as const;

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;

export const AT_RELEASE_TRIGGER = 'AT_RELEASE';
const LEAD_TRIGGER_PATTERN = /^LEAD_(\d+)$/;

export function expiresAtFor(kind: NotificationInboxKind, notifyAt: Date): Date {
  return new Date(notifyAt.getTime() + NOTIFICATION_RETENTION_DAYS[kind] * DAY_MS);
}

/** 通知の種類: 0 → "AT_RELEASE"、N → "LEAD_N" (発表のN分前). */
export function triggerForLeadMinutes(leadMinutes: number): string {
  return leadMinutes === 0 ? AT_RELEASE_TRIGGER : `LEAD_${leadMinutes}`;
}

/** Inverse of triggerForLeadMinutes; null for triggers without a lead (SYSTEM etc.). */
export function leadMinutesFromTrigger(trigger: string): number | null {
  if (trigger === AT_RELEASE_TRIGGER) return 0;
  const match = LEAD_TRIGGER_PATTERN.exec(trigger);
  return match ? Number(match[1]) : null;
}

/** Same as the table's unique (user_id, kind, target_id, trigger): one row
 * per event and notification type — LEAD_5 and AT_RELEASE are separate. */
export function inboxDedupKey(row: { user_id: string; kind: string; target_id: string; trigger: string }): string {
  return [row.user_id, row.kind, row.target_id, row.trigger].join('|');
}

/**
 * Candidate range for materialization at `now`: notify_at must be within
 * the INDICATOR/SPEECH retention (older ones would already be expired) and
 * not before `notBefore` — the user's settings row's updated_at. Without
 * that bound, a new user (or one who just changed the lead time, which
 * makes a new trigger) would get up to 30 days of notifications they were
 * never set up to receive. `to` = now + lead so that scheduled_at <= to
 * covers every notify_at <= now.
 */
export function resolveInboxMaterializationWindow(
  now: Date,
  leadMinutes: number,
  notBefore: Date | null,
): NotificationWindow {
  const retentionMs = Math.max(NOTIFICATION_RETENTION_DAYS.INDICATOR, NOTIFICATION_RETENTION_DAYS.SPEECH) * DAY_MS;
  let fromMs = now.getTime() - retentionMs;
  if (notBefore && !Number.isNaN(notBefore.getTime())) {
    fromMs = Math.min(Math.max(fromMs, notBefore.getTime()), now.getTime());
  }
  return { from: new Date(fromMs), to: new Date(now.getTime() + leadMinutes * MINUTE_MS) };
}

/** A row to insert into notification_inbox (id / read_at / created_at are DB-side). */
export interface NotificationInboxInsert {
  user_id: string;
  kind: NotificationInboxKind;
  target_id: string;
  trigger: string;
  title: string;
  body: string;
  display_name: string | null;
  speaker_name: string | null;
  /** null for RATE_ALERT (not tied to a country). */
  country_code: string | null;
  importance: string;
  /** null for RATE_ALERT (no event time). */
  scheduled_at: string | null;
  notify_at: string;
  expires_at: string;
}

export const IMPORTANCE_LABELS: Readonly<Record<string, string>> = { HIGH: '高', MEDIUM: '中', LOW: '低' };

const dateTimeFormatters = new Map<string, Intl.DateTimeFormat>();

function createDateTimeFormatter(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hourCycle: 'h23',
  });
}

/** "M/d H:mm" in `timeZone` (unknown zone → Asia/Tokyo). */
export function formatMonthDayTime(instant: Date, timeZone: string): string {
  let formatter = dateTimeFormatters.get(timeZone);
  if (!formatter) {
    try {
      formatter = createDateTimeFormatter(timeZone || DEFAULT_NOTIFICATION_TIME_ZONE);
    } catch {
      formatter = createDateTimeFormatter(DEFAULT_NOTIFICATION_TIME_ZONE);
    }
    dateTimeFormatters.set(timeZone, formatter);
  }
  const parts = formatter.formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === type)?.value ?? '';
  return `${part('month')}/${part('day')} ${Number(part('hour')) % 24}:${part('minute')}`;
}

/**
 * 本文: the same wording the iOS app uses for its local notifications
 * (NotificationsStore): 「発表の5分前です（10/16 8:30発表・重要度 高）」,
 * 「まもなく発言です（…発言・重要度 中）」.
 */
export function inboxBody(
  item: Pick<UpcomingNotificationItem, 'kind' | 'scheduled_at' | 'importance'> &
    Partial<Pick<UpcomingNotificationItem, 'attribution'>>,
  leadMinutes: number,
  timeZone: string,
): string {
  const noun = item.kind === 'SPEECH' ? '発言' : '発表';
  const timing = leadMinutes === 0 ? `まもなく${noun}です` : `${noun}の${leadMinutes}分前です`;
  const level = IMPORTANCE_LABELS[item.importance] ?? item.importance;
  const when = formatMonthDayTime(new Date(item.scheduled_at), timeZone);
  return `${timing}（${when}${noun}・重要度 ${level}）${inboxSourceNote(item.attribution) ?? ''}`;
}

/**
 * The rows GET /notifications inserts at `now`: the upcoming-notification
 * rules (buildUpcomingNotifications) over `window`, with RELEASED /
 * DELIVERED candidates allowed and no 60-item cap, kept only when
 * notify_at <= now and expires_at > now.
 */
export function selectInboxDeliveries(
  userId: string,
  prefs: NotificationPreferences,
  candidates: readonly NotificationCandidate[],
  window: NotificationWindow,
  now: Date,
): NotificationInboxInsert[] {
  const nowMs = now.getTime();
  const trigger = triggerForLeadMinutes(prefs.leadMinutes);
  return buildUpcomingNotifications(prefs, candidates, window, { statuses: INBOX_CANDIDATE_STATUSES, limit: null })
    .filter((item) => new Date(item.notify_at).getTime() <= nowMs)
    .map((item) => {
      const notifyAt = new Date(item.notify_at);
      return {
        user_id: userId,
        kind: item.kind,
        target_id: item.id,
        trigger,
        title: item.title,
        body: inboxBody(item, prefs.leadMinutes, prefs.timeZone),
        display_name: item.display_name,
        speaker_name: item.speaker_name,
        country_code: item.country_code,
        importance: item.importance,
        scheduled_at: item.scheduled_at,
        notify_at: item.notify_at,
        expires_at: formatIsoSeconds(expiresAtFor(item.kind, notifyAt)),
      };
    })
    .filter((row) => new Date(row.expires_at).getTime() > nowMs);
}

/** A notification_inbox row as read from the DB. */
export interface NotificationInboxRow {
  id: string;
  kind: NotificationInboxKind;
  target_id: string;
  trigger: string;
  title: string;
  body: string | null;
  display_name: string | null;
  speaker_name: string | null;
  country_code: string | null;
  importance: string | null;
  scheduled_at: string | null;
  notify_at: string;
  read_at: string | null;
  expires_at: string;
}

export interface NotificationInboxItem extends NotificationInboxRow {
  lead_minutes: number | null;
  /**
   * 出典と告知(api-design v1.39)。SPEECH と、要人発言の CALENDAR_UPDATE: 要人の機関(ECB・FRB)から。
   * それ以外(INDICATOR・RATE_ALERT・SYSTEM 等)・発言が見つからない(変更の記録が保存期間を過ぎて消えた等): null。
   */
  attribution: Attribution | null;
  /**
   * 開く要人発言の id(api-design v1.40、HQ判断 2026-10-28「告知API」)。SPEECH: target_id と同じ。要人発言の
   * CALENDAR_UPDATE(日時の変更・中止): 変更の記録から引いた発言の id(中止の発言はカレンダーから消えるので、
   * 中止の通知から詳細 GET /speeches/{id} を開くため)。それ以外・見つからない: null。
   */
  speech_id: string | null;
}

/**
 * 通知一覧の行の、出典を決める要人発言の id(api-design v1.39)。SPEECH は target_id がその発言。
 * CALENDAR_UPDATE は target_id が event_schedule_changes の id なので、`speechIdOfChange` で発言に引く
 * (speaker_name が null の行は経済指標の変更なので対象外)。それ以外は null。
 */
export function inboxAttributionSpeechId(
  row: Pick<NotificationInboxRow, 'kind' | 'target_id' | 'speaker_name'>,
  speechIdOfChange: ReadonlyMap<string, string>,
): string | null {
  if (row.kind === 'SPEECH') return row.target_id;
  if (row.kind === 'CALENDAR_UPDATE' && row.speaker_name !== null) return speechIdOfChange.get(row.target_id) ?? null;
  return null;
}

function isoOrNull(value: string | null): string | null {
  return value === null ? null : formatIsoSeconds(new Date(value));
}

/** How resolveInboxAttributions reads the DB (each one query per 100 ids — repositories). */
export interface InboxAttributionLookups {
  /** event_schedule_changes.id (SPEECH) → speech id. */
  speechIdsOfChanges(changeIds: readonly string[]): Promise<ReadonlyMap<string, string>>;
  /** speech id → speakers.organization. */
  organizationsOfSpeeches(speechIds: readonly string[]): Promise<ReadonlyMap<string, string>>;
}

/**
 * 通知一覧の行ごとの要人発言の id と出典(api-design v1.39・v1.40)。行の数によらず、各 lookup を最大1回だけ呼ぶ
 * (N+1 にしない)。対象の行が無ければ DB を読まない。
 */
export async function resolveInboxAttributions(
  rows: readonly NotificationInboxRow[],
  lookups: InboxAttributionLookups,
): Promise<{ speech_id: string | null; attribution: Attribution | null }[]> {
  const changeIds = rows
    .filter((row) => row.kind === 'CALENDAR_UPDATE' && row.speaker_name !== null)
    .map((row) => row.target_id);
  const speechIdOfChange =
    changeIds.length > 0 ? await lookups.speechIdsOfChanges(changeIds) : new Map<string, string>();
  const speechIds = rows.map((row) => inboxAttributionSpeechId(row, speechIdOfChange));
  const wanted = [...new Set(speechIds.filter((id): id is string => id !== null))];
  const organizations = wanted.length > 0 ? await lookups.organizationsOfSpeeches(wanted) : new Map<string, string>();
  return speechIds.map((id) => ({
    speech_id: id,
    attribution: id === null ? null : attributionForOrganization(organizations.get(id)),
  }));
}

/** API shape (api-design.md §24.9): timestamps as second-precision UTC. */
export function toInboxItem(
  row: NotificationInboxRow,
  link: { speech_id: string | null; attribution: Attribution | null } = { speech_id: null, attribution: null },
): NotificationInboxItem {
  return {
    id: row.id,
    kind: row.kind,
    target_id: row.target_id,
    trigger: row.trigger,
    lead_minutes: leadMinutesFromTrigger(row.trigger),
    title: row.title,
    body: row.body,
    display_name: row.display_name,
    speaker_name: row.speaker_name,
    country_code: row.country_code,
    importance: row.importance,
    scheduled_at: isoOrNull(row.scheduled_at),
    notify_at: formatIsoSeconds(new Date(row.notify_at)),
    read_at: isoOrNull(row.read_at),
    expires_at: formatIsoSeconds(new Date(row.expires_at)),
    attribution: link.attribution,
    speech_id: link.speech_id,
  };
}
