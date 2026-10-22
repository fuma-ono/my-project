import { describe, expect, it } from 'vitest';
import { buildCalendarItems } from '../../src/domain/calendar.js';
import { getEventById } from '../../src/repositories/eventsRepository.js';
import { listEventsInRange } from '../../src/repositories/homeRepository.js';
import { fakeSupabaseClient } from '../helpers/fakeSupabaseClient.js';

/**
 * economic_events.is_provisional (migration 20261022000002, HQ承認 2026-10-22 Task 3) reaches
 * GET /calendar items (api-design.md §14.6) and GET /events/{id} (§14.1). The fake returns the
 * nested economic_indicators object the real `!inner` join returns.
 */
const indicator = {
  name: 'FOMC政策金利',
  display_name: 'FOMC政策金利',
  country_code: 'US',
  currency_code: 'USD',
  unit: '%',
  favorable_direction: 'HIGHER_IS_POSITIVE',
};

function row(id: string, releaseDatetime: string, isProvisional?: boolean) {
  return {
    id,
    indicator_id: 'ind-fomc',
    release_datetime: releaseDatetime,
    release_datetime_precision: 'EXACT',
    importance: 'HIGH',
    status: 'SCHEDULED',
    data_status: 'PENDING',
    ...(isProvisional === undefined ? {} : { is_provisional: isProvisional }),
    economic_indicators: indicator,
  };
}

const EVENTS = [
  row('oct', '2026-10-28T18:00:00+00:00', false),
  row('dec', '2026-12-09T19:00:00+00:00', true),
  row('legacy', '2026-11-10T13:30:00+00:00'),
];

describe('is_provisional in the Read API', () => {
  it('GET /calendar: listEventsInRange → buildCalendarItems exposes is_provisional per INDICATOR item', async () => {
    const supabase = fakeSupabaseClient({ economic_events: EVENTS });
    const events = await listEventsInRange(supabase, '2026-10-01T00:00:00Z', '2026-12-31T00:00:00Z');
    const items = buildCalendarItems(events, []);
    expect(items.map((item) => [item.id, item.kind, item.is_provisional])).toEqual([
      ['oct', 'INDICATOR', false],
      ['legacy', 'INDICATOR', false],
      ['dec', 'INDICATOR', true],
    ]);
  });

  it('GET /calendar: the range is [from, to)', async () => {
    const supabase = fakeSupabaseClient({ economic_events: EVENTS });
    const events = await listEventsInRange(supabase, '2026-10-28T18:00:00Z', '2026-12-09T19:00:00Z');
    expect(events.map((event) => event.id)).toEqual(['oct', 'legacy']);
  });

  it('GET /events/{id}: getEventById returns is_provisional (missing = false)', async () => {
    const supabase = fakeSupabaseClient({ economic_events: EVENTS });
    expect((await getEventById(supabase, 'dec'))?.is_provisional).toBe(true);
    expect((await getEventById(supabase, 'oct'))?.is_provisional).toBe(false);
    expect((await getEventById(supabase, 'legacy'))?.is_provisional).toBe(false);
  });
});
