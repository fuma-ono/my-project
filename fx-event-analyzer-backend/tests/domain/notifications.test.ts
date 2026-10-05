import { describe, expect, it } from 'vitest';
import {
  buildUpcomingNotifications,
  formatIsoSeconds,
  fxPairsForCurrency,
  MAX_UPCOMING_NOTIFICATIONS,
  resolveUpcomingWindow,
  type IndicatorNotificationCandidate,
  type NotificationPreferences,
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
