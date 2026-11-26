import { describe, expect, it } from 'vitest';
import { buildReleaseSummaries, compareByNextRelease, normalizeKeyPoints } from '../../src/domain/indicators.js';

describe('normalizeKeyPoints', () => {
  it('returns [] for an unregistered (NULL) key_points', () => {
    expect(normalizeKeyPoints(null)).toEqual([]);
    expect(normalizeKeyPoints(undefined)).toEqual([]);
  });

  it('keeps the registered points in order, as a copy', () => {
    const points = ['インフレの動向を把握できる', '金融政策への影響が大きい'];
    const normalized = normalizeKeyPoints(points);
    expect(normalized).toEqual(points);
    expect(normalized).not.toBe(points);
  });

  it('keeps an explicitly empty array empty', () => {
    expect(normalizeKeyPoints([])).toEqual([]);
  });
});

describe('buildReleaseSummaries (SCR-005 次回発表, v1.20)', () => {
  const now = new Date('2026-10-13T00:00:00Z');

  it('picks the earliest SCHEDULED event at/after now and the latest RELEASED event', () => {
    const summaries = buildReleaseSummaries(
      ['i1'],
      [
        { id: 'e-late', indicator_id: 'i1', release_datetime: '2026-11-10T12:30:00Z' },
        { id: 'e-past', indicator_id: 'i1', release_datetime: '2026-10-03T12:30:00Z' },
        { id: 'e-next', indicator_id: 'i1', release_datetime: '2026-10-15T12:30:00Z' },
      ],
      [
        { id: 'r-old', indicator_id: 'i1', release_datetime: '2026-08-10T12:30:00Z' },
        { id: 'r-new', indicator_id: 'i1', release_datetime: '2026-09-10T12:30:00Z' },
      ],
      now,
    );
    expect(summaries.get('i1')).toEqual({
      next_release_datetime: '2026-10-15T12:30:00Z',
      next_event_id: 'e-next',
      latest_release_datetime: '2026-09-10T12:30:00Z',
      next_release_precision: null,
      latest_release_precision: null,
    });
  });

  it('counts an event exactly at now as the next release', () => {
    const summaries = buildReleaseSummaries(
      ['i1'],
      [{ id: 'e1', indicator_id: 'i1', release_datetime: '2026-10-13T00:00:00Z' }],
      [],
      now,
    );
    expect(summaries.get('i1')?.next_event_id).toBe('e1');
  });

  it('breaks a tie on the same release_datetime by event id', () => {
    const summaries = buildReleaseSummaries(
      ['i1'],
      [
        { id: 'e2', indicator_id: 'i1', release_datetime: '2026-10-15T12:30:00Z' },
        { id: 'e1', indicator_id: 'i1', release_datetime: '2026-10-15T12:30:00Z' },
      ],
      [],
      now,
    );
    expect(summaries.get('i1')?.next_event_id).toBe('e1');
  });

  it('returns all-null for an indicator with no events, and keeps indicators apart', () => {
    const summaries = buildReleaseSummaries(
      ['i1', 'i2', 'i3'],
      [{ id: 'e1', indicator_id: 'i1', release_datetime: '2026-10-15T12:30:00Z' }],
      [{ id: 'r2', indicator_id: 'i2', release_datetime: '2026-09-01T00:00:00Z' }],
      now,
    );
    expect(summaries.get('i1')).toEqual({
      next_release_datetime: '2026-10-15T12:30:00Z',
      next_event_id: 'e1',
      latest_release_datetime: null,
      next_release_precision: null,
      latest_release_precision: null,
    });
    expect(summaries.get('i2')).toEqual({
      next_release_datetime: null,
      next_event_id: null,
      latest_release_datetime: '2026-09-01T00:00:00Z',
      next_release_precision: null,
      latest_release_precision: null,
    });
    expect(summaries.get('i3')).toEqual({
      next_release_datetime: null,
      next_event_id: null,
      latest_release_datetime: null,
      next_release_precision: null,
      latest_release_precision: null,
    });
  });
});

describe('compareByNextRelease (sort=next_release)', () => {
  it('sorts by next_release_datetime ascending, nulls last, then name', () => {
    const rows = [
      { id: 'a', name: 'B指標', next_release_datetime: null },
      { id: 'b', name: 'C指標', next_release_datetime: '2026-10-20T00:00:00Z' },
      { id: 'c', name: 'A指標', next_release_datetime: null },
      { id: 'd', name: 'B指標', next_release_datetime: '2026-10-14T00:00:00Z' },
      { id: 'e', name: 'A指標', next_release_datetime: '2026-10-20T00:00:00+00:00' },
    ];
    expect([...rows].sort(compareByNextRelease).map((row) => row.id)).toEqual(['d', 'e', 'b', 'c', 'a']);
  });
});

describe('buildReleaseSummaries precision (日付だけの予定は時刻を出さない)', () => {
  it('carries the precision of the next and latest events; absent precision gives null', () => {
    const now = new Date('2026-12-01T00:00:00Z');
    const summaries = buildReleaseSummaries(
      ['boj', 'old'],
      [
        {
          id: 'e1',
          indicator_id: 'boj',
          release_datetime: '2026-12-18T03:00:00Z',
          release_datetime_precision: 'DATE_ONLY',
        },
        { id: 'e2', indicator_id: 'old', release_datetime: '2026-12-10T13:30:00Z' },
      ],
      [
        {
          id: 'e0',
          indicator_id: 'boj',
          release_datetime: '2026-10-30T03:00:00Z',
          release_datetime_precision: 'EXACT',
        },
      ],
      now,
    );
    expect(summaries.get('boj')).toMatchObject({
      next_release_precision: 'DATE_ONLY',
      latest_release_precision: 'EXACT',
    });
    expect(summaries.get('old')).toMatchObject({ next_release_precision: null, latest_release_precision: null });
  });
});
