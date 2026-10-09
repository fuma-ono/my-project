import { describe, expect, it } from 'vitest';
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

  it('returns null for an unknown or inactive indicator', async () => {
    const supabase = fakeSupabaseClient({ economic_indicators: [dbRow({ is_active: false })] });
    expect(await getIndicatorById(supabase, 'i1')).toBeNull();
    expect(await getIndicatorById(supabase, 'missing')).toBeNull();
  });
});
