/**
 * サーバーからのプッシュ通知の判定(HQ指示 2026-11-10「プッシュ通知バックエンド実装」、push-notifications-spec.md)。
 */
import { describe, expect, it } from 'vitest';
import type {
  IndicatorNotificationCandidate,
  NotificationPreferences,
  SpeechNotificationCandidate,
} from '../../src/domain/notifications.js';
import {
  decidePushSend,
  formatLocalDateTime,
  MAX_DELIVERY_ATTEMPTS,
  matchesFavoriteCurrency,
  planPreReleasePushes,
  planReleasedPushes,
  nextTargetState,
  resolveNotificationState,
  type PushTarget,
  type PushNotificationRow,
  type PushUserContext,
} from '../../src/domain/pushNotifications.js';

const NOW = new Date('2026-11-12T12:00:00Z');

const prefs: NotificationPreferences = {
  push: true,
  indicators: true,
  speeches: true,
  fxPairSymbols: null,
  importances: ['HIGH', 'MEDIUM'],
  leadMinutes: 5,
  quietHours: { enabled: false, start: '23:00', end: '07:00' },
  timeZone: 'Asia/Tokyo',
};

const ctx = (over: Partial<PushUserContext> = {}, p: Partial<NotificationPreferences> = {}): PushUserContext => ({
  userId: 'user-1',
  prefs: { ...prefs, ...p },
  favoriteCurrencies: [],
  language: 'ja',
  ...over,
});

function indicator(over: Partial<IndicatorNotificationCandidate> = {}): IndicatorNotificationCandidate {
  return {
    kind: 'INDICATOR',
    id: 'ev-cpi',
    title: '米国CPI(消費者物価指数)',
    display_name: '消費者物価指数（CPI）',
    importance: 'HIGH',
    status: 'SCHEDULED',
    scheduled_at: '2026-11-12T13:30:00Z',
    release_datetime_precision: 'EXACT',
    country_code: 'US',
    currency_code: 'USD',
    related_fx_pairs: ['USDJPY', 'EURUSD'],
    result_type: 'VALUE',
    ...over,
  };
}

function speech(over: Partial<SpeechNotificationCandidate> = {}): SpeechNotificationCandidate {
  return {
    kind: 'SPEECH',
    id: 'sp-1',
    title: '経済見通しに関する講演',
    speaker_name: 'ジェローム・パウエル',
    importance: 'HIGH',
    status: 'SCHEDULED',
    scheduled_at: '2026-11-12T15:00:00Z',
    country_code: 'US',
    currency_code: 'USD',
    related_fx_pairs: ['USDJPY'],
    ...over,
  };
}

describe('planPreReleasePushes — extraction by the saved notification settings', () => {
  it('an indicator and a speech: lead minutes, send time, expiry, dedupe key fields and Japanese text in the user time zone', () => {
    const items = planPreReleasePushes(ctx(), [indicator(), speech()], NOW);
    expect(items).toEqual([
      expect.objectContaining({
        user_id: 'user-1',
        push_type: 'PRE_RELEASE',
        target_kind: 'INDICATOR',
        target_id: 'ev-cpi',
        event_scheduled_at: '2026-11-12T13:30:00.000Z',
        scheduled_send_at: '2026-11-12T13:25:00.000Z', // 5分前
        expires_at: '2026-11-12T13:32:00.000Z', // 発表の2分後まで
        reason: 'SETTINGS',
        title: '消費者物価指数（CPI）(US)',
        body: '11/12 22:30 に発表予定です(5分前のお知らせ)', // Asia/Tokyo
      }),
      expect.objectContaining({
        target_kind: 'SPEECH',
        scheduled_send_at: '2026-11-12T14:55:00.000Z',
        title: 'ジェローム・パウエル',
        body: '「経済見通しに関する講演」は 11/13 00:00 から',
      }),
    ]);
  });

  it('the body follows the user time zone (America/New_York) and lead 0 = at the release time', () => {
    const [item] = planPreReleasePushes(ctx({}, { timeZone: 'America/New_York', leadMinutes: 0 }), [indicator()], NOW);
    expect(item).toMatchObject({ scheduled_send_at: '2026-11-12T13:30:00.000Z', body: '発表の時刻です(11/12 08:30)' });
    expect(formatLocalDateTime(new Date('2026-07-01T12:30:00Z'), 'America/New_York')).toBe('7/1 08:30'); // 夏時間
    expect(formatLocalDateTime(new Date('2026-07-01T12:30:00Z'), 'Not/AZone')).toBe('7/1 21:30'); // 不明 → Asia/Tokyo
  });

  it('applies the switches: push OFF, indicators OFF, speeches OFF, importance, FX pairs', () => {
    expect(planPreReleasePushes(ctx({}, { push: false }), [indicator(), speech()], NOW)).toEqual([]);
    expect(
      planPreReleasePushes(ctx({}, { indicators: false }), [indicator(), speech()], NOW).map((i) => i.target_kind),
    ).toEqual(['SPEECH']);
    expect(
      planPreReleasePushes(ctx({}, { speeches: false }), [indicator(), speech()], NOW).map((i) => i.target_kind),
    ).toEqual(['INDICATOR']);
    expect(planPreReleasePushes(ctx({}, { importances: ['MEDIUM'] }), [indicator()], NOW)).toEqual([]);
    expect(planPreReleasePushes(ctx({}, { fxPairSymbols: ['GBPJPY'] }), [indicator()], NOW)).toEqual([]);
    expect(planPreReleasePushes(ctx({}, { fxPairSymbols: ['EURUSD'] }), [indicator()], NOW)).toHaveLength(1);
  });

  it('never notifies cancelled / released / provisional / not-exact-time events, nor ones whose send time has passed', () => {
    const items = planPreReleasePushes(
      ctx(),
      [
        indicator({ id: 'cancelled', status: 'CANCELLED' }),
        indicator({ id: 'released', status: 'RELEASED' }),
        indicator({ id: 'provisional', is_provisional: true }),
        indicator({ id: 'approx', release_datetime_precision: 'APPROXIMATE' }),
        indicator({ id: 'past', scheduled_at: '2026-11-12T11:00:00Z' }),
        indicator({ id: 'ok' }),
      ],
      NOW,
    );
    expect(items.map((i) => i.target_id)).toEqual(['ok']);
  });

  it('quiet hours (in the user time zone) suppress the pre-release push', () => {
    // 22:25 JST に送る予定 → 22:00〜07:00 は通知しない
    const quiet = { enabled: true, start: '22:00', end: '07:00' };
    expect(planPreReleasePushes(ctx({}, { quietHours: quiet }), [indicator()], NOW)).toEqual([]);
    expect(
      planPreReleasePushes(ctx({}, { quietHours: quiet, timeZone: 'Europe/London' }), [indicator()], NOW),
    ).toHaveLength(1);
  });

  it('favorite currency: HIGH events of that currency even outside the FX pair filter, never twice for the same event', () => {
    const jp = indicator({ id: 'ev-jp', country_code: 'JP', currency_code: 'JPY', related_fx_pairs: ['USDJPY'] });
    const jpMedium = indicator({
      id: 'ev-jp-m',
      importance: 'MEDIUM',
      currency_code: 'JPY',
      related_fx_pairs: ['USDJPY'],
    });
    const c = ctx({ favoriteCurrencies: ['JPY'] }, { fxPairSymbols: ['EURUSD'] });
    const items = planPreReleasePushes(c, [indicator(), jp, jpMedium], NOW);
    expect(items.map((i) => [i.target_id, i.reason])).toEqual([
      ['ev-cpi', 'SETTINGS'], // EURUSD に関係(設定どおり)
      ['ev-jp', 'FAVORITE_CURRENCY'], // 設定では外れるが、お気に入り通貨の HIGH
    ]);
    // 設定でも合うイベントは SETTINGS の1件だけ
    const both = planPreReleasePushes(ctx({ favoriteCurrencies: ['USD'] }), [indicator()], NOW);
    expect(both.map((i) => i.reason)).toEqual(['SETTINGS']);
    expect(matchesFavoriteCurrency(indicator(), ['JPY'])).toBe(false); // 通貨ペアの片方だけでは合わない
  });

  it('favorite currencies still respect push OFF and the per-kind switch', () => {
    const jp = indicator({ id: 'ev-jp', currency_code: 'JPY' });
    expect(planPreReleasePushes(ctx({ favoriteCurrencies: ['JPY'] }, { push: false }), [jp], NOW)).toEqual([]);
    expect(planPreReleasePushes(ctx({ favoriteCurrencies: ['JPY'] }, { indicators: false }), [jp], NOW)).toEqual([]);
  });
});

describe('planReleasedPushes — result and speech publication', () => {
  const released = indicator({ status: 'RELEASED', scheduled_at: '2026-11-12T11:30:00Z' });

  it('notifies a released indicator and a delivered speech within 6 hours, with no values in the text', () => {
    const items = planReleasedPushes(
      ctx(),
      [released, speech({ status: 'DELIVERED', scheduled_at: '2026-11-12T10:00:00Z' })],
      NOW,
    );
    expect(items).toEqual([
      expect.objectContaining({
        push_type: 'RELEASED',
        scheduled_send_at: NOW.toISOString(),
        body: '結果が発表されました。アプリで確認できます',
        expires_at: '2026-11-12T17:30:00.000Z',
      }),
      expect.objectContaining({ push_type: 'SPEECH_DELIVERED', body: '「経済見通しに関する講演」が公開されました' }),
    ]);
  });

  it('skips old releases (late backfill), scheduled / cancelled ones, quiet hours, and the FOMC minutes wording', () => {
    expect(
      planReleasedPushes(ctx(), [indicator({ status: 'RELEASED', scheduled_at: '2026-11-12T05:00:00Z' })], NOW),
    ).toEqual([]);
    expect(
      planReleasedPushes(ctx(), [indicator({ status: 'SCHEDULED', scheduled_at: '2026-11-12T11:30:00Z' })], NOW),
    ).toEqual([]);
    expect(
      planReleasedPushes(ctx(), [indicator({ status: 'CANCELLED', scheduled_at: '2026-11-12T11:30:00Z' })], NOW),
    ).toEqual([]);
    expect(
      planReleasedPushes(ctx({}, { quietHours: { enabled: true, start: '20:00', end: '23:00' } }), [released], NOW),
    ).toEqual([]); // 今 21:00 JST
    const [minutes] = planReleasedPushes(
      ctx(),
      [indicator({ status: 'RELEASED', scheduled_at: '2026-11-12T11:30:00Z', result_type: 'NONE' })],
      NOW,
    );
    expect(minutes!.body).toBe('公表されました。アプリで内容を確認できます');
  });
});

function row(over: Partial<PushNotificationRow> = {}): PushNotificationRow {
  return {
    id: 'n-1',
    user_id: 'user-1',
    push_type: 'PRE_RELEASE',
    target_kind: 'INDICATOR',
    target_id: 'ev-cpi',
    event_scheduled_at: '2026-11-12T13:30:00.000Z',
    reason: 'SETTINGS',
    scheduled_send_at: '2026-11-12T13:25:00.000Z',
    expires_at: '2026-11-12T13:32:00.000Z',
    title: 't',
    body: 'b',
    payload: {},
    status: 'SENDING',
    attempts: 0,
    next_attempt_at: '2026-11-12T13:25:00.000Z',
    ...over,
  };
}

describe('decidePushSend — the check right before sending', () => {
  const at = new Date('2026-11-12T13:25:10Z');
  it('sends when the event is unchanged and the settings still want it', () => {
    expect(decidePushSend(row(), indicator(), ctx(), at)).toEqual({ action: 'SEND' });
  });
  it('cancelled / rescheduled / already released / provisional / missing → CANCEL', () => {
    expect(decidePushSend(row(), indicator({ status: 'CANCELLED' }), ctx(), at)).toEqual({
      action: 'CANCEL',
      reason: 'TARGET_CANCELLED',
    });
    expect(decidePushSend(row(), indicator({ scheduled_at: '2026-11-13T13:30:00Z' }), ctx(), at)).toEqual({
      action: 'CANCEL',
      reason: 'RESCHEDULED',
    });
    expect(decidePushSend(row(), indicator({ status: 'RELEASED' }), ctx(), at)).toEqual({
      action: 'CANCEL',
      reason: 'ALREADY_RELEASED',
    });
    expect(decidePushSend(row(), indicator({ is_provisional: true }), ctx(), at)).toEqual({
      action: 'CANCEL',
      reason: 'PROVISIONAL',
    });
    expect(decidePushSend(row(), null, ctx(), at)).toEqual({ action: 'CANCEL', reason: 'TARGET_NOT_FOUND' });
  });
  it('settings changed after enqueue (push OFF, importance, favorite removed) → CANCEL SETTINGS_CHANGED', () => {
    expect(decidePushSend(row(), indicator(), ctx({}, { push: false }), at)).toEqual({
      action: 'CANCEL',
      reason: 'SETTINGS_CHANGED',
    });
    expect(decidePushSend(row(), indicator(), ctx({}, { importances: ['LOW'] }), at)).toEqual({
      action: 'CANCEL',
      reason: 'SETTINGS_CHANGED',
    });
    const fav = row({ reason: 'FAVORITE_CURRENCY' });
    expect(decidePushSend(fav, indicator(), ctx({ favoriteCurrencies: ['USD'] }), at)).toEqual({ action: 'SEND' });
    expect(decidePushSend(fav, indicator(), ctx({ favoriteCurrencies: [] }), at)).toEqual({
      action: 'CANCEL',
      reason: 'SETTINGS_CHANGED',
    });
    expect(decidePushSend(row(), indicator(), null, at)).toEqual({ action: 'CANCEL', reason: 'SETTINGS_CHANGED' });
  });
  it('past the expiry → SKIP EXPIRED; quiet hours now → SKIP QUIET_HOURS', () => {
    expect(decidePushSend(row(), indicator(), ctx(), new Date('2026-11-12T13:32:00Z'))).toEqual({
      action: 'SKIP',
      reason: 'EXPIRED',
    });
    expect(
      decidePushSend(row(), indicator(), ctx({}, { quietHours: { enabled: true, start: '22:00', end: '23:00' } }), at),
    ).toEqual({ action: 'SKIP', reason: 'QUIET_HOURS' });
  });
  it('RELEASED rows need the event still RELEASED', () => {
    const released = row({ push_type: 'RELEASED', expires_at: '2026-11-12T19:30:00.000Z' });
    expect(decidePushSend(released, indicator({ status: 'RELEASED' }), ctx(), at)).toEqual({ action: 'SEND' });
    expect(decidePushSend(released, indicator({ status: 'SCHEDULED' }), ctx(), at)).toEqual({
      action: 'CANCEL',
      reason: 'STATUS_CHANGED',
    });
  });
});

describe('per-device state and the notification state (multi-device, partial failure)', () => {
  const expires = '2026-11-12T14:00:00.000Z';
  const t = new Date('2026-11-12T13:00:00Z');
  const target = (device_id: string, over: Partial<PushTarget> = {}): PushTarget => ({
    device_id,
    status: 'PENDING',
    status_reason: null,
    attempts: 0,
    ...over,
  });

  it('nextTargetState: success sticks, permanent / invalid are final, retryable retries until the limit, CONFIG_ERROR changes nothing', () => {
    expect(nextTargetState(target('a'), 'SUCCESS')).toMatchObject({ status: 'SUCCESS', attempts: 1 });
    expect(nextTargetState(target('a', { status: 'SUCCESS', attempts: 1 }), 'RETRYABLE_ERROR')).toMatchObject({
      status: 'SUCCESS',
    });
    expect(nextTargetState(target('a'), 'PERMANENT_ERROR')).toMatchObject({
      status: 'FAILED',
      status_reason: 'PERMANENT_ERROR',
    });
    expect(nextTargetState(target('a'), 'INVALID_TOKEN')).toMatchObject({
      status: 'FAILED',
      status_reason: 'INVALID_TOKEN',
    });
    expect(nextTargetState(target('a', { attempts: 3 }), 'RETRYABLE_ERROR')).toMatchObject({
      status: 'RETRY',
      attempts: 4,
    });
    expect(nextTargetState(target('a', { attempts: MAX_DELIVERY_ATTEMPTS - 1 }), 'RETRYABLE_ERROR')).toMatchObject({
      status: 'FAILED',
      status_reason: 'MAX_ATTEMPTS',
      attempts: MAX_DELIVERY_ATTEMPTS,
    });
    expect(nextTargetState(target('a', { status: 'RETRY', attempts: 2 }), 'CONFIG_ERROR')).toEqual(
      target('a', { status: 'RETRY', attempts: 2 }),
    );
  });

  it('all success → SENT; success + retry → PENDING (one success does not stop the other device); success + final failure → PARTIAL_FAILURE', () => {
    expect(
      resolveNotificationState([target('a', { status: 'SUCCESS' }), target('b', { status: 'SUCCESS' })], 1, t, expires),
    ).toMatchObject({
      status: 'SENT',
    });
    expect(
      resolveNotificationState([target('a', { status: 'SUCCESS' }), target('b', { status: 'RETRY' })], 1, t, expires),
    ).toEqual({
      status: 'PENDING',
      status_reason: 'RETRY',
      next_attempt_at: '2026-11-12T13:01:00.000Z',
      expire_open_targets: false,
    });
    expect(
      resolveNotificationState(
        [target('a', { status: 'SUCCESS' }), target('b', { status: 'FAILED', status_reason: 'PERMANENT_ERROR' })],
        1,
        t,
        expires,
      ),
    ).toMatchObject({ status: 'PARTIAL_FAILURE', status_reason: 'PERMANENT_ERROR' });
  });

  it('all failed → FAILED with the reason; removed devices do not count as failures; nothing left → SKIPPED', () => {
    const invalid = { status: 'FAILED' as const, status_reason: 'INVALID_TOKEN' };
    expect(resolveNotificationState([target('a', invalid), target('b', invalid)], 1, t, expires)).toMatchObject({
      status: 'FAILED',
      status_reason: 'ALL_TOKENS_INVALID',
    });
    expect(
      resolveNotificationState(
        [target('a', { status: 'FAILED', status_reason: 'MAX_ATTEMPTS' }), target('b', invalid)],
        5,
        t,
        expires,
      ),
    ).toMatchObject({ status: 'FAILED', status_reason: 'MAX_ATTEMPTS' });
    const removed = { status: 'CANCELLED' as const, status_reason: 'DEVICE_REMOVED' };
    expect(
      resolveNotificationState([target('a', { status: 'SUCCESS' }), target('b', removed)], 2, t, expires),
    ).toMatchObject({
      status: 'SENT',
    });
    expect(resolveNotificationState([target('a', removed)], 2, t, expires)).toMatchObject({
      status: 'SKIPPED',
      status_reason: 'ALL_DEVICES_REMOVED',
    });
    expect(resolveNotificationState([], 1, t, expires)).toMatchObject({
      status: 'SKIPPED',
      status_reason: 'NO_DEVICE',
    });
  });

  it('back-off 1, 2, 5, 10 minutes by round; if the next round would pass the expiry the open devices expire and the state is final', () => {
    const open = [target('a', { status: 'RETRY' })];
    expect(resolveNotificationState(open, 2, t, expires).next_attempt_at).toBe('2026-11-12T13:02:00.000Z');
    expect(resolveNotificationState(open, 3, t, expires).next_attempt_at).toBe('2026-11-12T13:05:00.000Z');
    expect(resolveNotificationState(open, 4, t, expires).next_attempt_at).toBe('2026-11-12T13:10:00.000Z');
    const soon = '2026-11-12T13:00:30.000Z';
    expect(resolveNotificationState(open, 1, t, soon)).toEqual({
      status: 'FAILED',
      status_reason: 'EXPIRED_BEFORE_RETRY',
      next_attempt_at: null,
      expire_open_targets: true,
    });
    expect(resolveNotificationState([target('s', { status: 'SUCCESS' }), ...open], 1, t, soon)).toMatchObject({
      status: 'PARTIAL_FAILURE',
      status_reason: 'EXPIRED_BEFORE_RETRY',
      expire_open_targets: true,
    });
  });
});
