/** HQ指示(2026-11-11「GB/AU/CA: 公式ソース・利用条件を再確認」): 英国・豪州・カナダ・日本の公式統計の出典。 */
import { describe, expect, it } from 'vitest';
import {
  ABS_ATTRIBUTION,
  attributionForIndicator,
  ESTAT_ATTRIBUTION,
  EUROSTAT_ATTRIBUTION,
  ONS_ATTRIBUTION,
  STATCAN_ATTRIBUTION,
  STATCAN_LFS_ATTRIBUTION,
} from '../../src/domain/attribution.js';

describe('attributionForIndicator: official statistics outside the US', () => {
  it('ONS indicators carry the wording ONS asks for (OGL v3.0)', () => {
    for (const code of ['GB_CPI', 'GB_CORE_CPI', 'GB_UNEMPLOYMENT_RATE']) {
      expect(attributionForIndicator(code), code).toEqual(ONS_ATTRIBUTION);
    }
    expect(ONS_ATTRIBUTION.notice).toBe(
      'Source: Office for National Statistics licensed under the Open Government Licence v.3.0',
    );
  });

  it('ABS indicators name the ABS, the copyright statement and CC BY 4.0', () => {
    for (const code of ['AU_CPI', 'AU_UNEMPLOYMENT_RATE'])
      expect(attributionForIndicator(code), code).toEqual(ABS_ATTRIBUTION);
    expect(ABS_ATTRIBUTION.notice).toContain('© Commonwealth of Australia');
    expect(ABS_ATTRIBUTION.notice).toContain('CC BY 4.0');
    expect(ABS_ATTRIBUTION.notice).toContain('https://creativecommons.org/licenses/by/4.0/');
    expect(ABS_ATTRIBUTION.notice).toContain(
      'Disclaimer: https://www.abs.gov.au/website-privacy-copyright-and-disclaimer',
    );
  });

  it('Statistics Canada: the unemployment rate names its table; CPI (schedule only) the agency; both carry the "as is" sentence', () => {
    expect(attributionForIndicator('CA_UNEMPLOYMENT_RATE')).toEqual(STATCAN_LFS_ATTRIBUTION);
    expect(STATCAN_LFS_ATTRIBUTION.notice).toContain('Table 14-10-0287-01');
    expect(attributionForIndicator('CA_CPI')).toEqual(STATCAN_ATTRIBUTION);
    for (const a of [STATCAN_ATTRIBUTION, STATCAN_LFS_ATTRIBUTION]) {
      expect(a.notice).toContain(
        'Reproduced and distributed on an "as is" basis with the permission of Statistics Canada.',
      );
    }
  });

  it('JP_CPI carries the e-Stat source; Eurostat unchanged; US indicators none', () => {
    expect(attributionForIndicator('JP_CPI')).toEqual(ESTAT_ATTRIBUTION);
    expect(attributionForIndicator('EU_HICP')).toEqual(EUROSTAT_ATTRIBUTION);
    for (const code of ['US_CPI', 'US_NFP', 'UNKNOWN', '']) expect(attributionForIndicator(code), code).toBeNull();
    expect(attributionForIndicator(null)).toBeNull();
  });

  it('never claims endorsement or official approval in the notices', () => {
    for (const a of [
      ONS_ATTRIBUTION,
      ABS_ATTRIBUTION,
      STATCAN_ATTRIBUTION,
      STATCAN_LFS_ATTRIBUTION,
      ESTAT_ATTRIBUTION,
    ]) {
      expect(a.notice ?? '', a.source).not.toMatch(/endorse|承認|公認|推奨/i);
    }
  });
});
