import { describe, expect, it, vi } from 'vitest';
import {
  getIndicatorById,
  getIndicatorReleaseSummaries,
  listIndicators,
} from '../../src/repositories/indicatorsRepository.js';
import { fakeSupabaseClient } from '../helpers/fakeSupabaseClient.js';

function dbRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'i1',
    code: 'US_CPI',
    name: '米国CPI(消費者物価指数)',
    name_en: 'Consumer Price Index',
    country_code: 'US',
    currency_code: 'USD',
    importance: 'HIGH',
    description: '消費者物価指数（CPI）は、消費者が購入するモノやサービスの価格の変動を測定する指標です。',
    key_points: ['インフレの動向を把握できる', '金融政策への影響が大きい'],
    frequency: 'MONTHLY',
    unit: '%',
    source: 'U.S. Bureau of Labor Statistics',
    source_url: null,
    favorable_direction: 'HIGHER_IS_POSITIVE',
    market_view_above:
      '米国CPIが予想を上回ると、インフレの高止まりから利下げが遠のくとの見方が強まり、ドルが買われやすいとされる。',
    market_view_below: '米国CPIが予想を下回ると、インフレの落ち着きから利下げが意識され、ドルが売られやすいとされる。',
    is_active: true,
    ...overrides,
  };
}

describe('getIndicatorById (SCR-006 fields)', () => {
  it('returns name_en and key_points as stored', async () => {
    const supabase = fakeSupabaseClient({ economic_indicators: [dbRow()] });
    const indicator = await getIndicatorById(supabase, 'i1');
    expect(indicator).toMatchObject({
      name_en: 'Consumer Price Index',
      key_points: ['インフレの動向を把握できる', '金融政策への影響が大きい'],
    });
  });

  it('returns key_points [] and name_en null when they are not registered', async () => {
    const supabase = fakeSupabaseClient({ economic_indicators: [dbRow({ name_en: null, key_points: null })] });
    const indicator = await getIndicatorById(supabase, 'i1');
    expect(indicator?.name_en).toBeNull();
    expect(indicator?.key_points).toEqual([]);
  });

  it('returns market_view_above / market_view_below as stored (SCR-008 一般的な見方)', async () => {
    const supabase = fakeSupabaseClient({ economic_indicators: [dbRow()] });
    const indicator = await getIndicatorById(supabase, 'i1');
    expect(indicator?.market_view_above).toBe(
      '米国CPIが予想を上回ると、インフレの高止まりから利下げが遠のくとの見方が強まり、ドルが買われやすいとされる。',
    );
    expect(indicator?.market_view_below).toBe(
      '米国CPIが予想を下回ると、インフレの落ち着きから利下げが意識され、ドルが売られやすいとされる。',
    );
  });

  it('returns market_view_above / market_view_below null when they are not registered', async () => {
    const supabase = fakeSupabaseClient({
      economic_indicators: [dbRow({ market_view_above: null, market_view_below: null })],
    });
    const indicator = await getIndicatorById(supabase, 'i1');
    expect(indicator?.market_view_above).toBeNull();
    expect(indicator?.market_view_below).toBeNull();
  });

  it('selects the market_view columns from economic_indicators', async () => {
    const supabase = fakeSupabaseClient({ economic_indicators: [dbRow()] });
    const from = supabase.from.bind(supabase);
    const selected: string[] = [];
    vi.spyOn(supabase, 'from').mockImplementation((table: string) => {
      const chain = from(table) as unknown as { select: (columns: string) => unknown };
      const select = chain.select;
      chain.select = (columns: string) => {
        selected.push(columns);
        return select(columns);
      };
      return chain as never;
    });
    await getIndicatorById(supabase, 'i1');
    expect(selected[0]).toContain('market_view_above');
    expect(selected[0]).toContain('market_view_below');
  });

  it('returns null for an unknown or inactive indicator', async () => {
    const supabase = fakeSupabaseClient({ economic_indicators: [dbRow({ is_active: false })] });
    expect(await getIndicatorById(supabase, 'i1')).toBeNull();
    expect(await getIndicatorById(supabase, 'missing')).toBeNull();
  });
});

describe('listIndicators — next / latest release (SCR-005, v1.20)', () => {
  const now = new Date('2026-10-13T00:00:00Z');
  const indicators = [
    dbRow({ id: 'i1', code: 'US_CPI', name: 'C 米国CPI' }),
    dbRow({ id: 'i2', code: 'US_NFP', name: 'A 米国雇用統計' }),
    dbRow({ id: 'i3', code: 'JP_CPI', name: 'B 日本CPI' }),
    dbRow({ id: 'i4', code: 'OLD', name: 'D 廃止指標', is_active: false }),
  ];
  const events = [
    // i1: next on 10/15 (a later one too), one RELEASED in the past.
    { id: 'e1-later', indicator_id: 'i1', release_datetime: '2026-11-12T12:30:00Z', status: 'SCHEDULED' },
    { id: 'e1-next', indicator_id: 'i1', release_datetime: '2026-10-15T12:30:00Z', status: 'SCHEDULED' },
    { id: 'e1-done', indicator_id: 'i1', release_datetime: '2026-09-10T12:30:00Z', status: 'RELEASED' },
    // i2: a SCHEDULED event already in the past (not "next") and a CANCELLED future one.
    { id: 'e2-stale', indicator_id: 'i2', release_datetime: '2026-10-03T12:30:00Z', status: 'SCHEDULED' },
    { id: 'e2-cancel', indicator_id: 'i2', release_datetime: '2026-10-14T12:30:00Z', status: 'CANCELLED' },
    { id: 'e2-done', indicator_id: 'i2', release_datetime: '2026-09-05T12:30:00Z', status: 'RELEASED' },
    // i3: next on 10/14 (earlier than i1), never released.
    { id: 'e3-next', indicator_id: 'i3', release_datetime: '2026-10-14T23:30:00Z', status: 'SCHEDULED' },
  ];

  it('adds next_release_datetime / next_event_id / latest_release_datetime to every row', async () => {
    const supabase = fakeSupabaseClient({ economic_indicators: indicators, economic_events: events });
    const { rows, total } = await listIndicators(supabase, { sort: 'name' }, { page: 1, limit: 20 }, now);
    expect(total).toBe(3);
    const byId = Object.fromEntries(rows.map((row) => [row.id, row]));
    expect(byId.i1).toMatchObject({
      next_release_datetime: '2026-10-15T12:30:00Z',
      next_event_id: 'e1-next',
      latest_release_datetime: '2026-09-10T12:30:00Z',
    });
    expect(byId.i2).toMatchObject({
      next_release_datetime: null,
      next_event_id: null,
      latest_release_datetime: '2026-09-05T12:30:00Z',
    });
    expect(byId.i3).toMatchObject({
      next_release_datetime: '2026-10-14T23:30:00Z',
      next_event_id: 'e3-next',
      latest_release_datetime: null,
    });
  });

  it('queries economic_events twice for the whole page, not once per indicator', async () => {
    const supabase = fakeSupabaseClient({ economic_indicators: indicators, economic_events: events });
    const from = vi.spyOn(supabase, 'from');
    await listIndicators(supabase, { sort: 'name' }, { page: 1, limit: 20 }, now);
    const tables = from.mock.calls.map(([table]) => table);
    expect(tables.filter((table) => table === 'economic_events')).toHaveLength(2);
    expect(tables.filter((table) => table === 'economic_indicators')).toHaveLength(1);
  });

  it('sort=next_release orders by next release ascending, none last, then pages', async () => {
    const supabase = fakeSupabaseClient({ economic_indicators: indicators, economic_events: events });
    const all = await listIndicators(supabase, { sort: 'next_release' }, { page: 1, limit: 20 }, now);
    expect(all.rows.map((row) => row.id)).toEqual(['i3', 'i1', 'i2']);
    expect(all.total).toBe(3);

    const page2 = await listIndicators(supabase, { sort: 'next_release' }, { page: 2, limit: 2 }, now);
    expect(page2.rows.map((row) => row.id)).toEqual(['i2']);
    expect(page2.total).toBe(3);
  });
});

describe('getIndicatorReleaseSummaries', () => {
  it('returns an empty map without querying when there are no ids', async () => {
    const supabase = fakeSupabaseClient({});
    const from = vi.spyOn(supabase, 'from');
    expect((await getIndicatorReleaseSummaries(supabase, [])).size).toBe(0);
    expect(from).not.toHaveBeenCalled();
  });
});
