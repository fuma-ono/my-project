/**
 * HQ判断 2026-10-27(案B): 暫定(is_provisional)の予定は、発表前の通知(GET /notifications/upcoming・
 * 通知一覧)に出さない。確定(false)になったら出す。カレンダー更新(日時の変更・取りやめ)には今までどおり出す。
 * 確定の作業の漏れは、品質レポート第10章で見つける。
 */
import { describe, expect, it } from 'vitest';
import { candidateKey, selectCalendarUpdateDeliveries } from '../../src/domain/calendarUpdates.js';
import { selectInboxDeliveries } from '../../src/domain/notificationInbox.js';
import {
  buildUpcomingNotifications,
  type IndicatorNotificationCandidate,
  type NotificationPreferences,
} from '../../src/domain/notifications.js';
import { renderProvisionalEventsMarkdown } from '../../src/ingestion/quality/report.js';

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

function fomc(overrides: Partial<IndicatorNotificationCandidate> = {}): IndicatorNotificationCandidate {
  return {
    kind: 'INDICATOR',
    id: 'fomc-1209',
    title: 'FOMC政策金利',
    display_name: 'FOMC政策金利',
    importance: 'HIGH',
    status: 'SCHEDULED',
    scheduled_at: '2026-12-09T19:00:00Z',
    release_datetime_precision: 'EXACT',
    country_code: 'US',
    currency_code: 'USD',
    related_fx_pairs: ['USDJPY', 'EURUSD'],
    ...overrides,
  };
}
const cpi = fomc({ id: 'cpi-1210', title: 'CPI', scheduled_at: '2026-12-10T13:30:00Z' }); // 確定(is_provisional なし)

const window = { from: new Date('2026-12-03T00:00:00Z'), to: new Date('2026-12-10T00:00:00Z') };
const ids = (items: { id: string }[]) => items.map((item) => item.id);

describe('provisional events and pre-release notifications', () => {
  it('leaves a provisional event out of GET /notifications/upcoming', () => {
    expect(ids(buildUpcomingNotifications(prefs, [fomc({ is_provisional: true })], window))).toEqual([]);
  });

  it('includes it once it is confirmed (is_provisional false) — the next refresh schedules it', () => {
    expect(ids(buildUpcomingNotifications(prefs, [fomc({ is_provisional: false })], window))).toEqual(['fomc-1209']);
  });

  it('does not change confirmed events (no is_provisional field = as before)', () => {
    const wide = { from: window.from, to: new Date('2026-12-11T00:00:00Z') };
    expect(ids(buildUpcomingNotifications(prefs, [fomc({ is_provisional: true }), cpi], wide))).toEqual(['cpi-1210']);
  });

  it('never puts a provisional event in the in-app inbox either', () => {
    const now = new Date('2026-12-09T19:30:00Z');
    const inboxWindow = { from: new Date('2026-12-01T00:00:00Z'), to: new Date('2026-12-09T19:35:00Z') };
    expect(selectInboxDeliveries('user-1', prefs, [fomc({ is_provisional: true })], inboxWindow, now)).toEqual([]);
    expect(
      selectInboxDeliveries('user-1', prefs, [fomc({ is_provisional: false })], inboxWindow, now).map(
        (row) => row.target_id,
      ),
    ).toEqual(['fomc-1209']);
  });

  it('still lists a schedule change of a provisional event as a CALENDAR_UPDATE', () => {
    const candidate = fomc({ is_provisional: true });
    const rows = selectCalendarUpdateDeliveries(
      'user-1',
      prefs,
      [
        {
          id: 'change-1',
          kind: 'INDICATOR',
          target_id: candidate.id,
          change_type: 'RESCHEDULED',
          old_datetime: '2026-12-09T19:00:00Z',
          new_datetime: '2026-12-10T19:00:00Z',
          changed_at: '2026-12-01T00:00:00Z',
        },
      ],
      new Map([[candidateKey('INDICATOR', candidate.id), candidate]]),
      { from: new Date('2026-11-30T00:00:00Z'), to: new Date('2026-12-02T00:00:00Z') },
      new Date('2026-12-02T00:00:00Z'),
    );
    expect(rows.map((row) => row.trigger)).toEqual(['RESCHEDULED']);
  });
});

describe('quality report chapter 10 (provisional events)', () => {
  const now = new Date('2026-12-03T00:00:00Z');

  it('warns when a provisional event is within 7 days (it will not be notified)', () => {
    const md = renderProvisionalEventsMarkdown(
      [
        {
          provider_event_id: 'fomc_schedule:2026-12-09',
          indicator_code: 'US_FOMC',
          release_datetime: '2026-12-09T19:00:00Z',
        },
        {
          provider_event_id: 'fomc_minutes_schedule:2026-12-09',
          indicator_code: 'US_FOMC_MINUTES',
          release_datetime: '2026-12-30T19:00:00Z',
        },
      ],
      now,
    );
    expect(md).toContain('## 10. 暫定の予定');
    expect(md).toContain('判定: 注意(7日以内に暫定 1 件)');
    expect(md).toContain('fomc_schedule:2026-12-09');
    expect(md).toContain('注意(通知が出ない)');
  });

  it('is normal when there is no provisional event', () => {
    expect(renderProvisionalEventsMarkdown([], now)).toContain('判定: 正常(暫定の予定なし)');
  });
});
