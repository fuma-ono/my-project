import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import {
  accessFields,
  lockedEventIds,
  lockedReleaseMessage,
  nullFields,
  pastReleaseLimitFor,
  pastReleasesMaxFor,
  redactRelease,
  selectVisibleReleasedIds,
  type ReleaseCandidate,
} from '../../src/domain/pastReleaseAccess.js';
import { resolvePastReleaseAccessForPlan } from '../../src/authorization/pastReleaseAccess.js';

const IND_A = 'a0000000-0000-0000-0000-000000000000';
const IND_B = 'b0000000-0000-0000-0000-000000000000';

function released(id: string, releaseDatetime: string, indicatorId = IND_A): ReleaseCandidate {
  return { id, indicator_id: indicatorId, status: 'RELEASED', release_datetime: releaseDatetime };
}

describe('past release limits (HQ判断 2026-10-22)', () => {
  it('FREE caps at 3, PRO has no cap', () => {
    expect(pastReleasesMaxFor('FREE')).toBe(3);
    expect(pastReleasesMaxFor('PRO')).toBeNull();
    expect(pastReleaseLimitFor('FREE')).toEqual({ applied: true, max_for_plan: 3, pro_max: null });
    expect(pastReleaseLimitFor('PRO')).toEqual({ applied: false, max_for_plan: null, pro_max: null });
  });
});

describe('selectVisibleReleasedIds', () => {
  it('keeps the 3 most recent releases per indicator', () => {
    const events = [
      released('e1', '2026-01-10T13:30:00Z'),
      released('e2', '2026-02-10T13:30:00Z'),
      released('e3', '2026-03-10T13:30:00Z'),
      released('e4', '2026-04-10T13:30:00Z'),
      released('e5', '2026-05-10T13:30:00Z'),
    ];
    expect([...selectVisibleReleasedIds(events, 3)].sort()).toEqual(['e3', 'e4', 'e5']);
  });

  it('breaks ties on release_datetime by id ascending', () => {
    const events = [
      released('e-c', '2026-05-10T13:30:00Z'),
      released('e-a', '2026-05-10T13:30:00Z'),
      released('e-d', '2026-05-10T13:30:00Z'),
      released('e-b', '2026-05-10T13:30:00Z'),
    ];
    expect([...selectVisibleReleasedIds(events, 3)].sort()).toEqual(['e-a', 'e-b', 'e-c']);
  });

  it('compares instants, not strings (offsets)', () => {
    const events = [
      released('late', '2026-05-10T09:00:00+09:00'), // 00:00Z
      released('early', '2026-05-09T23:00:00Z'),
    ];
    expect([...selectVisibleReleasedIds(events, 1)]).toEqual(['late']);
  });

  it('shows every release when there are fewer than 3', () => {
    const events = [released('e1', '2026-01-10T13:30:00Z'), released('e2', '2026-02-10T13:30:00Z')];
    expect([...selectVisibleReleasedIds(events, 3)].sort()).toEqual(['e1', 'e2']);
  });

  it('never counts SCHEDULED (or CANCELLED) events', () => {
    const events = [
      released('e1', '2026-01-10T13:30:00Z'),
      released('e2', '2026-02-10T13:30:00Z'),
      released('e3', '2026-03-10T13:30:00Z'),
      { id: 's1', indicator_id: IND_A, status: 'SCHEDULED', release_datetime: '2026-06-10T13:30:00Z' },
      { id: 'c1', indicator_id: IND_A, status: 'CANCELLED', release_datetime: '2026-05-10T13:30:00Z' },
    ];
    expect([...selectVisibleReleasedIds(events, 3)].sort()).toEqual(['e1', 'e2', 'e3']);
  });

  it('counts each indicator separately', () => {
    const events = [
      released('a1', '2026-01-10T13:30:00Z'),
      released('a2', '2026-02-10T13:30:00Z'),
      released('b1', '2025-01-10T13:30:00Z', IND_B),
      released('b2', '2025-02-10T13:30:00Z', IND_B),
    ];
    expect([...selectVisibleReleasedIds(events, 1)].sort()).toEqual(['a2', 'b2']);
  });
});

describe('lockedEventIds', () => {
  const page = [
    { id: 's1', status: 'SCHEDULED' },
    { id: 'e5', status: 'RELEASED' },
    { id: 'e2', status: 'RELEASED' },
    { id: 'e1', status: 'RELEASED' },
  ];

  it('locks RELEASED events outside the visible set, never SCHEDULED', () => {
    expect([...lockedEventIds(page, new Set(['e5', 'e4', 'e3']))].sort()).toEqual(['e1', 'e2']);
  });

  it('PRO (no cap, visibleIds = null) locks nothing', () => {
    expect(lockedEventIds(page, null).size).toBe(0);
  });
});

describe('redactRelease', () => {
  const item = {
    event_id: 'e1',
    release_datetime: '2026-01-10T13:30:00Z',
    release_datetime_precision: 'EXACT',
    status: 'RELEASED',
    data_status: 'READY',
    importance: 'HIGH',
    forecast: 1.1,
    actual: 1.3,
    previous: 1.0,
    surprise: 0.2,
    surprise_direction: 'POSITIVE',
  };

  it('nulls the values and keeps dates, status and data_status when locked', () => {
    expect(redactRelease(item, true)).toEqual({
      event_id: 'e1',
      release_datetime: '2026-01-10T13:30:00Z',
      release_datetime_precision: 'EXACT',
      status: 'RELEASED',
      data_status: 'READY',
      importance: 'HIGH',
      forecast: null,
      actual: null,
      previous: null,
      surprise: null,
      surprise_direction: null,
      locked: true,
      required_plan: 'PRO',
    });
    // The input is not mutated.
    expect(item.actual).toBe(1.3);
  });

  it('keeps everything and marks unlocked items', () => {
    expect(redactRelease(item, false)).toEqual({ ...item, locked: false, required_plan: null });
  });

  it('does not add value fields that the item does not have', () => {
    expect(redactRelease({ event_id: 'e1', actual: 2 }, true)).toEqual({
      event_id: 'e1',
      actual: null,
      locked: true,
      required_plan: 'PRO',
    });
  });

  it('nullFields only touches the given fields', () => {
    expect(nullFields({ actual: 1, unit: '%', source: 'BLS' }, ['actual'])).toEqual({
      actual: null,
      unit: '%',
      source: 'BLS',
    });
  });

  it('accessFields', () => {
    expect(accessFields(true)).toEqual({ locked: true, required_plan: 'PRO' });
    expect(accessFields(false)).toEqual({ locked: false, required_plan: null });
  });

  it('the 403 message mentions the cap and PRO', () => {
    expect(lockedReleaseMessage('FREE')).toContain('3 most recent');
    expect(lockedReleaseMessage('FREE')).toContain('PRO');
  });
});

describe('resolvePastReleaseAccessForPlan', () => {
  function fakeRpc(visible: string[]) {
    const rpc = vi.fn(() => Promise.resolve({ data: visible.map((id) => ({ event_id: id })), error: null }));
    return { client: { rpc } as unknown as SupabaseClient, rpc };
  }

  const events = [
    { id: 's1', indicator_id: IND_A, status: 'SCHEDULED' },
    { id: 'e4', indicator_id: IND_A, status: 'RELEASED' },
    { id: 'e1', indicator_id: IND_A, status: 'RELEASED' },
    { id: 'b1', indicator_id: IND_B, status: 'RELEASED' },
  ];

  it('FREE: asks the DB function for the visible ids (unique indicators, limit 3)', async () => {
    const { client, rpc } = fakeRpc(['e4', 'b1']);
    const locked = await resolvePastReleaseAccessForPlan(client, 'FREE', events);
    expect([...locked]).toEqual(['e1']);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('visible_released_event_ids', { p_indicator_ids: [IND_A, IND_B], p_limit: 3 });
  });

  it('PRO: never calls the DB function and locks nothing', async () => {
    const { client, rpc } = fakeRpc([]);
    expect((await resolvePastReleaseAccessForPlan(client, 'PRO', events)).size).toBe(0);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('FREE with no RELEASED event on the page: no DB call', async () => {
    const { client, rpc } = fakeRpc([]);
    expect((await resolvePastReleaseAccessForPlan(client, 'FREE', [events[0]!])).size).toBe(0);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('propagates a DB error', async () => {
    const client = {
      rpc: () => Promise.resolve({ data: null, error: new Error('boom') }),
    } as unknown as SupabaseClient;
    await expect(resolvePastReleaseAccessForPlan(client, 'FREE', events)).rejects.toThrow('boom');
  });
});
