import { describe, expect, it } from 'vitest';
import {
  buildUpcomingNotifications,
  formatIsoSeconds,
  fxPairsForCurrency,
  isInQuietHours,
  localMinutesOfDay,
  MAX_UPCOMING_NOTIFICATIONS,
  NOTIFICATION_TIME_PATTERN,
  resolveUpcomingWindow,
  type IndicatorNotificationCandidate,
  type NotificationPreferences,
  type QuietHours,
  type SpeechNotificationCandidate,
} from '../../src/domain/notifications.js';
import { ApiError } from '../../src/errors/ApiError.js';

const window = { from: new Date('2026-10-05T00:00:00Z'), to: new Date('2026-10-12T00:00:00Z') };

const prefs: NotificationPreferences = {
  push: true,
  indicators: true,
  speeches: true,
  fxPairSymbols: null,
  importances: ['HIGH', 'MEDIUM'],
  leadMinutes: 5,
  // The column defaults: off, 23:00〜07:00.
  quietHours: { enabled: false, start: '23:00', end: '07:00' },
  timeZone: 'Asia/Tokyo',
};

function indicator(overrides: Partial<IndicatorNotificationCandidate> = {}): IndicatorNotificationCandidate {
  return {
    kind: 'INDICATOR',
    id: 'event-1',
    title: 'US Non-Farm Payrolls',
    importance: 'HIGH',
    status: 'SCHEDULED',
    scheduled_at: '2026-10-06T12:30:00+00:00',
    release_datetime_precision: 'EXACT',
    country_code: 'US',
    currency_code: 'USD',
    related_fx_pairs: ['USDJPY', 'EURUSD'],
    ...overrides,
  };
}

function speech(overrides: Partial<SpeechNotificationCandidate> = {}): SpeechNotificationCandidate {
  return {
    kind: 'SPEECH',
    id: 'speech-1',
    title: '経済見通しに関する講演',
    speaker_name: 'ジェローム・パウエル',
    importance: 'HIGH',
    status: 'SCHEDULED',
    scheduled_at: '2026-10-07T16:00:00Z',
    country_code: 'US',
    currency_code: 'USD',
    related_fx_pairs: ['EURUSD', 'USDJPY'],
    ...overrides,
  };
}

const ids = (items: { id: string }[]) => items.map((item) => item.id);

describe('buildUpcomingNotifications', () => {
  it('maps an indicator and a speech to the response item shape', () => {
    expect(buildUpcomingNotifications(prefs, [indicator(), speech()], window)).toEqual([
      {
        kind: 'INDICATOR',
        id: 'event-1',
        title: 'US Non-Farm Payrolls',
        speaker_name: null,
        importance: 'HIGH',
        scheduled_at: '2026-10-06T12:30:00Z',
        notify_at: '2026-10-06T12:25:00Z',
        country_code: 'US',
        currency_code: 'USD',
        related_fx_pairs: ['USDJPY', 'EURUSD'],
      },
      {
        kind: 'SPEECH',
        id: 'speech-1',
        title: '経済見通しに関する講演',
        speaker_name: 'ジェローム・パウエル',
        importance: 'HIGH',
        scheduled_at: '2026-10-07T16:00:00Z',
        notify_at: '2026-10-07T15:55:00Z',
        country_code: 'US',
        currency_code: 'USD',
        related_fx_pairs: ['EURUSD', 'USDJPY'],
      },
    ]);
  });

  it('returns nothing when push is off', () => {
    expect(buildUpcomingNotifications({ ...prefs, push: false }, [indicator(), speech()], window)).toEqual([]);
  });

  it('respects the per-kind switches', () => {
    expect(ids(buildUpcomingNotifications({ ...prefs, indicators: false }, [indicator(), speech()], window))).toEqual([
      'speech-1',
    ]);
    expect(ids(buildUpcomingNotifications({ ...prefs, speeches: false }, [indicator(), speech()], window))).toEqual([
      'event-1',
    ]);
  });

  it('only includes SCHEDULED items', () => {
    const candidates = [indicator({ status: 'RELEASED' }), speech({ status: 'CANCELLED' })];
    expect(buildUpcomingNotifications(prefs, candidates, window)).toEqual([]);
  });

  it('only includes indicators with an EXACT release time', () => {
    const candidates = [
      indicator({ id: 'exact' }),
      indicator({ id: 'date-only', release_datetime_precision: 'DATE_ONLY' }),
      indicator({ id: 'approx', release_datetime_precision: 'APPROXIMATE' }),
    ];
    expect(ids(buildUpcomingNotifications(prefs, candidates, window))).toEqual(['exact']);
  });

  it('filters by the selected importances', () => {
    const candidates = [
      indicator({ id: 'high', importance: 'HIGH' }),
      indicator({ id: 'medium', importance: 'MEDIUM', scheduled_at: '2026-10-06T13:00:00Z' }),
      indicator({ id: 'low', importance: 'LOW', scheduled_at: '2026-10-06T14:00:00Z' }),
    ];
    expect(ids(buildUpcomingNotifications(prefs, candidates, window))).toEqual(['high', 'medium']);
    expect(ids(buildUpcomingNotifications({ ...prefs, importances: ['LOW'] }, candidates, window))).toEqual(['low']);
  });

  it('keeps every pair when fx_pairs is null, otherwise requires an intersection', () => {
    const candidates = [
      indicator({ id: 'usd', related_fx_pairs: ['USDJPY'] }),
      indicator({ id: 'eur', related_fx_pairs: ['EURJPY'], scheduled_at: '2026-10-06T13:00:00Z' }),
      indicator({ id: 'none', related_fx_pairs: [], scheduled_at: '2026-10-06T14:00:00Z' }),
    ];
    expect(ids(buildUpcomingNotifications(prefs, candidates, window))).toEqual(['usd', 'eur', 'none']);
    expect(
      ids(buildUpcomingNotifications({ ...prefs, fxPairSymbols: ['EURJPY', 'GBPJPY'] }, candidates, window)),
    ).toEqual(['eur']);
  });

  it('subtracts lead_minutes, and 0 means notify at the scheduled time', () => {
    const [sixty] = buildUpcomingNotifications({ ...prefs, leadMinutes: 60 }, [indicator()], window);
    expect(sixty?.notify_at).toBe('2026-10-06T11:30:00Z');
    const [atTime] = buildUpcomingNotifications({ ...prefs, leadMinutes: 0 }, [indicator()], window);
    expect(atTime?.notify_at).toBe('2026-10-06T12:30:00Z');
  });

  it('drops items whose notify_at is before from, or whose scheduled_at is after to', () => {
    const candidates = [
      // scheduled 3 minutes after `from`, notify_at (5 min before) is already past.
      indicator({ id: 'too-soon', scheduled_at: '2026-10-05T00:03:00Z' }),
      indicator({ id: 'exactly-from', scheduled_at: '2026-10-05T00:05:00Z' }),
      indicator({ id: 'exactly-to', scheduled_at: '2026-10-12T00:00:00Z' }),
      indicator({ id: 'too-late', scheduled_at: '2026-10-12T00:01:00Z' }),
    ];
    expect(ids(buildUpcomingNotifications(prefs, candidates, window))).toEqual(['exactly-from', 'exactly-to']);
  });

  it('sorts by notify_at ascending across kinds', () => {
    const candidates = [
      speech({ id: 's-late', scheduled_at: '2026-10-09T00:00:00Z' }),
      indicator({ id: 'i-mid', scheduled_at: '2026-10-08T00:00:00Z' }),
      speech({ id: 's-early', scheduled_at: '2026-10-06T00:00:00Z' }),
    ];
    expect(ids(buildUpcomingNotifications(prefs, candidates, window))).toEqual(['s-early', 'i-mid', 's-late']);
  });

  it(`caps the list at ${MAX_UPCOMING_NOTIFICATIONS} items, keeping the earliest`, () => {
    const start = new Date('2026-10-06T00:00:00Z').getTime();
    const candidates = Array.from({ length: 80 }, (_, index) =>
      indicator({
        id: `event-${String(79 - index).padStart(2, '0')}`,
        scheduled_at: new Date(start + (79 - index) * 60_000).toISOString(),
      }),
    );
    const items = buildUpcomingNotifications(prefs, candidates, window);
    expect(items).toHaveLength(MAX_UPCOMING_NOTIFICATIONS);
    expect(items[0]?.id).toBe('event-00');
    expect(items.at(-1)?.id).toBe('event-59');
  });

  describe('quiet hours', () => {
    const quiet: QuietHours = { enabled: true, start: '23:00', end: '07:00' };

    it('ignores quiet hours while they are disabled (the default)', () => {
      // speech-1 notify_at 2026-10-07T15:55Z = 00:55 JST — inside 23:00〜07:00.
      expect(ids(buildUpcomingNotifications(prefs, [indicator(), speech()], window))).toEqual(['event-1', 'speech-1']);
    });

    it('drops items whose notify_at falls in the quiet hours of the display timezone', () => {
      // event-1 notify_at 12:25Z = 21:25 JST (kept), speech-1 15:55Z = 00:55 JST (dropped).
      const tokyo = { ...prefs, quietHours: quiet };
      expect(ids(buildUpcomingNotifications(tokyo, [indicator(), speech()], window))).toEqual(['event-1']);
      // The same instants in New York (EDT) are 08:25 and 11:55 — both outside.
      const newYork = { ...prefs, quietHours: quiet, timeZone: 'America/New_York' };
      expect(ids(buildUpcomingNotifications(newYork, [indicator(), speech()], window))).toEqual([
        'event-1',
        'speech-1',
      ]);
    });

    it('judges by notify_at (after lead_minutes), not scheduled_at', () => {
      // Scheduled 07:05 JST: 5 minutes before = 07:00 (kept), 10 minutes before = 06:55 (dropped).
      const candidates = [indicator({ scheduled_at: '2026-10-06T22:05:00Z' })];
      const quietPrefs = { ...prefs, quietHours: quiet };
      expect(buildUpcomingNotifications(quietPrefs, candidates, window)).toHaveLength(1);
      expect(buildUpcomingNotifications({ ...quietPrefs, leadMinutes: 10 }, candidates, window)).toEqual([]);
    });

    it('applies the 60-item cap after the quiet hours filter', () => {
      // 100 items notified one per minute from 22:30 JST; quiet 23:00〜23:30 removes index 30..59,
      // leaving 70 — the cap then keeps 0..29 and 60..89.
      const start = new Date('2026-10-06T13:35:00Z').getTime();
      const candidates = Array.from({ length: 100 }, (_, index) =>
        indicator({
          id: `event-${String(index).padStart(2, '0')}`,
          scheduled_at: new Date(start + index * 60_000).toISOString(),
        }),
      );
      const items = buildUpcomingNotifications(
        { ...prefs, quietHours: { enabled: true, start: '23:00', end: '23:30' } },
        candidates,
        window,
      );
      expect(items).toHaveLength(MAX_UPCOMING_NOTIFICATIONS);
      expect(items[29]?.id).toBe('event-29');
      expect(items[30]?.id).toBe('event-60');
      expect(items.at(-1)?.id).toBe('event-89');
    });
  });

  it('never emits fractional seconds (iOS .iso8601 decoding rejects them)', () => {
    const [item] = buildUpcomingNotifications(prefs, [indicator({ scheduled_at: '2026-10-06T12:30:00.123Z' })], window);
    expect(item?.notify_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(item?.scheduled_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });
});

describe('formatIsoSeconds', () => {
  it('formats UTC without milliseconds', () => {
    expect(formatIsoSeconds(new Date('2026-10-05T01:02:03.456Z'))).toBe('2026-10-05T01:02:03Z');
  });
});

describe('fxPairsForCurrency', () => {
  const pairs = [
    { symbol: 'EURJPY', base_currency: 'EUR', quote_currency: 'JPY' },
    { symbol: 'EURUSD', base_currency: 'EUR', quote_currency: 'USD' },
    { symbol: 'USDJPY', base_currency: 'USD', quote_currency: 'JPY' },
  ];

  it('returns every pair whose base or quote is the currency', () => {
    expect(fxPairsForCurrency('USD', pairs)).toEqual(['EURUSD', 'USDJPY']);
    expect(fxPairsForCurrency('JPY', pairs)).toEqual(['EURJPY', 'USDJPY']);
    expect(fxPairsForCurrency('GBP', pairs)).toEqual([]);
  });
});

describe('resolveUpcomingWindow', () => {
  const now = new Date('2026-10-05T09:00:00Z');

  it('defaults to now .. now + 7 days', () => {
    expect(resolveUpcomingWindow({}, now)).toEqual({ from: now, to: new Date('2026-10-12T09:00:00Z') });
  });

  it('defaults to to from + 7 days when only from is given', () => {
    expect(resolveUpcomingWindow({ from: '2026-10-10T00:00:00Z' }, now).to).toEqual(new Date('2026-10-17T00:00:00Z'));
  });

  it('accepts exactly 14 days', () => {
    expect(() =>
      resolveUpcomingWindow({ from: '2026-10-05T00:00:00Z', to: '2026-10-19T00:00:00Z' }, now),
    ).not.toThrow();
  });

  it('rejects ranges over 14 days and to <= from with 422', () => {
    for (const query of [
      { from: '2026-10-05T00:00:00Z', to: '2026-10-19T00:00:01Z' },
      { from: '2026-10-05T00:00:00Z', to: '2026-10-05T00:00:00Z' },
      { from: '2026-10-06T00:00:00Z', to: '2026-10-05T00:00:00Z' },
      { to: '2026-10-01T00:00:00Z' },
    ]) {
      try {
        resolveUpcomingWindow(query, now);
        expect.unreachable(`expected ${JSON.stringify(query)} to be rejected`);
      } catch (error) {
        expect(error).toBeInstanceOf(ApiError);
        expect((error as ApiError).statusCode).toBe(422);
      }
    }
  });
});

describe('NOTIFICATION_TIME_PATTERN', () => {
  it('accepts HH:MM from 00:00 to 23:59 only', () => {
    for (const value of ['00:00', '07:00', '09:05', '23:00', '23:59']) {
      expect(NOTIFICATION_TIME_PATTERN.test(value)).toBe(true);
    }
    for (const value of ['24:00', '7:00', '07:0', '07:60', '07:00:00', '0700', ' 07:00', '07:00 ', '']) {
      expect(NOTIFICATION_TIME_PATTERN.test(value)).toBe(false);
    }
  });
});

describe('localMinutesOfDay', () => {
  it('returns minutes since local midnight, with midnight as 0 (not 24:00)', () => {
    expect(localMinutesOfDay(new Date('2026-10-06T15:00:00Z'), 'Asia/Tokyo')).toBe(0);
    expect(localMinutesOfDay(new Date('2026-10-06T14:59:59Z'), 'Asia/Tokyo')).toBe(23 * 60 + 59);
    expect(localMinutesOfDay(new Date('2026-10-06T00:30:00Z'), 'UTC')).toBe(30);
  });

  it('follows DST in the given zone', () => {
    // 03:30Z = 23:30 EDT (UTC-4) in October, 22:30 EST (UTC-5) in December.
    expect(localMinutesOfDay(new Date('2026-10-06T03:30:00Z'), 'America/New_York')).toBe(23 * 60 + 30);
    expect(localMinutesOfDay(new Date('2026-12-06T03:30:00Z'), 'America/New_York')).toBe(22 * 60 + 30);
  });

  it('falls back to Asia/Tokyo for an empty or unknown zone', () => {
    const instant = new Date('2026-10-06T14:00:00Z'); // 23:00 JST
    expect(localMinutesOfDay(instant, 'Mars/Olympus')).toBe(23 * 60);
    expect(localMinutesOfDay(instant, '')).toBe(23 * 60);
  });
});

describe('isInQuietHours', () => {
  // 既定値 23:00〜07:00. Times in the comments are JST (UTC+9, no DST).
  const overnight: QuietHours = { enabled: true, start: '23:00', end: '07:00' };
  const at = (utc: string) => new Date(utc);

  it('never suppresses while disabled', () => {
    expect(isInQuietHours(at('2026-10-06T15:00:00Z'), { ...overnight, enabled: false }, 'Asia/Tokyo')).toBe(false);
  });

  it('wraps midnight when end < start: [23:00, 07:00)', () => {
    expect(isInQuietHours(at('2026-10-06T13:59:00Z'), overnight, 'Asia/Tokyo')).toBe(false); // 22:59
    expect(isInQuietHours(at('2026-10-06T14:00:00Z'), overnight, 'Asia/Tokyo')).toBe(true); // 23:00
    expect(isInQuietHours(at('2026-10-06T15:00:00Z'), overnight, 'Asia/Tokyo')).toBe(true); // 00:00
    expect(isInQuietHours(at('2026-10-06T21:59:00Z'), overnight, 'Asia/Tokyo')).toBe(true); // 06:59
    expect(isInQuietHours(at('2026-10-06T22:00:00Z'), overnight, 'Asia/Tokyo')).toBe(false); // 07:00
    expect(isInQuietHours(at('2026-10-06T03:00:00Z'), overnight, 'Asia/Tokyo')).toBe(false); // 12:00
  });

  it('is a same-day range when start < end: [12:00, 13:00)', () => {
    const lunch: QuietHours = { enabled: true, start: '12:00', end: '13:00' };
    expect(isInQuietHours(at('2026-10-06T02:59:00Z'), lunch, 'Asia/Tokyo')).toBe(false); // 11:59
    expect(isInQuietHours(at('2026-10-06T03:00:00Z'), lunch, 'Asia/Tokyo')).toBe(true); // 12:00
    expect(isInQuietHours(at('2026-10-06T03:59:59Z'), lunch, 'Asia/Tokyo')).toBe(true); // 12:59:59
    expect(isInQuietHours(at('2026-10-06T04:00:00Z'), lunch, 'Asia/Tokyo')).toBe(false); // 13:00
    expect(isInQuietHours(at('2026-10-06T15:00:00Z'), lunch, 'Asia/Tokyo')).toBe(false); // 00:00
  });

  it('suppresses nothing when start == end', () => {
    const same: QuietHours = { enabled: true, start: '07:00', end: '07:00' };
    for (const utc of ['2026-10-06T22:00:00Z', '2026-10-06T15:00:00Z', '2026-10-06T03:00:00Z']) {
      expect(isInQuietHours(at(utc), same, 'Asia/Tokyo')).toBe(false);
    }
  });

  it('evaluates the local time of the given timezone, including DST', () => {
    const instant = at('2026-10-06T03:30:00Z'); // 12:30 JST, 23:30 EDT, 03:30 UTC
    expect(isInQuietHours(instant, overnight, 'Asia/Tokyo')).toBe(false);
    expect(isInQuietHours(instant, overnight, 'America/New_York')).toBe(true);
    expect(isInQuietHours(instant, overnight, 'UTC')).toBe(true);
    // The same UTC time in December is 22:30 EST — outside.
    expect(isInQuietHours(at('2026-12-06T03:30:00Z'), overnight, 'America/New_York')).toBe(false);
  });

  it('falls back to Asia/Tokyo for an empty or unknown timezone', () => {
    const instant = at('2026-10-06T14:00:00Z'); // 23:00 JST, 14:00 UTC
    expect(isInQuietHours(instant, overnight, 'Mars/Olympus')).toBe(true);
    expect(isInQuietHours(instant, overnight, '')).toBe(true);
  });
});
