import { ECB_ATTRIBUTION, FRB_ATTRIBUTION } from '../../src/domain/attribution.js';
import { describe, expect, it } from 'vitest';
import {
  AT_RELEASE_TRIGGER,
  expiresAtFor,
  formatMonthDayTime,
  inboxBody,
  inboxDedupKey,
  leadMinutesFromTrigger,
  NOTIFICATION_INBOX_KINDS,
  NOTIFICATION_RETENTION_DAYS,
  resolveInboxMaterializationWindow,
  selectInboxDeliveries,
  inboxAttributionSpeechId,
  resolveInboxAttributions,
  toInboxItem,
  triggerForLeadMinutes,
  type NotificationInboxRow,
} from '../../src/domain/notificationInbox.js';
import {
  buildUpcomingNotifications,
  type IndicatorNotificationCandidate,
  type NotificationPreferences,
  type SpeechNotificationCandidate,
} from '../../src/domain/notifications.js';

const USER_ID = '00000000-0000-0000-0000-0000000000aa';
const now = new Date('2026-10-13T12:00:00Z');

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

function indicator(overrides: Partial<IndicatorNotificationCandidate> = {}): IndicatorNotificationCandidate {
  return {
    kind: 'INDICATOR',
    id: 'event-1',
    title: '日本CPI(消費者物価指数)',
    display_name: '消費者物価指数（CPI）',
    importance: 'HIGH',
    status: 'SCHEDULED',
    scheduled_at: '2026-10-13T11:30:00Z',
    release_datetime_precision: 'EXACT',
    country_code: 'JP',
    currency_code: 'JPY',
    related_fx_pairs: ['USDJPY'],
    ...overrides,
  };
}

function speech(overrides: Partial<SpeechNotificationCandidate> = {}): SpeechNotificationCandidate {
  return {
    kind: 'SPEECH',
    id: 'speech-1',
    title: '金融経済懇談会での講演',
    speaker_name: '植田和男',
    importance: 'MEDIUM',
    status: 'SCHEDULED',
    scheduled_at: '2026-10-13T12:03:00Z',
    country_code: 'JP',
    currency_code: 'JPY',
    related_fx_pairs: ['USDJPY'],
    ...overrides,
  };
}

describe('retention', () => {
  it('keeps INDICATOR / SPEECH / SYSTEM 30 days and RATE_ALERT / CALENDAR_UPDATE 7 days', () => {
    expect(NOTIFICATION_RETENTION_DAYS).toEqual({
      INDICATOR: 30,
      SPEECH: 30,
      RATE_ALERT: 7,
      CALENDAR_UPDATE: 7,
      SYSTEM: 30,
    });
    expect(Object.keys(NOTIFICATION_RETENTION_DAYS).sort()).toEqual([...NOTIFICATION_INBOX_KINDS].sort());
  });

  it('expires_at = notify_at + retention', () => {
    const notifyAt = new Date('2026-10-13T11:25:00Z');
    expect(expiresAtFor('INDICATOR', notifyAt).toISOString()).toBe('2026-11-12T11:25:00.000Z');
    expect(expiresAtFor('SPEECH', notifyAt).toISOString()).toBe('2026-11-12T11:25:00.000Z');
    expect(expiresAtFor('SYSTEM', notifyAt).toISOString()).toBe('2026-11-12T11:25:00.000Z');
    expect(expiresAtFor('RATE_ALERT', notifyAt).toISOString()).toBe('2026-10-20T11:25:00.000Z');
    expect(expiresAtFor('CALENDAR_UPDATE', notifyAt).toISOString()).toBe('2026-10-20T11:25:00.000Z');
  });
});

describe('trigger naming', () => {
  it('names lead 0 AT_RELEASE and N minutes LEAD_N', () => {
    expect(triggerForLeadMinutes(0)).toBe(AT_RELEASE_TRIGGER);
    expect(triggerForLeadMinutes(0)).toBe('AT_RELEASE');
    expect(triggerForLeadMinutes(5)).toBe('LEAD_5');
    expect(triggerForLeadMinutes(60)).toBe('LEAD_60');
  });

  it('round-trips to lead_minutes, null for other triggers', () => {
    for (const lead of [0, 5, 10, 15, 30, 60]) {
      expect(leadMinutesFromTrigger(triggerForLeadMinutes(lead))).toBe(lead);
    }
    expect(leadMinutesFromTrigger('WELCOME')).toBeNull();
    expect(leadMinutesFromTrigger('LEAD_')).toBeNull();
  });
});

describe('inboxDedupKey', () => {
  const base = { user_id: USER_ID, kind: 'INDICATOR', target_id: 'event-1', trigger: 'LEAD_5' };

  it('is the same for the same user, event and notification type', () => {
    expect(inboxDedupKey(base)).toBe(inboxDedupKey({ ...base }));
  });

  it('differs for LEAD_5 vs AT_RELEASE, another kind, event or user', () => {
    const key = inboxDedupKey(base);
    expect(inboxDedupKey({ ...base, trigger: 'AT_RELEASE' })).not.toBe(key);
    expect(inboxDedupKey({ ...base, kind: 'SPEECH' })).not.toBe(key);
    expect(inboxDedupKey({ ...base, target_id: 'event-2' })).not.toBe(key);
    expect(inboxDedupKey({ ...base, user_id: 'someone-else' })).not.toBe(key);
  });
});

describe('resolveInboxMaterializationWindow', () => {
  it('goes back 30 days and forward by the lead time', () => {
    const window = resolveInboxMaterializationWindow(now, 5, null);
    expect(window.from.toISOString()).toBe('2026-09-13T12:00:00.000Z');
    expect(window.to.toISOString()).toBe('2026-10-13T12:05:00.000Z');
  });

  it('never goes back before the settings were last saved', () => {
    const window = resolveInboxMaterializationWindow(now, 0, new Date('2026-10-13T09:00:00Z'));
    expect(window.from.toISOString()).toBe('2026-10-13T09:00:00.000Z');
    expect(window.to.toISOString()).toBe('2026-10-13T12:00:00.000Z');
  });

  it('ignores a notBefore older than the retention, and clamps one in the future to now', () => {
    expect(resolveInboxMaterializationWindow(now, 5, new Date('2026-01-01T00:00:00Z')).from.toISOString()).toBe(
      '2026-09-13T12:00:00.000Z',
    );
    expect(resolveInboxMaterializationWindow(now, 5, new Date('2026-10-14T00:00:00Z')).from.toISOString()).toBe(
      now.toISOString(),
    );
  });
});

describe('inboxBody', () => {
  it('matches the iOS local-notification wording, in the display timezone', () => {
    expect(
      inboxBody({ kind: 'INDICATOR', scheduled_at: '2026-10-13T11:30:00Z', importance: 'HIGH' }, 5, 'Asia/Tokyo'),
    ).toBe('発表の5分前です（10/13 20:30発表・重要度 高）');
    expect(
      inboxBody({ kind: 'SPEECH', scheduled_at: '2026-10-15T23:05:00Z', importance: 'MEDIUM' }, 0, 'Asia/Tokyo'),
    ).toBe('まもなく発言です（10/16 8:05発言・重要度 中）');
  });

  it('falls back to Asia/Tokyo for an unknown zone', () => {
    expect(formatMonthDayTime(new Date('2026-10-13T15:00:00Z'), 'Not/AZone')).toBe('10/14 0:00');
    expect(formatMonthDayTime(new Date('2026-10-13T15:00:00Z'), 'UTC')).toBe('10/13 15:00');
  });
});

describe('selectInboxDeliveries', () => {
  const window = resolveInboxMaterializationWindow(now, prefs.leadMinutes, null);

  it('keeps candidates whose notify_at has passed, as inbox rows', () => {
    const rows = selectInboxDeliveries(USER_ID, prefs, [indicator(), speech()], window, now);
    expect(rows).toEqual([
      {
        user_id: USER_ID,
        kind: 'INDICATOR',
        target_id: 'event-1',
        trigger: 'LEAD_5',
        title: '日本CPI(消費者物価指数)',
        body: '発表の5分前です（10/13 20:30発表・重要度 高）',
        display_name: '消費者物価指数（CPI）',
        speaker_name: null,
        country_code: 'JP',
        importance: 'HIGH',
        scheduled_at: '2026-10-13T11:30:00Z',
        notify_at: '2026-10-13T11:25:00Z',
        expires_at: '2026-11-12T11:25:00Z',
      },
      {
        user_id: USER_ID,
        kind: 'SPEECH',
        target_id: 'speech-1',
        trigger: 'LEAD_5',
        title: '金融経済懇談会での講演',
        body: '発言の5分前です（10/13 21:03発言・重要度 中）',
        display_name: null,
        speaker_name: '植田和男',
        country_code: 'JP',
        importance: 'MEDIUM',
        scheduled_at: '2026-10-13T12:03:00Z',
        notify_at: '2026-10-13T11:58:00Z',
        expires_at: '2026-11-12T11:58:00Z',
      },
    ]);
  });

  it('includes notify_at == now but not later', () => {
    const exactlyNow = indicator({ id: 'now', scheduled_at: '2026-10-13T12:05:00Z' });
    const later = indicator({ id: 'later', scheduled_at: '2026-10-13T12:05:01Z' });
    expect(selectInboxDeliveries(USER_ID, prefs, [exactlyNow, later], window, now).map((row) => row.target_id)).toEqual(
      ['now'],
    );
  });

  it('keeps RELEASED / DELIVERED events but drops CANCELLED ones', () => {
    const rows = selectInboxDeliveries(
      USER_ID,
      prefs,
      [
        indicator({ status: 'RELEASED' }),
        speech({ status: 'DELIVERED' }),
        indicator({ id: 'gone', status: 'CANCELLED' }),
      ],
      window,
      now,
    );
    expect(rows.map((row) => row.target_id)).toEqual(['event-1', 'speech-1']);
  });

  it('applies the same settings as /notifications/upcoming', () => {
    const candidates = [
      indicator({ id: 'low', importance: 'LOW' }),
      indicator({ id: 'date-only', release_datetime_precision: 'DATE_ONLY' }),
      indicator({ id: 'eur', related_fx_pairs: ['EURUSD'] }),
      speech(),
    ];
    const rows = selectInboxDeliveries(
      USER_ID,
      { ...prefs, speeches: false, fxPairSymbols: ['USDJPY'] },
      candidates,
      window,
      now,
    );
    expect(rows).toEqual([]);
    expect(selectInboxDeliveries(USER_ID, { ...prefs, push: false }, [indicator()], window, now)).toEqual([]);
  });

  it('drops notifications in the quiet hours', () => {
    // 11:25Z = 20:25 JST.
    const quiet = { ...prefs, quietHours: { enabled: true, start: '20:00', end: '21:00' } };
    expect(selectInboxDeliveries(USER_ID, quiet, [indicator()], window, now)).toEqual([]);
  });

  it('uses AT_RELEASE for lead 0', () => {
    const atRelease = { ...prefs, leadMinutes: 0 };
    const rows = selectInboxDeliveries(
      USER_ID,
      atRelease,
      [indicator()],
      resolveInboxMaterializationWindow(now, 0, null),
      now,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ trigger: 'AT_RELEASE', notify_at: '2026-10-13T11:30:00Z' });
    expect(rows[0]!.body).toBe('まもなく発表です（10/13 20:30発表・重要度 高）');
  });

  it('skips notifications from before the window (already expired or before the settings were saved)', () => {
    const old = indicator({ id: 'old', scheduled_at: '2026-09-10T00:00:00Z' });
    expect(selectInboxDeliveries(USER_ID, prefs, [old], window, now)).toEqual([]);

    const sinceSaved = resolveInboxMaterializationWindow(now, 5, new Date('2026-10-13T11:40:00Z'));
    expect(
      selectInboxDeliveries(USER_ID, prefs, [indicator(), speech()], sinceSaved, now).map((r) => r.target_id),
    ).toEqual(['speech-1']);
  });

  it('is not capped at 60 like /notifications/upcoming', () => {
    const many = Array.from({ length: 70 }, (_, index) =>
      indicator({ id: `event-${index}`, scheduled_at: new Date(now.getTime() - (index + 1) * 60_000).toISOString() }),
    );
    expect(selectInboxDeliveries(USER_ID, prefs, many, window, now)).toHaveLength(70);
  });
});

describe('buildUpcomingNotifications defaults are unchanged', () => {
  it('still only notifies SCHEDULED candidates', () => {
    const window = { from: new Date('2026-10-13T00:00:00Z'), to: new Date('2026-10-14T00:00:00Z') };
    expect(buildUpcomingNotifications(prefs, [indicator({ status: 'RELEASED' })], window)).toEqual([]);
    expect(buildUpcomingNotifications(prefs, [indicator()], window)).toHaveLength(1);
  });
});

describe('toInboxItem', () => {
  const row: NotificationInboxRow = {
    id: 'row-1',
    kind: 'INDICATOR',
    target_id: 'event-1',
    trigger: 'LEAD_5',
    title: '日本CPI(消費者物価指数)',
    body: '発表の5分前です（10/13 20:30発表・重要度 高）',
    display_name: '消費者物価指数（CPI）',
    speaker_name: null,
    country_code: 'JP',
    importance: 'HIGH',
    scheduled_at: '2026-10-13T11:30:00+00:00',
    notify_at: '2026-10-13T11:25:00+00:00',
    read_at: '2026-10-13T11:40:12.345678+00:00',
    expires_at: '2026-11-12T11:25:00+00:00',
  };

  it('adds lead_minutes and formats timestamps as second-precision UTC', () => {
    expect(toInboxItem(row)).toEqual({
      ...row,
      lead_minutes: 5,
      scheduled_at: '2026-10-13T11:30:00Z',
      notify_at: '2026-10-13T11:25:00Z',
      read_at: '2026-10-13T11:40:12Z',
      expires_at: '2026-11-12T11:25:00Z',
      attribution: null,
    });
    expect(toInboxItem(row, ECB_ATTRIBUTION).attribution).toEqual(ECB_ATTRIBUTION);
  });

  it('keeps nulls (unread, no schedule, no lead)', () => {
    const item = toInboxItem({ ...row, kind: 'SYSTEM', trigger: 'WELCOME', scheduled_at: null, read_at: null });
    expect(item).toMatchObject({ lead_minutes: null, scheduled_at: null, read_at: null });
  });
});

describe('inboxAttributionSpeechId (api-design v1.39)', () => {
  const changes = new Map([['change-1', 'speech-9']]);
  it('SPEECH → its target; a speech CALENDAR_UPDATE → the changed speech; anything else → null', () => {
    expect(inboxAttributionSpeechId({ kind: 'SPEECH', target_id: 'speech-1', speaker_name: 'x' }, changes)).toBe(
      'speech-1',
    );
    expect(
      inboxAttributionSpeechId({ kind: 'CALENDAR_UPDATE', target_id: 'change-1', speaker_name: 'x' }, changes),
    ).toBe('speech-9');
    // 経済指標の変更(speaker_name が null)・変更の記録が見つからない・その他の種類
    expect(
      inboxAttributionSpeechId({ kind: 'CALENDAR_UPDATE', target_id: 'change-1', speaker_name: null }, changes),
    ).toBe(null);
    expect(inboxAttributionSpeechId({ kind: 'CALENDAR_UPDATE', target_id: 'gone', speaker_name: 'x' }, changes)).toBe(
      null,
    );
    expect(inboxAttributionSpeechId({ kind: 'INDICATOR', target_id: 'event-1', speaker_name: null }, changes)).toBe(
      null,
    );
    expect(inboxAttributionSpeechId({ kind: 'RATE_ALERT', target_id: 'alert-1', speaker_name: null }, changes)).toBe(
      null,
    );
  });
});

describe('resolveInboxAttributions (api-design v1.39, HQ判断 2026-10-28「統合前レビュー」B3)', () => {
  const base = {
    trigger: 'LEAD_5',
    title: 't',
    body: null,
    display_name: null,
    country_code: null,
    importance: null,
    scheduled_at: null,
    notify_at: '2026-10-13T11:25:00Z',
    read_at: null,
    expires_at: '2026-11-12T11:25:00Z',
  };
  function counting(changes: Map<string, string>, organizations: Map<string, string>) {
    const calls = { changes: [] as number[], speeches: [] as number[] };
    return {
      calls,
      lookups: {
        speechIdsOfChanges: (ids: readonly string[]) => {
          calls.changes.push(ids.length);
          return Promise.resolve(changes);
        },
        organizationsOfSpeeches: (ids: readonly string[]) => {
          calls.speeches.push(ids.length);
          return Promise.resolve(organizations);
        },
      },
    };
  }

  it('no N+1: 300 rows → each lookup called once, with the distinct ids', async () => {
    const rows: NotificationInboxRow[] = Array.from({ length: 300 }, (_, i) => ({
      ...base,
      id: `row-${i}`,
      kind: i % 3 === 0 ? 'CALENDAR_UPDATE' : i % 3 === 1 ? 'SPEECH' : 'INDICATOR',
      target_id: i % 3 === 0 ? `change-${i}` : i % 3 === 1 ? `speech-${i % 7}` : `event-${i}`,
      speaker_name: i % 3 === 2 ? null : 'x',
    }));
    const changes = new Map(rows.filter((r) => r.kind === 'CALENDAR_UPDATE').map((r) => [r.target_id, 'speech-ecb']));
    const organizations = new Map([
      ['speech-ecb', 'ECB'],
      ...Array.from({ length: 7 }, (_, k) => [`speech-${k}`, 'FRB'] as [string, string]),
    ]);
    const { calls, lookups } = counting(changes, organizations);
    const result = await resolveInboxAttributions(rows, lookups);
    expect(calls).toEqual({ changes: [100], speeches: [8] });
    expect(result[0]).toEqual(ECB_ATTRIBUTION);
    expect(result[1]).toEqual(FRB_ATTRIBUTION);
    expect(result[2]).toBeNull();
  });

  it('reads nothing when no row needs an attribution', async () => {
    const { calls, lookups } = counting(new Map(), new Map());
    const rows = [{ ...base, id: 'a', kind: 'RATE_ALERT' as const, target_id: 'alert', speaker_name: null }];
    expect(await resolveInboxAttributions(rows, lookups)).toEqual([null]);
    expect(calls).toEqual({ changes: [], speeches: [] });
  });
});
