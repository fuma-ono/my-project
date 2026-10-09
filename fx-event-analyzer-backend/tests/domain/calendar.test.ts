import { describe, expect, it } from 'vitest';
import { buildCalendarItems, type CalendarIndicatorEvent, type CalendarSpeech } from '../../src/domain/calendar.js';

function event(overrides: Partial<CalendarIndicatorEvent> = {}): CalendarIndicatorEvent {
  return {
    id: 'e1',
    indicator_id: 'i1',
    indicator_name: '米国雇用統計(非農業部門雇用者数)',
    country_code: 'US',
    currency_code: 'USD',
    importance: 'HIGH',
    release_datetime: '2026-10-08T12:30:00+00:00',
    release_datetime_precision: 'EXACT',
    status: 'SCHEDULED',
    ...overrides,
  };
}

function speech(overrides: Partial<CalendarSpeech> = {}): CalendarSpeech {
  return {
    speech_id: 's1',
    title: '経済見通しに関する講演',
    speaker: { name: 'ジェローム・パウエル', country_code: 'US', currency_code: 'USD' },
    importance: 'HIGH',
    statement_datetime: '2026-10-08T06:00:00+00:00',
    status: 'SCHEDULED',
    ...overrides,
  };
}

describe('buildCalendarItems', () => {
  it('maps indicators and speeches into one item shape', () => {
    const items = buildCalendarItems([event({ release_datetime_precision: 'DATE_ONLY' })], [speech()]);
    expect(items).toEqual([
      {
        kind: 'SPEECH',
        id: 's1',
        indicator_id: null,
        title: '経済見通しに関する講演',
        speaker_name: 'ジェローム・パウエル',
        country_code: 'US',
        currency_code: 'USD',
        importance: 'HIGH',
        datetime: '2026-10-08T06:00:00+00:00',
        datetime_precision: 'EXACT',
        status: 'SCHEDULED',
      },
      {
        kind: 'INDICATOR',
        id: 'e1',
        indicator_id: 'i1',
        title: '米国雇用統計(非農業部門雇用者数)',
        speaker_name: null,
        country_code: 'US',
        currency_code: 'USD',
        importance: 'HIGH',
        datetime: '2026-10-08T12:30:00+00:00',
        datetime_precision: 'DATE_ONLY',
        status: 'SCHEDULED',
      },
    ]);
  });

  it('sorts by instant (not string), then INDICATOR before SPEECH, then id', () => {
    const items = buildCalendarItems(
      [
        event({ id: 'e2', release_datetime: '2026-10-08T21:30:00+09:00' }), // 12:30Z
        event({ id: 'e1', release_datetime: '2026-10-08T12:30:00+00:00' }),
        event({ id: 'e0', release_datetime: '2026-10-09T00:00:00Z' }),
      ],
      [
        speech({ speech_id: 's2', statement_datetime: '2026-10-08T12:30:00Z' }),
        speech({ speech_id: 's1', statement_datetime: '2026-10-08T12:30:00Z' }),
        speech({ speech_id: 's0', statement_datetime: '2026-10-07T23:59:00Z' }),
      ],
    );
    expect(items.map((item) => item.id)).toEqual(['s0', 'e1', 'e2', 's1', 's2', 'e0']);
  });

  it('drops CANCELLED speeches but keeps CANCELLED / RELEASED indicator events and DELIVERED speeches', () => {
    const items = buildCalendarItems(
      [event({ id: 'e1', status: 'CANCELLED' }), event({ id: 'e2', status: 'RELEASED' })],
      [speech({ speech_id: 's1', status: 'CANCELLED' }), speech({ speech_id: 's2', status: 'DELIVERED' })],
    );
    expect(items.map((item) => [item.id, item.status])).toEqual([
      ['s2', 'DELIVERED'],
      ['e1', 'CANCELLED'],
      ['e2', 'RELEASED'],
    ]);
  });

  it('filters by importance and by currency (speaker currency for speeches)', () => {
    const events = [event({ id: 'e1' }), event({ id: 'e2', importance: 'LOW', currency_code: 'JPY' })];
    const speeches = [
      speech({ speech_id: 's1', speaker: { name: '植田和男', country_code: 'JP', currency_code: 'JPY' } }),
      speech({ speech_id: 's2', importance: 'MEDIUM' }),
    ];
    const ids = (filters: Parameters<typeof buildCalendarItems>[2]) =>
      buildCalendarItems(events, speeches, filters).map((item) => item.id);
    expect(ids({ importance: 'HIGH' })).toEqual(['s1', 'e1']);
    expect(ids({ currency: 'JPY' })).toEqual(['s1', 'e2']);
    expect(ids({ importance: 'MEDIUM', currency: 'USD' })).toEqual(['s2']);
  });

  it('carries each event’s indicator_id on INDICATOR items and null on SPEECH items', () => {
    const items = buildCalendarItems(
      [event({ id: 'e1', indicator_id: 'i-cpi' }), event({ id: 'e2', indicator_id: 'i-nfp' })],
      [speech({ speech_id: 's1', statement_datetime: '2026-10-08T13:00:00Z' })],
    );
    expect(items.map((item) => [item.kind, item.id, item.indicator_id])).toEqual([
      ['INDICATOR', 'e1', 'i-cpi'],
      ['INDICATOR', 'e2', 'i-nfp'],
      ['SPEECH', 's1', null],
    ]);
  });

  it('returns an empty list for an empty range', () => {
    expect(buildCalendarItems([], [])).toEqual([]);
  });
});
