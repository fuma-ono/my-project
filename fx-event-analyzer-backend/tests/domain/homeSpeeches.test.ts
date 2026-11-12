import { describe, expect, it } from 'vitest';
import {
  HOME_SPEECHES_MAX,
  homeSpeechesRange,
  speakerDisplayName,
  toHomeSpeechItem,
  type HomeSpeechSource,
} from '../../src/domain/homeSpeeches.js';

const BASE_URL = 'https://api.example.com';

function speech(overrides: Partial<HomeSpeechSource> = {}): HomeSpeechSource {
  return {
    speech_id: '50000000-0000-0000-0000-000000000001',
    title: 'FOMC後の記者会見',
    summary: '政策金利の据え置きを説明した。',
    statement_datetime: '2026-10-14T18:30:00+00:00',
    speaker: {
      name: 'ジェローム・パウエル',
      title: 'FRB理事',
      organization: 'FRB',
      country_code: 'US',
      photo_url: 'speaker-photos/powell.jpg',
    },
    ...overrides,
  };
}

describe('speakerDisplayName', () => {
  it('uses the family name after the last 「・」 plus the title, like the mock', () => {
    expect(speakerDisplayName('ジェローム・パウエル', 'FRB理事')).toBe('パウエルFRB理事');
    expect(speakerDisplayName('クリスティーヌ・ラガルド', 'ECB総裁')).toBe('ラガルドECB総裁');
  });

  it('uses the whole name when it has no 「・」', () => {
    expect(speakerDisplayName('植田和男', '日本銀行総裁')).toBe('植田和男日本銀行総裁');
  });
});

describe('homeSpeechesRange', () => {
  it('is the last 7 days up to now', () => {
    const now = new Date('2026-10-15T06:00:00Z');
    expect(homeSpeechesRange(now)).toEqual({ from: new Date('2026-10-08T06:00:00Z'), to: now });
    expect(HOME_SPEECHES_MAX).toBe(3);
  });
});

describe('toHomeSpeechItem', () => {
  it('matches the mock item shape, with a resolved photo URL and null reactions', () => {
    expect(toHomeSpeechItem(speech(), BASE_URL)).toEqual({
      speech_id: '50000000-0000-0000-0000-000000000001',
      country_code: 'US',
      speaker_name: 'パウエルFRB理事',
      statement_datetime: '2026-10-14T18:30:00Z',
      headline: '政策金利の据え置きを説明した。',
      organization: 'FRB',
      speaker_photo_url: 'https://api.example.com/api/v1/speaker-photos/powell.jpg',
      reaction_fx_symbol: null,
      reaction_price_before: null,
      reaction_price_after: null,
      reaction_pips: null,
    });
  });

  it('falls back to the title when there is no (or a blank) summary; no photo → null', () => {
    const noSummary = speech({
      summary: null,
      speaker: {
        name: '植田和男',
        title: '日本銀行総裁',
        organization: '日本銀行',
        country_code: 'JP',
        photo_url: null,
      },
    });
    expect(toHomeSpeechItem(noSummary, BASE_URL)).toMatchObject({
      headline: 'FOMC後の記者会見',
      speaker_name: '植田和男日本銀行総裁',
      speaker_photo_url: null,
    });
    expect(toHomeSpeechItem(speech({ summary: '  ' }), BASE_URL).headline).toBe('FOMC後の記者会見');
  });
});
