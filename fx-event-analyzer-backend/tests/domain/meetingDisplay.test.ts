import { describe, expect, it } from 'vitest';
import { buildEventMeeting, isMeetingProvider } from '../../src/domain/meetingDisplay.js';
import { getEventMeetingRow } from '../../src/repositories/eventsRepository.js';
import { fakeSupabaseClient } from '../helpers/fakeSupabaseClient.js';

const ROW = {
  meeting_start_date: '2026-12-17',
  meeting_end_date: '2026-12-18',
  source_url: 'https://www.boj.or.jp/mopo/mpmsche_minu/index.htm',
};

describe('buildEventMeeting', () => {
  it('BOJ: period, source name and official https link only (no time, no values)', () => {
    expect(buildEventMeeting('boj_meeting_schedule', ROW)).toEqual({
      start_date: '2026-12-17',
      end_date: '2026-12-18',
      source_url: ROW.source_url,
      source_name: '日本銀行',
    });
  });

  it('ECB: source name is 欧州中央銀行(ECB)', () => {
    const meeting = buildEventMeeting('ecb_meeting_schedule', { ...ROW, source_url: 'https://www.ecb.europa.eu/x' });
    expect(meeting?.source_name).toBe('欧州中央銀行(ECB)');
  });

  it('other providers, a missing row, a non-https URL or a reversed period give null', () => {
    expect(isMeetingProvider('fomc_schedule')).toBe(false);
    expect(isMeetingProvider(null)).toBe(false);
    expect(buildEventMeeting('fomc_schedule', ROW)).toBeNull();
    expect(buildEventMeeting('boj_meeting_schedule', null)).toBeNull();
    expect(buildEventMeeting('boj_meeting_schedule', { ...ROW, source_url: 'http://www.boj.or.jp/' })).toBeNull();
    expect(buildEventMeeting('boj_meeting_schedule', { ...ROW, meeting_end_date: '2026-12-16' })).toBeNull();
    expect(buildEventMeeting('boj_meeting_schedule', { ...ROW, meeting_start_date: 'bad' })).toBeNull();
  });
});

describe('getEventMeetingRow', () => {
  it('returns the row for the event, null when there is none (or the table is absent)', async () => {
    const supabase = fakeSupabaseClient({ economic_event_meetings: [{ event_id: 'e1', ...ROW }] });
    expect(await getEventMeetingRow(supabase, 'e1')).toMatchObject(ROW);
    expect(await getEventMeetingRow(supabase, 'e2')).toBeNull();
    expect(await getEventMeetingRow(fakeSupabaseClient({}), 'e1')).toBeNull();
  });
});
