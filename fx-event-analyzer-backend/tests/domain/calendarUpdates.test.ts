import { ECB_ATTRIBUTION, FRB_ATTRIBUTION } from '../../src/domain/attribution.js';
import { describe, expect, it } from 'vitest';
import {
  calendarUpdateBody,
  calendarUpdateSubject,
  calendarUpdateTitle,
  candidateKey,
  resolveCalendarUpdateWindow,
  selectCalendarUpdateDeliveries,
  type ScheduleChangeRow,
} from '../../src/domain/calendarUpdates.js';
import type {
  IndicatorNotificationCandidate,
  NotificationCandidate,
  NotificationPreferences,
  SpeechNotificationCandidate,
} from '../../src/domain/notifications.js';

const USER_ID = '00000000-0000-0000-0000-0000000000aa';
const now = new Date('2026-10-15T12:00:00Z');

const prefs: NotificationPreferences = {
  push: true,
  indicators: true,
  speeches: true,
  fxPairSymbols: null,
  importances: ['HIGH', 'MEDIUM'],
  leadMinutes: 5,
  // Quiet hours never apply to calendar updates.
  quietHours: { enabled: true, start: '00:00', end: '23:59' },
  timeZone: 'Asia/Tokyo',
};

function indicator(overrides: Partial<IndicatorNotificationCandidate> = {}): IndicatorNotificationCandidate {
  return {
    kind: 'INDICATOR',
    id: 'e0000000-0000-0000-0000-000000000001',
    title: '日本CPI(消費者物価指数)',
    display_name: '消費者物価指数（CPI）',
    importance: 'HIGH',
    status: 'SCHEDULED',
    scheduled_at: '2026-10-16T23:30:00Z',
    release_datetime_precision: 'EXACT',
    country_code: 'JP',
    currency_code: 'JPY',
    related_fx_pairs: ['USDJPY', 'EURJPY'],
    ...overrides,
  };
}

function speech(overrides: Partial<SpeechNotificationCandidate> = {}): SpeechNotificationCandidate {
  return {
    kind: 'SPEECH',
    id: 's0000000-0000-0000-0000-000000000001',
    title: '経済見通しに関する講演',
    speaker_name: 'ジェローム・パウエル',
    speaker_title: 'FRB理事',
    importance: 'MEDIUM',
    status: 'CANCELLED',
    scheduled_at: '2026-10-16T16:00:00Z',
    country_code: 'US',
    currency_code: 'USD',
    related_fx_pairs: ['USDJPY', 'EURUSD'],
    ...overrides,
  };
}

function change(overrides: Partial<ScheduleChangeRow> = {}): ScheduleChangeRow {
  return {
    id: 'c0000000-0000-0000-0000-000000000001',
    kind: 'INDICATOR',
    target_id: 'e0000000-0000-0000-0000-000000000001',
    change_type: 'RESCHEDULED',
    old_datetime: '2026-10-15T23:30:00+00:00',
    new_datetime: '2026-10-16T23:30:00+00:00',
    changed_at: '2026-10-15T10:00:00.250+00:00',
    ...overrides,
  };
}

function byKey(...candidates: NotificationCandidate[]): Map<string, NotificationCandidate> {
  return new Map(candidates.map((candidate) => [candidateKey(candidate.kind, candidate.id), candidate]));
}

const window = resolveCalendarUpdateWindow(now, null);

describe('subject / title / body', () => {
  it('indicators: country + display_name; without one, the formal name', () => {
    expect(calendarUpdateSubject(indicator())).toBe('日本の消費者物価指数（CPI）');
    expect(calendarUpdateSubject(indicator({ country_code: 'US' }))).toBe('米国の消費者物価指数（CPI）');
    expect(calendarUpdateSubject(indicator({ display_name: null, title: '米国CPI(消費者物価指数)' }))).toBe(
      '米国CPI(消費者物価指数)',
    );
  });

  it('speeches: family name + title (like GET /home), or the full name without a title', () => {
    expect(calendarUpdateSubject(speech())).toBe('パウエルFRB理事');
    expect(calendarUpdateSubject(speech({ speaker_title: undefined }))).toBe('ジェローム・パウエル');
  });

  it('titles', () => {
    expect(calendarUpdateTitle(indicator(), 'RESCHEDULED')).toBe(
      '日本の消費者物価指数（CPI）の発表日時が変更されました',
    );
    expect(calendarUpdateTitle(indicator(), 'CANCELLED')).toBe('日本の消費者物価指数（CPI）の発表が中止されました');
    expect(calendarUpdateTitle(speech(), 'RESCHEDULED')).toBe('パウエルFRB理事の発言日時が変更されました');
    expect(calendarUpdateTitle(speech(), 'CANCELLED')).toBe('パウエルFRB理事の発言が中止されました');
  });

  it('bodies: old → new (or the cancelled time) in the display timezone, with the importance', () => {
    expect(calendarUpdateBody(change(), 'HIGH', 'Asia/Tokyo')).toBe('発表日時 10/16 8:30 → 10/17 8:30（重要度 高）');
    expect(calendarUpdateBody(change(), 'HIGH', 'UTC')).toBe('発表日時 10/15 23:30 → 10/16 23:30（重要度 高）');
    expect(
      calendarUpdateBody(
        change({ kind: 'SPEECH', change_type: 'CANCELLED', old_datetime: '2026-10-16T16:00:00Z', new_datetime: null }),
        'MEDIUM',
        'Asia/Tokyo',
      ),
    ).toBe('10/17 1:00の発言は行われません（重要度 中）');
  });

  it('bodies: （出典：ECB） only for an ECB speech (HQ判断 2026-10-28); FRB and indicators unchanged', () => {
    const cancelled = change({
      kind: 'SPEECH',
      change_type: 'CANCELLED',
      old_datetime: '2026-10-16T16:00:00Z',
      new_datetime: null,
    });
    expect(calendarUpdateBody(cancelled, 'MEDIUM', 'Asia/Tokyo', ECB_ATTRIBUTION)).toBe(
      '10/17 1:00の発言は行われません（重要度 中）（出典：ECB）',
    );
    expect(calendarUpdateBody(cancelled, 'MEDIUM', 'Asia/Tokyo', FRB_ATTRIBUTION)).toBe(
      '10/17 1:00の発言は行われません（重要度 中）',
    );
    expect(calendarUpdateBody(change(), 'HIGH', 'Asia/Tokyo', null)).toBe(
      '発表日時 10/16 8:30 → 10/17 8:30（重要度 高）',
    );
  });
});

describe('resolveCalendarUpdateWindow', () => {
  it('is the 7-day retention, not before the settings were saved', () => {
    expect(resolveCalendarUpdateWindow(now, null)).toEqual({ from: new Date('2026-10-08T12:00:00Z'), to: now });
    expect(resolveCalendarUpdateWindow(now, new Date('2026-10-14T00:00:00Z')).from).toEqual(
      new Date('2026-10-14T00:00:00Z'),
    );
    expect(resolveCalendarUpdateWindow(now, new Date('2026-01-01T00:00:00Z')).from).toEqual(
      new Date('2026-10-08T12:00:00Z'),
    );
  });
});

describe('selectCalendarUpdateDeliveries', () => {
  it('builds one CALENDAR_UPDATE row per change of a notifiable event', () => {
    const cancelled = change({
      id: 'c0000000-0000-0000-0000-000000000002',
      kind: 'SPEECH',
      target_id: speech().id,
      change_type: 'CANCELLED',
      old_datetime: '2026-10-16T16:00:00Z',
      new_datetime: null,
      changed_at: '2026-10-15T11:00:00Z',
    });
    const rows = selectCalendarUpdateDeliveries(
      USER_ID,
      prefs,
      [change(), cancelled],
      byKey(indicator(), speech()),
      window,
      now,
    );
    expect(rows).toEqual([
      {
        user_id: USER_ID,
        kind: 'CALENDAR_UPDATE',
        target_id: 'c0000000-0000-0000-0000-000000000001',
        trigger: 'RESCHEDULED',
        title: '日本の消費者物価指数（CPI）の発表日時が変更されました',
        body: '発表日時 10/16 8:30 → 10/17 8:30（重要度 高）',
        display_name: '消費者物価指数（CPI）',
        speaker_name: null,
        country_code: 'JP',
        importance: 'HIGH',
        scheduled_at: '2026-10-16T23:30:00Z',
        notify_at: '2026-10-15T10:00:00Z',
        expires_at: '2026-10-22T10:00:00Z',
      },
      {
        user_id: USER_ID,
        kind: 'CALENDAR_UPDATE',
        target_id: 'c0000000-0000-0000-0000-000000000002',
        trigger: 'CANCELLED',
        title: 'パウエルFRB理事の発言が中止されました',
        body: '10/17 1:00の発言は行われません（重要度 中）',
        display_name: null,
        speaker_name: 'ジェローム・パウエル',
        country_code: 'US',
        importance: 'MEDIUM',
        scheduled_at: '2026-10-16T16:00:00Z',
        notify_at: '2026-10-15T11:00:00Z',
        expires_at: '2026-10-22T11:00:00Z',
      },
    ]);
  });

  it('applies the upcoming-notification settings rules', () => {
    const candidates = byKey(indicator());
    const select = (overrides: Partial<NotificationPreferences>, candidateMap = candidates) =>
      selectCalendarUpdateDeliveries(USER_ID, { ...prefs, ...overrides }, [change()], candidateMap, window, now);

    expect(select({})).toHaveLength(1);
    expect(select({ push: false })).toEqual([]);
    expect(select({ indicators: false })).toEqual([]);
    expect(select({ importances: ['MEDIUM'] })).toEqual([]);
    expect(select({ fxPairSymbols: ['EURUSD'] })).toEqual([]);
    expect(select({ fxPairSymbols: ['EURJPY'] })).toHaveLength(1);
    expect(select({}, byKey(indicator({ release_datetime_precision: 'DATE_ONLY' })))).toEqual([]);
    // Event gone (deleted) → nothing.
    expect(select({}, new Map())).toEqual([]);
  });

  it('only takes changes inside the window (retention and the settings floor)', () => {
    const candidates = byKey(indicator());
    const old = change({ changed_at: '2026-10-08T11:59:59Z' });
    const beforeSettings = change({ changed_at: '2026-10-14T23:00:00Z' });
    expect(selectCalendarUpdateDeliveries(USER_ID, prefs, [old], candidates, window, now)).toEqual([]);
    const floored = resolveCalendarUpdateWindow(now, new Date('2026-10-15T00:00:00Z'));
    expect(selectCalendarUpdateDeliveries(USER_ID, prefs, [beforeSettings], candidates, floored, now)).toEqual([]);
    expect(selectCalendarUpdateDeliveries(USER_ID, prefs, [change()], candidates, floored, now)).toHaveLength(1);
  });
});
