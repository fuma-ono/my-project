import { describe, expect, it } from 'vitest';
import { FX_PAIR_MAPPINGS } from '../../src/ingestion/mappings/fxPairs.js';
import {
  buildMappingIndex,
  FRED_RELEASE_IDS,
  INDICATOR_MAPPINGS,
  providerIndicatorKey,
} from '../../src/ingestion/mappings/indicators.js';
import { findSpeakerAlias, SPEAKER_ALIASES, stripRole } from '../../src/ingestion/mappings/speakers.js';

/** Guards on the code-reviewed mapping tables (data-sources.md §3). */
describe('indicator mapping table', () => {
  it('has unique codes and unique provider keys per provider', () => {
    const codes = INDICATOR_MAPPINGS.map((m) => m.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const provider of ['tradingeconomics', 'finnhub', 'fmp'] as const) {
      expect(() => buildMappingIndex(provider)).not.toThrow();
    }
  });

  it('every entry is internally consistent', () => {
    for (const m of INDICATOR_MAPPINGS) {
      expect(m.expectedRange.min, m.code).toBeLessThan(m.expectedRange.max);
      expect(m.maxAbsChangeFromPrevious, m.code).toBeGreaterThan(0);
      expect(m.decimals, m.code).toBeGreaterThanOrEqual(0);
      // US_RETAIL_SALES: FRED を外したため照合元が無い(公開されない)。data-sources.md 13章。
      if (m.code !== 'US_RETAIL_SALES') expect(m.official.length, m.code).toBeGreaterThan(0);
      expect(FRED_RELEASE_IDS[m.code], m.code).toBeTypeOf('number');
      // Kind ↔ unit: percent changes are in %, CHANGE of payrolls in thousands.
      if (m.valueKind === 'YOY_PCT' || m.valueKind === 'MOM_PCT') expect(m.unit, m.code).toBe('PERCENT');
      if (m.valueKind === 'CHANGE') expect(m.unit, m.code).toBe('THOUSANDS');
      // The official transform must produce the same kind of value.
      for (const ref of m.official) {
        const expected = { LEVEL: 'LEVEL', YOY_PCT: 'YOY_PCT', MOM_PCT: 'MOM_PCT', CHANGE: 'DIFF' }[m.valueKind];
        expect(ref.transform, `${m.code} ${ref.seriesId}`).toBe(expected);
      }
      for (const time of m.release.localTimes) expect(time).toMatch(/^\d{2}:\d{2}$/);
    }
  });

  it('documents the seasonal-adjustment choice that matches the published headline', () => {
    const cpi = INDICATOR_MAPPINGS.find((m) => m.code === 'US_CPI')!;
    expect(cpi.seasonalAdjustment).toBe('NSA');
    expect(cpi.official.map((r) => r.seriesId)).toEqual(['CUUR0000SA0']);
    const nfp = INDICATOR_MAPPINGS.find((m) => m.code === 'US_NFP')!;
    expect(nfp.seasonalAdjustment).toBe('SA');
    expect(nfp.official.map((r) => r.seriesId)).toEqual(['CES0000000001']);
  });

  it('matches provider keys case-insensitively', () => {
    const index = buildMappingIndex('tradingeconomics');
    expect(index.get(providerIndicatorKey('United States', 'Inflation Rate YoY'))?.code).toBe('US_CPI');
    expect(index.get(providerIndicatorKey('UNITED STATES', 'inflation rate yoy'))?.code).toBe('US_CPI');
    expect(index.get(providerIndicatorKey('United States', 'Inflation Rate MoM'))).toBeUndefined();
  });
});

describe('FX pair mapping table', () => {
  it('uses the pip sizes of the fx_pairs seed (JPY quote = 0.01, others 0.0001)', () => {
    for (const pair of FX_PAIR_MAPPINGS) {
      expect(pair.pipSize, pair.symbol).toBe(pair.symbol.endsWith('JPY') ? 0.01 : 0.0001);
      expect(pair.pricePrecision, pair.symbol).toBe(pair.symbol.endsWith('JPY') ? 3 : 5);
    }
  });
});

describe('speaker aliases', () => {
  it('strips roles and matches name variants within the organization only', () => {
    expect(stripRole('Vice Chair for Supervision Michelle W. Bowman ')).toBe('Michelle W. Bowman');
    expect(findSpeakerAlias('FRB', 'Chairman Kevin Warsh')?.nameJa).toBe('ケビン・ウォーシュ');
    expect(findSpeakerAlias('FRB', 'Governor Lisa D. Cook  ')?.nameJa).toBe('リサ・クック');
    expect(findSpeakerAlias('ECB', 'Kevin Warsh')).toBeUndefined();
    expect(findSpeakerAlias('FRB', 'Governor Stephen I. Miran')).toBeUndefined();
  });

  it('has no alias that resolves to two people', () => {
    const seen = new Map<string, string>();
    for (const alias of SPEAKER_ALIASES) {
      for (const form of alias.aliases) {
        const key = `${alias.organization}|${form.toLowerCase()}`;
        expect(seen.get(key) ?? alias.nameJa).toBe(alias.nameJa);
        seen.set(key, alias.nameJa);
      }
    }
  });
});
