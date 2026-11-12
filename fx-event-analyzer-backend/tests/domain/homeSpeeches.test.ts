import { FRB_ATTRIBUTION } from '../../src/domain/attribution.js';
import { describe, expect, it } from 'vitest';
import {
  HOME_SPEECHES_MAX,
  homeSpeechesRange,
  readHomeSpeechRunsSafely,
  speakerDisplayName,
  toHomeSpeechesStatus,
  UNAVAILABLE_HOME_SPEECHES_STATUS,
  toHomeSpeechItem,
  type HomeSpeechSource,
} from '../../src/domain/homeSpeeches.js';
import type { SpeechRunSample } from '../../src/ingestion/quality/metrics.js';

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
      attribution: FRB_ATTRIBUTION, // api-design v1.38
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

describe('toHomeSpeechesStatus (GET /home speeches_status, v1.34)', () => {
  const now = new Date('2026-10-23T06:00:00Z');
  const run = (overrides: Partial<SpeechRunSample> = {}): SpeechRunSample => ({
    job: 'ingest:speeches',
    provider: 'frb_calendar',
    data_type: 'OTHER',
    started_at: '2026-10-23T03:00:00.000Z',
    completed_at: '2026-10-23T03:00:04.512Z',
    status: 'SUCCESS',
    fetched_count: 40,
    success_count: 6,
    error_count: 0,
    details: { skip_reasons: {} },
    ...overrides,
  });

  it('is not stale after a recent SUCCESS, with the completion time in ISO seconds', () => {
    expect(toHomeSpeechesStatus([run()], now)).toEqual({
      window_days: 7,
      last_success_at: '2026-10-23T03:00:04Z',
      stale: false,
    });
  });

  it('is stale when the latest run failed after a SUCCESS (keeps that SUCCESS time)', () => {
    const failure = run({
      started_at: '2026-10-23T05:00:00.000Z',
      completed_at: '2026-10-23T05:00:01.000Z',
      status: 'FAILURE',
      fetched_count: 0,
      success_count: 0,
      error_count: 1,
    });
    expect(toHomeSpeechesStatus([run(), failure], now)).toEqual({
      window_days: 7,
      last_success_at: '2026-10-23T03:00:04Z',
      stale: true,
    });
  });

  it('is stale when the last SUCCESS is 18 hours old or more', () => {
    const old = run({ started_at: '2026-10-22T11:59:00.000Z', completed_at: '2026-10-22T12:00:00.000Z' });
    expect(toHomeSpeechesStatus([old], now).stale).toBe(true);
  });

  it('is stale with last_success_at null when there are no logs at all', () => {
    expect(toHomeSpeechesStatus([], now)).toEqual({ window_days: 7, last_success_at: null, stale: true });
  });
});

// HQ承認(2026-10-23)「/home の鮮度情報の読み取り失敗」: 失敗しても throw せず stale を返す。
describe('readHomeSpeechRunsSafely / UNAVAILABLE_HOME_SPEECHES_STATUS', () => {
  const capture = () => {
    const calls: Array<{ details: unknown; message: string }> = [];
    return { calls, log: { warn: (details: unknown, message: string) => calls.push({ details, message }) } };
  };

  it('returns the rows and logs nothing when the read succeeds', async () => {
    const { calls, log } = capture();
    await expect(readHomeSpeechRunsSafely(() => Promise.resolve(['row']), log)).resolves.toEqual(['row']);
    expect(calls).toEqual([]);
  });

  it('returns null and logs only the error name and code (no message, URL or key) when the read fails', async () => {
    const { calls, log } = capture();
    const error = Object.assign(new Error('connect to https://secret.example.supabase.co with key sb_secret_xxx'), {
      code: 'PGRST301',
    });
    await expect(readHomeSpeechRunsSafely(() => Promise.reject(error), log)).resolves.toBeNull();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.details).toEqual({ error_name: 'Error', error_code: 'PGRST301' });
    expect(JSON.stringify(calls)).not.toContain('secret');
    expect(JSON.stringify(calls)).not.toContain('sb_secret');
  });

  it('handles a non-Error rejection', async () => {
    const { calls, log } = capture();
    await expect(
      readHomeSpeechRunsSafely(() => {
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- Error 以外で失敗する場合を確かめる
        return Promise.reject('boom');
      }, log),
    ).resolves.toBeNull();
    expect(calls[0]!.details).toEqual({ error_name: null, error_code: null });
  });

  it('maps null runs to { window_days: 7, last_success_at: null, stale: true }', () => {
    expect(toHomeSpeechesStatus(null, new Date('2026-10-23T00:00:00Z'))).toEqual({
      window_days: 7,
      last_success_at: null,
      stale: true,
    });
    expect(UNAVAILABLE_HOME_SPEECHES_STATUS).toEqual({ window_days: 7, last_success_at: null, stale: true });
  });
});
