/** 出典と告知(HQ判断 2026-10-27「ECBの告知」、api-design v1.38)。 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  attributionForOrganization,
  ECB_ATTRIBUTION,
  FRB_ATTRIBUTION,
  NY_FED_SOURCE,
  nyFedAttribution,
} from '../../src/domain/attribution.js';
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
