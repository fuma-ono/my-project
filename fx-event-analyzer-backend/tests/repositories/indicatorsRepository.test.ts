import { describe, expect, it, vi } from 'vitest';
import { getIndicatorById } from '../../src/repositories/indicatorsRepository.js';
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
