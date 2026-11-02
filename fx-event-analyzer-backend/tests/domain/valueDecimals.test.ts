import { describe, expect, it } from 'vitest';
import { valueDecimalsForIndicator } from '../../src/domain/valueDecimals.js';

// HQ指示(2026-11-02「表示桁数」、api-design v1.46): BLS の%の指標は 1、それ以外の取得元は null。
describe('valueDecimalsForIndicator', () => {
  it.each(['US_CPI', 'US_CORE_CPI', 'US_UNEMPLOYMENT_RATE', 'US_AVG_HOURLY_EARNINGS', 'US_PPI', 'US_CORE_PPI'])(
    '%s (BLS, percent) → 1',
    (code) => {
      expect(valueDecimalsForIndicator(code)).toBe(1);
    },
  );

  it.each(['US_NFP', 'US_JOLTS'])(
    '%s (BLS, thousands) → null: the 万人 display already has the published digits',
    (code) => {
      expect(valueDecimalsForIndicator(code)).toBeNull();
    },
  );

  it.each(['EU_HICP', 'EU_UNEMPLOYMENT_RATE'])('%s (Eurostat) → null: not applied to other sources', (code) => {
    expect(valueDecimalsForIndicator(code)).toBeNull();
  });

  it.each(['BOJ_RATE', 'JP_CPI', 'US_FOMC', 'US_FOMC_MINUTES', 'UNKNOWN_CODE', '', null, undefined])(
    '%s (no BLS mapping) → null',
    (code) => {
      expect(valueDecimalsForIndicator(code)).toBeNull();
    },
  );
});
