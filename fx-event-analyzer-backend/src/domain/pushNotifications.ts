/**
 * サーバーからのプッシュ通知(APNs)— HQ指示 2026-11-10「プッシュ通知バックエンド実装」。
 * 設計: docs/projects/fx-event-analyzer/push-notifications-spec.md。表: migration 20261110000005。
 *
 * ここは DB にも APNs にも触れない計算だけ:
 *   - 何を・いつ送るか(planPreReleasePushes / planReleasedPushes)。通知設定の判定は GET /notifications/upcoming と
 *     同じ関数(domain/notifications.ts の buildUpcomingNotifications・isNotificationEligible)を使う
 *     (通知の ON/OFF、指標・発言の別、重要度、通貨ペア、通知のタイミング、通知しない時間帯、プランの上限は呼び出し側で
 *     prefs に反映済み、暫定の予定と時刻の決まっていない発表・発言は除く)。
 *   - 送る直前の確かめ(decidePushSend): 中止・延期・設定の変更・期限切れなら送らない。
 *   - 送った結果と再試行(resolveDeliveryResult)。
 */
import {
  buildUpcomingNotifications,
  isInQuietHours,
  isNotificationEligible,
  type NotificationCandidate,
  type NotificationPreferences,
  type UpcomingNotificationItem,
} from './notifications.js';

export const PUSH_TYPES = ['PRE_RELEASE', 'RELEASED', 'SPEECH_DELIVERED'] as const;
export type PushType = (typeof PUSH_TYPES)[number];
export type PushReason = 'SETTINGS' | 'FAVORITE_CURRENCY';
export type PushStatus = 'PENDING' | 'SENDING' | 'SENT' | 'FAILED' | 'CANCELLED' | 'SKIPPED';

const MINUTE_MS = 60_000;

/** 発表前の通知を、予約した発表の時刻からこの分だけ過ぎても送れなければ送らない。 */
export const PRE_RELEASE_GRACE_MINUTES = 2;
/** 結果の公表・発言の公開の通知は、その時刻からこの分を過ぎたら作らない・送らない(遅れて取り込んだ過去の発表を通知しない)。 */
export const RELEASED_MAX_AGE_MINUTES = 360;
/** 発表前の通知を、送る時刻のこの分前から予約する(取り出しのジョブの間隔より長く)。 */
export const PRE_RELEASE_HORIZON_MINUTES = 24 * 60;
/** 予約の時刻をこの分だけ過ぎていても、まだ予約する(予約のジョブの間隔の揺れ)。 */
export const ENQUEUE_LOOKBACK_MINUTES = 2;
/** 送信の試行の上限と、次の試行までの待ち(1回目の失敗の後 1分、2分、5分、10分)。 */
export const MAX_DELIVERY_ATTEMPTS = 5;
const RETRY_DELAYS_MS = [1, 2, 5, 10].map((m) => m * MINUTE_MS);

/** お気に入り通貨の通知: その通貨のイベントのうち、この重要度だけ。 */
export const FAVORITE_CURRENCY_IMPORTANCES = ['HIGH'] as const;

export interface PushPlanItem {
  user_id: string;
  push_type: PushType;
  target_kind: 'INDICATOR' | 'SPEECH';
  target_id: string;
  event_scheduled_at: string;
  reason: PushReason;
  scheduled_send_at: string;
  expires_at: string;
  title: string;
  body: string;
  payload: Record<string, unknown>;
}

export interface PushNotificationRow {
  id: string;
  user_id: string;
  push_type: PushType;
  target_kind: 'INDICATOR' | 'SPEECH';
  target_id: string;
  event_scheduled_at: string;
  reason: PushReason;
  scheduled_send_at: string;
  expires_at: string;
  title: string;
  body: string;
  payload: Record<string, unknown>;
  status: PushStatus;
  attempts: number;
  next_attempt_at: string;
}

export interface PushUserContext {
  userId: string;
  prefs: NotificationPreferences;
  /** お気に入り通貨(ISO 4217)。プランの上限(favorites_max)の分だけ。 */
  favoriteCurrencies: readonly string[];
  /** 'ja' / 'en'(display.language) */
  language: string;
}

const iso = (ms: number) => new Date(ms).toISOString();

/** 利用者の表示のタイムゾーンでの「M/D HH:MM」(不明なゾーンは Asia/Tokyo)。 */
export function formatLocalDateTime(instant: Date, timeZone: string): string {
  const format = (zone: string) =>
    new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(instant);
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = format(timeZone || 'Asia/Tokyo');
  } catch {
    parts = format('Asia/Tokyo');
  }
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('month')}/${get('day')} ${get('hour')}:${get('minute')}`;
}

interface MessageInput {
  kind: 'INDICATOR' | 'SPEECH';
  title: string;
  display_name: string | null;
  speaker_name: string | null;
  country_code: string;
  scheduled_at: string;
  result_type: string | null;
}

/** 通知の文面。値(実績・予想)は入れない(アプリで公式の値を見てもらう。未確認の値を通知に出さない)。 */
export function pushMessage(
  type: PushType,
  item: MessageInput,
  ctx: Pick<PushUserContext, 'language'> & { timeZone: string; leadMinutes: number },
): { title: string; body: string } {
  const en = ctx.language === 'en';
  const at = formatLocalDateTime(new Date(item.scheduled_at), ctx.timeZone);
  const name = item.kind === 'INDICATOR' ? (item.display_name ?? item.title) : (item.speaker_name ?? item.title);
  const title = item.kind === 'INDICATOR' ? `${name}(${item.country_code})` : name;
  const noValue = item.result_type === 'NONE';
  if (type === 'PRE_RELEASE') {
    if (item.kind === 'SPEECH') {
      const body = en
        ? `Speech "${item.title}" ${ctx.leadMinutes === 0 ? 'starts now' : `starts at ${at}`}`
        : `「${item.title}」${ctx.leadMinutes === 0 ? 'の発言が始まります' : `は ${at} から`}`;
      return { title, body };
    }
    const verb = noValue ? (en ? 'publication' : '公表') : en ? 'release' : '発表';
    const body = en
      ? ctx.leadMinutes === 0
        ? `Scheduled ${verb} time (${at})`
        : `${verb[0]!.toUpperCase()}${verb.slice(1)} at ${at} (in ${ctx.leadMinutes} min)`
      : ctx.leadMinutes === 0
        ? `${verb}の時刻です(${at})`
        : `${at} に${verb}予定です(${ctx.leadMinutes}分前のお知らせ)`;
    return { title, body };
  }
  if (type === 'RELEASED') {
    const body = noValue
      ? en
        ? 'Published. Open the app for details.'
        : '公表されました。アプリで内容を確認できます'
      : en
        ? 'The result is out. Open the app to see it.'
        : '結果が発表されました。アプリで確認できます';
    return { title, body };
  }
  return { title, body: en ? `"${item.title}" is now available` : `「${item.title}」が公開されました` };
}

function payloadFor(type: PushType, item: { kind: string; id: string; scheduled_at: string }, reason: PushReason) {
  return { type, target_kind: item.kind, target_id: item.id, scheduled_at: item.scheduled_at, reason };
}

/** お気に入り通貨のイベントか(そのイベント自身の通貨。通貨ペアの片方だけが合うものは入れない)。 */
export function matchesFavoriteCurrency(candidate: NotificationCandidate, favorites: readonly string[]): boolean {
  return favorites.includes(candidate.currency_code);
}

/** お気に入り通貨の通知の判定に使う設定(通貨ペアの絞り込みを外し、重要度を HIGH にする。ほかは利用者の設定のまま)。 */
function favoritePrefs(prefs: NotificationPreferences): NotificationPreferences {
  return { ...prefs, importances: FAVORITE_CURRENCY_IMPORTANCES, fxPairSymbols: null };
}

function toPreReleaseItem(ctx: PushUserContext, item: UpcomingNotificationItem, reason: PushReason): PushPlanItem {
  const scheduledMs = Date.parse(item.scheduled_at);
  const message = pushMessage(
    'PRE_RELEASE',
    {
      kind: item.kind,
      title: item.title,
      display_name: item.display_name,
      speaker_name: item.speaker_name,
      country_code: item.country_code,
      scheduled_at: item.scheduled_at,
      result_type: item.result_type,
    },
    { language: ctx.language, timeZone: ctx.prefs.timeZone, leadMinutes: ctx.prefs.leadMinutes },
  );
  return {
    user_id: ctx.userId,
    push_type: 'PRE_RELEASE',
    target_kind: item.kind,
    target_id: item.id,
    event_scheduled_at: iso(scheduledMs),
    reason,
    scheduled_send_at: iso(Date.parse(item.notify_at)),
    expires_at: iso(scheduledMs + PRE_RELEASE_GRACE_MINUTES * MINUTE_MS),
    ...message,
    payload: payloadFor('PRE_RELEASE', item, reason),
  };
}

/**
 * 発表前・発言前の通知の予約。候補は SCHEDULED のイベント・発言(listNotificationCandidates)。
 * SETTINGS: 通知設定に合うもの(GET /notifications/upcoming と同じ)。FAVORITE_CURRENCY: お気に入り通貨の HIGH のうち、
 * SETTINGS に入らなかったもの(同じイベントに2通は送らない)。
 */
export function planPreReleasePushes(
  ctx: PushUserContext,
  candidates: readonly NotificationCandidate[],
  now: Date,
  horizonMinutes = PRE_RELEASE_HORIZON_MINUTES,
): PushPlanItem[] {
  if (!ctx.prefs.push) return [];
  const window = {
    from: new Date(now.getTime() - ENQUEUE_LOOKBACK_MINUTES * MINUTE_MS),
    to: new Date(now.getTime() + horizonMinutes * MINUTE_MS),
  };
  const bySettings = buildUpcomingNotifications(ctx.prefs, candidates, window, { limit: null });
  const taken = new Set(bySettings.map((i) => `${i.kind}:${i.id}`));
  const items = bySettings.map((i) => toPreReleaseItem(ctx, i, 'SETTINGS'));
  if (ctx.favoriteCurrencies.length > 0) {
    const favorites = buildUpcomingNotifications(
      favoritePrefs(ctx.prefs),
      candidates.filter((c) => matchesFavoriteCurrency(c, ctx.favoriteCurrencies)),
      window,
      { limit: null },
    );
    for (const i of favorites) {
      if (!taken.has(`${i.kind}:${i.id}`)) items.push(toPreReleaseItem(ctx, i, 'FAVORITE_CURRENCY'));
    }
  }
  return items;
}

/** 結果の公表(INDICATOR、RELEASED)・発言の公開(SPEECH、DELIVERED)の通知に入るか。入るなら理由。 */
function releasedReason(ctx: PushUserContext, candidate: NotificationCandidate): PushReason | null {
  const status = candidate.kind === 'INDICATOR' ? 'RELEASED' : 'DELIVERED';
  if (isNotificationEligible(candidate, ctx.prefs, [status])) return 'SETTINGS';
  if (
    matchesFavoriteCurrency(candidate, ctx.favoriteCurrencies) &&
    isNotificationEligible(candidate, favoritePrefs(ctx.prefs), [status])
  ) {
    return 'FAVORITE_CURRENCY';
  }
  return null;
}

/**
 * 結果の公表・発言の公開の通知。候補は過去も含めた一覧(listNotificationCandidates の includePast)。
 * その時刻から RELEASED_MAX_AGE_MINUTES 以内のものだけ(遅れて取り込んだ古い発表は通知しない)。今が通知しない時間帯なら作らない。
 */
export function planReleasedPushes(
  ctx: PushUserContext,
  candidates: readonly NotificationCandidate[],
  now: Date,
): PushPlanItem[] {
  if (!ctx.prefs.push) return [];
  if (isInQuietHours(now, ctx.prefs.quietHours, ctx.prefs.timeZone)) return [];
  const items: PushPlanItem[] = [];
  for (const c of candidates) {
    const scheduledMs = Date.parse(c.scheduled_at);
    if (Number.isNaN(scheduledMs)) continue;
    if (scheduledMs > now.getTime() || now.getTime() - scheduledMs > RELEASED_MAX_AGE_MINUTES * MINUTE_MS) continue;
    const reason = releasedReason(ctx, c);
    if (!reason) continue;
    const type: PushType = c.kind === 'INDICATOR' ? 'RELEASED' : 'SPEECH_DELIVERED';
    const message = pushMessage(
      type,
      {
        kind: c.kind,
        title: c.title,
        display_name: c.kind === 'INDICATOR' ? (c.display_name ?? null) : null,
        speaker_name: c.kind === 'SPEECH' ? c.speaker_name : null,
        country_code: c.country_code,
        scheduled_at: c.scheduled_at,
        result_type: c.kind === 'INDICATOR' ? (c.result_type ?? 'VALUE') : null,
      },
      { language: ctx.language, timeZone: ctx.prefs.timeZone, leadMinutes: ctx.prefs.leadMinutes },
    );
    items.push({
      user_id: ctx.userId,
      push_type: type,
      target_kind: c.kind,
      target_id: c.id,
      event_scheduled_at: iso(scheduledMs),
      reason,
      scheduled_send_at: now.toISOString(),
      expires_at: iso(scheduledMs + RELEASED_MAX_AGE_MINUTES * MINUTE_MS),
      ...message,
      payload: payloadFor(type, c, reason),
    });
  }
  return items;
}

export type SendDecision =
  { action: 'SEND' } | { action: 'CANCEL'; reason: string } | { action: 'SKIP'; reason: string };

/**
 * 送る直前の確かめ。current = 今の候補(無ければ null)、ctx = 今の通知設定(取れなければ null)。
 * - 期限(expires_at)を過ぎた → SKIP EXPIRED
 * - 対象が無い・中止(CANCELLED)→ CANCEL TARGET_NOT_FOUND / TARGET_CANCELLED
 * - 時刻が予約のときと違う(延期・前倒し)→ CANCEL RESCHEDULED(新しい時刻の通知は次の予約で作られる)
 * - 発表前の通知で、もう SCHEDULED でない・暫定に戻った → CANCEL ALREADY_RELEASED / PROVISIONAL
 * - 今の設定では通知しない(OFF にした、重要度・通貨を外した、お気に入りから外した)→ CANCEL SETTINGS_CHANGED
 * - 今が通知しない時間帯 → SKIP QUIET_HOURS
 */
export function decidePushSend(
  row: PushNotificationRow,
  current: NotificationCandidate | null,
  ctx: PushUserContext | null,
  now: Date,
): SendDecision {
  if (now.getTime() >= Date.parse(row.expires_at)) return { action: 'SKIP', reason: 'EXPIRED' };
  if (!current) return { action: 'CANCEL', reason: 'TARGET_NOT_FOUND' };
  if (current.status === 'CANCELLED') return { action: 'CANCEL', reason: 'TARGET_CANCELLED' };
  if (Date.parse(current.scheduled_at) !== Date.parse(row.event_scheduled_at)) {
    return { action: 'CANCEL', reason: 'RESCHEDULED' };
  }
  if (row.push_type === 'PRE_RELEASE') {
    if (current.status !== 'SCHEDULED') return { action: 'CANCEL', reason: 'ALREADY_RELEASED' };
    if (current.kind === 'INDICATOR' && current.is_provisional === true) {
      return { action: 'CANCEL', reason: 'PROVISIONAL' };
    }
  } else {
    const expected = row.push_type === 'RELEASED' ? 'RELEASED' : 'DELIVERED';
    if (current.status !== expected) return { action: 'CANCEL', reason: 'STATUS_CHANGED' };
  }
  if (!ctx || !ctx.prefs.push) return { action: 'CANCEL', reason: 'SETTINGS_CHANGED' };
  const status =
    row.push_type === 'PRE_RELEASE' ? 'SCHEDULED' : current.kind === 'INDICATOR' ? 'RELEASED' : 'DELIVERED';
  const stillWanted =
    row.reason === 'SETTINGS'
      ? isNotificationEligible(current, ctx.prefs, [status])
      : matchesFavoriteCurrency(current, ctx.favoriteCurrencies) &&
        isNotificationEligible(current, favoritePrefs(ctx.prefs), [status]);
  if (!stillWanted) return { action: 'CANCEL', reason: 'SETTINGS_CHANGED' };
  if (isInQuietHours(now, ctx.prefs.quietHours, ctx.prefs.timeZone)) return { action: 'SKIP', reason: 'QUIET_HOURS' };
  return { action: 'SEND' };
}

/**
 * 端末1台への送信の結果。CONFIG_ERROR(APNs の鍵・設定の問題)は通知の失敗として数えず、送信のジョブがその回の送信を止める
 * (push/pushJobs.ts)。DB の記録にはこのほか IN_FLIGHT(送信中)・UNKNOWN(送信中に止まった — 届いたか分からない)がある。
 */
export type DeliveryOutcome = 'SUCCESS' | 'RETRYABLE_ERROR' | 'PERMANENT_ERROR' | 'INVALID_TOKEN' | 'CONFIG_ERROR';
export type RecordedOutcome = DeliveryOutcome | 'IN_FLIGHT' | 'UNKNOWN';

export interface DeliveryResult {
  status: 'SENT' | 'PENDING' | 'FAILED' | 'SKIPPED';
  status_reason: string | null;
  next_attempt_at: string | null;
}

/**
 * 端末ごとの結果から、通知の行の次の状態を決める。attempts = 今回を含めた試行の回数。
 * - 1台でも届いた → SENT(残りの端末の失敗は記録だけ)
 * - 端末が無い → SKIPPED NO_DEVICE
 * - 再試行できる失敗があり、回数が上限未満で、次の試行が期限より前 → PENDING(待ってから再試行)
 * - それ以外 → FAILED(理由: 最後の失敗の種類)
 */
export function resolveDeliveryResult(
  outcomes: readonly DeliveryOutcome[],
  attempts: number,
  now: Date,
  expiresAt: string,
): DeliveryResult {
  if (outcomes.length === 0) return { status: 'SKIPPED', status_reason: 'NO_DEVICE', next_attempt_at: null };
  if (outcomes.includes('SUCCESS')) return { status: 'SENT', status_reason: null, next_attempt_at: null };
  if (outcomes.includes('RETRYABLE_ERROR') && attempts < MAX_DELIVERY_ATTEMPTS) {
    const delay = RETRY_DELAYS_MS[Math.min(attempts - 1, RETRY_DELAYS_MS.length - 1)]!;
    const next = now.getTime() + delay;
    if (next < Date.parse(expiresAt)) {
      return { status: 'PENDING', status_reason: 'RETRY', next_attempt_at: iso(next) };
    }
    return { status: 'FAILED', status_reason: 'EXPIRED_BEFORE_RETRY', next_attempt_at: null };
  }
  const reason = outcomes.includes('RETRYABLE_ERROR')
    ? 'MAX_ATTEMPTS'
    : outcomes.every((o) => o === 'INVALID_TOKEN')
      ? 'ALL_TOKENS_INVALID'
      : 'PERMANENT_ERROR';
  return { status: 'FAILED', status_reason: reason, next_attempt_at: null };
}
