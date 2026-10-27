/** 出典と告知(HQ判断 2026-10-27「ECBの告知」、api-design v1.38)。 */
import { describe, expect, it } from 'vitest';
import { attributionForOrganization, ECB_ATTRIBUTION, FRB_ATTRIBUTION } from '../../src/domain/attribution.js';
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
