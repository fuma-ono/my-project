import { describe, expect, it } from 'vitest';
import { listIndicators } from '../../src/repositories/indicatorsRepository.js';
import { fakeSupabaseClient } from '../helpers/fakeSupabaseClient.js';
import { RESULT_TYPE_NONE_INDICATORS, resultTypeForIndicator } from '../../src/domain/resultType.js';

describe('resultTypeForIndicator for central bank meeting schedules', () => {
  it('BOJ_RATE and EU_ECB_RATE have no result values (NONE); other indicators stay VALUE', () => {
    expect(resultTypeForIndicator('BOJ_RATE')).toBe('NONE');
    expect(resultTypeForIndicator('EU_ECB_RATE')).toBe('NONE');
    expect(resultTypeForIndicator('US_FOMC')).toBe('VALUE');
    expect(resultTypeForIndicator('US_CPI')).toBe('VALUE');
  });
});

describe('result_type NONE for BOJ_RATE / EU_ECB_RATE in the API', () => {
  it('the NONE set includes both central bank schedules', () => {
    expect(RESULT_TYPE_NONE_INDICATORS.has('BOJ_RATE')).toBe(true);
    expect(RESULT_TYPE_NONE_INDICATORS.has('EU_ECB_RATE')).toBe(true);
    expect(RESULT_TYPE_NONE_INDICATORS.has('US_CPI')).toBe(false);
  });

  it('GET /indicators rows: NONE for the two schedules, VALUE for US_CPI', async () => {
    const row = (id: string, code: string) => ({
      id,
      code,
      name: code,
      display_name: null,
      name_en: null,
      country_code: 'JP',
      currency_code: 'JPY',
      importance: 'HIGH',
      description: null,
      key_points: [],
      frequency: 'IRREGULAR',
      unit: null,
      source: null,
      source_url: null,
      favorable_direction: 'NEUTRAL',
      market_view_above: null,
      market_view_below: null,
      is_active: true,
    });
    const supabase = fakeSupabaseClient({
      economic_indicators: [row('a', 'BOJ_RATE'), row('b', 'EU_ECB_RATE'), row('c', 'US_CPI')],
    });
    const { rows } = await listIndicators(supabase, { sort: 'name' }, { page: 1, limit: 20 });
    expect(Object.fromEntries(rows.map((r) => [r.code, r.result_type]))).toEqual({
      BOJ_RATE: 'NONE',
      EU_ECB_RATE: 'NONE',
      US_CPI: 'VALUE',
    });
  });
});
