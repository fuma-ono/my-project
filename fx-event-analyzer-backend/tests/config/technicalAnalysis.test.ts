import { describe, expect, it } from 'vitest';
import { loadEnv } from '../../src/config/env.js';
import { isTechnicalAnalysisEnabled } from '../../src/config/technicalAnalysis.js';

const required = { SUPABASE_URL: 'http://127.0.0.1:54321', SUPABASE_SERVICE_ROLE_KEY: 'service-role-key' };

describe('TECHNICAL_ANALYSIS_ENABLED', () => {
  it("is enabled only by the exact string 'true'", () => {
    expect(isTechnicalAnalysisEnabled({ TECHNICAL_ANALYSIS_ENABLED: 'true' })).toBe(true);
    for (const value of [undefined, '', 'false', 'TRUE', 'True', '1', 'yes', ' true']) {
      expect(isTechnicalAnalysisEnabled({ TECHNICAL_ANALYSIS_ENABLED: value }), String(value)).toBe(false);
    }
    expect(isTechnicalAnalysisEnabled({})).toBe(false);
  });

  it('loadEnv defaults to false, reads true, and is independent of PRICE_FEATURES_ENABLED', () => {
    expect(loadEnv(required).TECHNICAL_ANALYSIS_ENABLED).toBe(false);
    expect(loadEnv({ ...required, TECHNICAL_ANALYSIS_ENABLED: 'true' }).TECHNICAL_ANALYSIS_ENABLED).toBe(true);
    expect(loadEnv({ ...required, TECHNICAL_ANALYSIS_ENABLED: '1' }).TECHNICAL_ANALYSIS_ENABLED).toBe(false);
    expect(loadEnv({ ...required, TECHNICAL_ANALYSIS_ENABLED: 'true' }).PRICE_FEATURES_ENABLED).toBe(false);
  });
});
