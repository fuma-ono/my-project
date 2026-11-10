/** 出典と告知(HQ判断 2026-10-27「ECBの告知」、api-design v1.38)。 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  attributionForIndicator,
  attributionForOrganization,
  BLS_ATTRIBUTION,
  BLS_INDICATOR_CODES,
  ECB_ATTRIBUTION,
  FRB_ATTRIBUTION,
  NY_FED_SOURCE,
  nyFedAttribution,
} from '../../src/domain/attribution.js';
import {
  CPI_RELEASE_INDICATORS,
  EMPSIT_RELEASE_INDICATORS,
  JOLTS_RELEASE_INDICATORS,
  PPI_RELEASE_INDICATORS,
} from '../../src/ingestion/mappings/blsSchedule.js';
import { buildCalendarItems } from '../../src/domain/calendar.js';

describe('attributionForOrganization', () => {
  it('ECB: source + the free-of-charge notice the ECB terms require', () => {
    expect(attributionForOrganization('ECB')).toEqual({
      source: '欧州中央銀行（ECB）',
      source_url: 'https://www.ecb.europa.eu',
      notice: 'この情報は ECB のウェブサイト（www.ecb.europa.eu）で無料で入手できます。',
    });
  });

  it('FRB: source only (public domain, citation requested); others: none', () => {
    expect(attributionForOrganization('FRB')).toEqual({ ...FRB_ATTRIBUTION, notice: null });
    expect(attributionForOrganization('日本銀行')).toBeNull();
    expect(attributionForOrganization(undefined)).toBeNull();
  });
});

// HQ指示(2026-11-10「指標の全量表示」): 情報源を出す。BLS は出典と規約の免責文が必須(data-sources.md 11章)。
describe('attributionForIndicator', () => {
  it('BLS indicators: the BLS source and the disclaimer the BLS terms require', () => {
    for (const code of [
      'US_CPI',
      'US_CORE_CPI',
      'US_NFP',
      'US_UNEMPLOYMENT_RATE',
      'US_AVG_HOURLY_EARNINGS',
      'US_PPI',
      'US_CORE_PPI',
      'US_JOLTS',
    ]) {
      expect(attributionForIndicator(code), code).toEqual(BLS_ATTRIBUTION);
    }
    expect(BLS_ATTRIBUTION.notice).toContain(
      'BLS.gov cannot vouch for the data or analyses derived from these data after the data have been retrieved from BLS.gov.',
    );
  });

  it('the BLS codes are exactly the indicators the BLS schedule ingests (no drift)', () => {
    const scheduled = new Set([
      ...CPI_RELEASE_INDICATORS,
      ...EMPSIT_RELEASE_INDICATORS,
      ...PPI_RELEASE_INDICATORS,
      ...JOLTS_RELEASE_INDICATORS,
    ]);
    expect([...BLS_INDICATOR_CODES].sort()).toEqual([...scheduled].sort());
  });

  it('FOMC meetings and minutes: the FRB source only; Eurostat unchanged', () => {
    expect(attributionForIndicator('US_FOMC')).toEqual(FRB_ATTRIBUTION);
    expect(attributionForIndicator('US_FOMC_MINUTES')).toEqual(FRB_ATTRIBUTION);
    expect(attributionForIndicator('EU_HICP')?.source).toBe('Eurostat（欧州連合統計局）');
  });

  it('sources whose terms are not confirmed get none (no guessed attribution)', () => {
    for (const code of ['US_RETAIL_SALES', 'JP_CPI', 'BOJ_RATE', 'UNKNOWN', null, undefined]) {
      expect(attributionForIndicator(code), String(code)).toBeNull();
    }
  });
});

describe('calendar items carry the attribution of the speaker organization', () => {
  it('ECB speech → ECB attribution; indicator → null', () => {
    const items = buildCalendarItems(
      [],
      [
        {
          speech_id: 's-lane',
          title: '講演: Keynote speech',
          speaker: { name: 'フィリップ・レーン', country_code: 'EU', currency_code: 'EUR', organization: 'ECB' },
          importance: 'MEDIUM',
          statement_datetime: '2026-10-30T16:10:00+00:00',
          status: 'SCHEDULED',
        },
      ],
    );
    expect(items[0]!.attribution).toEqual(ECB_ATTRIBUTION);
  });
});

// HQ指示(2026-11-05「NY連銀の出典表示の軽微な修正」): 著作権の表示の年は固定にせず、応答を作るときの年(UTC)。
describe('nyFedAttribution', () => {
  afterEach(() => vi.useRealTimers());

  it('puts the year of `now` (UTC) into the copyright line', () => {
    expect(nyFedAttribution(new Date('2027-03-01T00:00:00Z')).notice).toContain(
      '© 2027 Federal Reserve Bank of New York. Content from the New York Fed subject to the Terms of Use at newyorkfed.org.',
    );
    expect(nyFedAttribution(new Date('2027-03-01T00:00:00Z')).notice).not.toContain('© 2026');
    // 年の変わり目は UTC で決める
    expect(nyFedAttribution(new Date('2027-12-31T23:59:59Z')).notice).toContain('© 2027 ');
    expect(nyFedAttribution(new Date('2028-01-01T00:00:00Z')).notice).toContain('© 2028 ');
  });

  it('follows the current year by default (no fixed year)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2029-06-15T12:00:00Z'));
    expect(nyFedAttribution().notice).toContain('© 2029 Federal Reserve Bank of New York.');
  });

  it('keeps the source, the link and the rest of the notice as they were', () => {
    const attribution = nyFedAttribution(new Date('2026-11-05T00:00:00Z'));
    expect(attribution.source).toBe(NY_FED_SOURCE);
    expect(attribution.source_url).toBe('https://www.newyorkfed.org/markets/reference-rates/effr');
    expect(attribution.notice).toContain('誘導目標レンジは FOMC（米連邦公開市場委員会）が決定するもので');
    expect(attribution.notice).toContain('EFFR（実際の取引の金利）の値は表示していません。');
    // HQ指示(2026-11-06「NY連銀の規約対応」修正案1): FOMC 会合との対応付けは本アプリが行っていることを明示する
    expect(attribution.notice).toContain(
      'FOMC会合との対応付け（発表日の翌営業日以降で最初に有効になったレンジ）は、本アプリが行っています。',
    );
    expect(attribution.notice).toContain(
      '© 2026 Federal Reserve Bank of New York. Content from the New York Fed subject to the Terms of Use at newyorkfed.org.',
    );
    expect(attribution.notice).toContain(
      'The New York Fed is not responsible for publication of the federal funds target range data by FX Event Analyzer, does not sanction or endorse any particular republication, and has no liability for your use.',
    );
    expect(attribution.notice).toContain(
      'FX Event Analyzer is not affiliated with the New York Fed. The New York Fed does not sanction, endorse, or recommend any products or services offered by FX Event Analyzer.',
    );
  });
});
