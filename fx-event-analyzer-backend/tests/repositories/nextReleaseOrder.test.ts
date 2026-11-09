import { describe, expect, it } from 'vitest';
import {
  getLatestEvent,
  listEventsForIndicator,
  resolveIndicatorEventsOrder,
} from '../../src/repositories/indicatorsRepository.js';
import { searchEventsByIndicator } from '../../src/repositories/searchRepository.js';
import { fakeSupabaseClient } from '../helpers/fakeSupabaseClient.js';

// v1.31「次の発表」: 未来の予定(BLS・FOMC)が入っても、いちばん先の予定を「次」や「最新」にしない。
// 時刻は米東部 8:30 の夏時間(12:30Z)・冬時間(13:30Z)が混ざる並び。
const NOW = new Date('2026-10-22T00:00:00Z');

function event(id: string, releaseDatetime: string, status: string, indicatorId = 'cpi') {
  return {
    id,
    indicator_id: indicatorId,
    release_datetime: releaseDatetime,
    release_datetime_precision: 'EXACT',
    importance: 'HIGH',
    status,
    data_status: status === 'RELEASED' ? 'AVAILABLE' : 'PENDING',
    event_snapshots: [],
  };
}

// 挿入順はわざと日付順にしない(並べ替えを確かめるため)。
const CPI_EVENTS = [
  event('cpi-2027-12', '2027-12-10T13:30:00Z', 'SCHEDULED'), // 冬時間
  event('cpi-2026-09', '2026-09-10T12:30:00Z', 'RELEASED'), // 夏時間
  event('cpi-2026-11', '2026-11-10T13:30:00Z', 'SCHEDULED'), // 冬時間(11/1 に切り替え後)
  event('cpi-2027-04', '2027-04-13T12:30:00Z', 'SCHEDULED'), // 夏時間(3/14 に切り替え後)
  event('cpi-2026-10-due', '2026-10-15T12:30:00Z', 'SCHEDULED'), // 時刻を過ぎた取り込み待ち
  event('cpi-2026-08', '2026-08-12T12:30:00Z', 'RELEASED'),
];

const ids = (rows: Array<{ id: string }>) => rows.map((row) => row.id);
const page = { page: 1, limit: 20 };

describe('resolveIndicatorEventsOrder (§13.3 order, v1.31)', () => {
  it('defaults to asc for SCHEDULED and desc otherwise; an explicit order wins', () => {
    expect(resolveIndicatorEventsOrder({ status: 'SCHEDULED' })).toBe('asc');
    expect(resolveIndicatorEventsOrder({ status: 'RELEASED' })).toBe('desc');
    expect(resolveIndicatorEventsOrder({})).toBe('desc');
    expect(resolveIndicatorEventsOrder({ status: 'SCHEDULED', order: 'desc' })).toBe('desc');
    expect(resolveIndicatorEventsOrder({ status: 'RELEASED', order: 'asc' })).toBe('asc');
  });
});

describe('listEventsForIndicator — 次の発表 (v1.31)', () => {
  it('status=SCHEDULED&from=now&limit=1 returns the nearest future release, across the DST change', async () => {
    const supabase = fakeSupabaseClient({ economic_events: CPI_EVENTS });
    const { rows, total } = await listEventsForIndicator(
      supabase,
      'cpi',
      { status: 'SCHEDULED', from: NOW.toISOString() },
      { page: 1, limit: 1 },
    );
    expect(ids(rows)).toEqual(['cpi-2026-11']);
    expect(total).toBe(3);
  });

  it('lists several future releases nearest first (12:30Z and 13:30Z mixed)', async () => {
    const supabase = fakeSupabaseClient({ economic_events: CPI_EVENTS });
    const { rows } = await listEventsForIndicator(
      supabase,
      'cpi',
      { status: 'SCHEDULED', from: NOW.toISOString() },
      page,
    );
    expect(ids(rows)).toEqual(['cpi-2026-11', 'cpi-2027-04', 'cpi-2027-12']);
  });

  it('without from, a past-due SCHEDULED row comes first — the app always sends from=now', async () => {
    const supabase = fakeSupabaseClient({ economic_events: CPI_EVENTS });
    const { rows } = await listEventsForIndicator(supabase, 'cpi', { status: 'SCHEDULED' }, { page: 1, limit: 1 });
    expect(ids(rows)).toEqual(['cpi-2026-10-due']);
  });

  it('returns nothing (never a past release) when there is no future schedule', async () => {
    const supabase = fakeSupabaseClient({
      economic_events: CPI_EVENTS.filter((row) => row.status === 'RELEASED' || row.id === 'cpi-2026-10-due'),
    });
    const { rows, total } = await listEventsForIndicator(
      supabase,
      'cpi',
      { status: 'SCHEDULED', from: NOW.toISOString() },
      { page: 1, limit: 1 },
    );
    expect(rows).toEqual([]);
    expect(total).toBe(0);
  });

  it('keeps the release history newest first (status=RELEASED and no status)', async () => {
    const supabase = fakeSupabaseClient({ economic_events: CPI_EVENTS });
    const released = await listEventsForIndicator(supabase, 'cpi', { status: 'RELEASED' }, page);
    expect(ids(released.rows)).toEqual(['cpi-2026-09', 'cpi-2026-08']);
    const all = await listEventsForIndicator(fakeSupabaseClient({ economic_events: CPI_EVENTS }), 'cpi', {}, page);
    expect(ids(all.rows)).toEqual([
      'cpi-2027-12',
      'cpi-2027-04',
      'cpi-2026-11',
      'cpi-2026-10-due',
      'cpi-2026-09',
      'cpi-2026-08',
    ]);
  });
});

describe('getLatestEvent (§13.2 latest_event, v1.31)', () => {
  it('is the newest event at or before now, not the farthest future schedule', async () => {
    const supabase = fakeSupabaseClient({ economic_events: CPI_EVENTS });
    const latest = await getLatestEvent(supabase, 'cpi', NOW);
    expect(latest?.id).toBe('cpi-2026-10-due');
  });

  it('is null when the indicator only has future schedules', async () => {
    const supabase = fakeSupabaseClient({
      economic_events: CPI_EVENTS.filter((row) => Date.parse(row.release_datetime) > NOW.getTime()),
    });
    expect(await getLatestEvent(supabase, 'cpi', NOW)).toBeNull();
  });
});

describe('searchEventsByIndicator (§23, v1.31)', () => {
  const indicators = [
    {
      id: 'cpi',
      code: 'US_CPI',
      name: '米国CPI',
      display_name: null,
      country_code: 'US',
      currency_code: 'USD',
      is_active: true,
    },
    {
      id: 'core',
      code: 'US_CORE_CPI',
      name: '米国コアCPI',
      display_name: null,
      country_code: 'US',
      currency_code: 'USD',
      is_active: true,
    },
  ];
  const coreEvents = [
    event('core-2026-11', '2026-11-10T13:30:00Z', 'SCHEDULED', 'core'),
    event('core-2027-01', '2027-01-13T13:30:00Z', 'SCHEDULED', 'core'),
    event('core-2026-09', '2026-09-10T12:30:00Z', 'RELEASED', 'core'),
  ];

  it('puts each indicator’s next schedule first (nearest first, one each), then past events newest first', async () => {
    const supabase = fakeSupabaseClient({
      economic_indicators: indicators,
      economic_events: [...CPI_EVENTS, ...coreEvents],
    });
    const rows = await searchEventsByIndicator(supabase, 'CPI', 20, NOW);
    expect(ids(rows)).toEqual([
      'cpi-2026-11',
      'core-2026-11',
      'cpi-2026-10-due',
      'cpi-2026-09',
      'core-2026-09',
      'cpi-2026-08',
    ]);
    expect(ids(rows)).not.toContain('cpi-2027-12');
  });

  it('never fills the result with far-future schedules when the limit is small', async () => {
    const supabase = fakeSupabaseClient({ economic_indicators: indicators, economic_events: CPI_EVENTS });
    const rows = await searchEventsByIndicator(supabase, 'CPI', 2, NOW);
    expect(ids(rows)).toEqual(['cpi-2026-11', 'cpi-2026-10-due']);
  });

  it('returns only past events when there is no future schedule', async () => {
    const supabase = fakeSupabaseClient({
      economic_indicators: indicators,
      economic_events: CPI_EVENTS.filter((row) => row.status === 'RELEASED'),
    });
    const rows = await searchEventsByIndicator(supabase, 'CPI', 20, NOW);
    expect(ids(rows)).toEqual(['cpi-2026-09', 'cpi-2026-08']);
  });
});
