import { describe, expect, it } from 'vitest';
import { loadEnv } from '../../src/config/env.js';
import { parseSpeechTextExposed } from '../../src/config/speechText.js';
import { applySpeechTextPolicy } from '../../src/domain/speechTextPolicy.js';
import type { SpeechSummary } from '../../src/repositories/speechesRepository.js';

const required = { SUPABASE_URL: 'http://127.0.0.1:54321', SUPABASE_SERVICE_ROLE_KEY: 'service-role-key' };

function speech(): SpeechSummary {
  return {
    speech_id: '50000000-0000-0000-0000-000000000001',
    speaker: {
      speaker_id: 's1',
      name: 'Jerome Powell',
      title: 'Chair',
      organization: 'FRB',
      country_code: 'US',
      currency_code: 'USD',
      photo_url: null,
    },
    title: 'Press Conference',
    summary: 'The Committee decided to keep the target range.',
    summary_status: 'READY',
    summary_method: 'EXTRACTIVE_EN',
    statement_datetime: '2026-10-14T18:30:00+00:00',
    importance: 'HIGH',
    status: 'DELIVERED',
    attribution: null,
    statement_time_precision: 'EXACT',
    source_url: 'https://www.federalreserve.gov/x.htm',
    body_status: 'FETCHED',
  };
}

describe('SPEECH_TEXT_EXPOSED (オーナー決定 2026-11-25)', () => {
  it("is enabled only by the exact string 'true'", () => {
    expect(parseSpeechTextExposed('true')).toBe(true);
    for (const value of [undefined, '', 'false', 'TRUE', '1', ' true']) {
      expect(parseSpeechTextExposed(value), String(value)).toBe(false);
    }
    expect(loadEnv(required).SPEECH_TEXT_EXPOSED).toBe(false);
    expect(loadEnv({ ...required, SPEECH_TEXT_EXPOSED: 'true' }).SPEECH_TEXT_EXPOSED).toBe(true);
  });

  it('off: removes summary / method / body status, keeps title, speaker, date and source_url', () => {
    const result = applySpeechTextPolicy(speech(), false);
    expect(result).toMatchObject({
      summary: null,
      summary_status: 'NOT_AVAILABLE',
      summary_method: null,
      body_status: 'NOT_APPLICABLE',
      title: 'Press Conference',
      source_url: 'https://www.federalreserve.gov/x.htm',
      statement_datetime: '2026-10-14T18:30:00+00:00',
    });
    expect(result.speaker.name).toBe('Jerome Powell');
  });

  it('on: leaves the speech unchanged', () => {
    expect(applySpeechTextPolicy(speech(), true)).toEqual(speech());
  });
});
