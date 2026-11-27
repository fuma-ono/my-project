import { describe, expect, it } from 'vitest';
import { buildWindowHistory, type HistorySampleInput } from '../../../src/domain/reactionClassification/history.js';
import {
  type OverlapCandidate,
  overlapsBeforeRelease,
  overlapsInWindow,
  relevantCandidates,
} from '../../../src/domain/reactionClassification/overlap.js';
import {
  deriveParams,
  getParamSet,
  paramsHash,
  publicParams,
  REACTION_PARAM_SETS,
  RX_V1,
} from '../../../src/domain/reactionClassification/params.js';

const MIN = 60_000;
const T = Date.parse('2030-01-10T13:30:00Z');

const cand = (over: Partial<OverlapCandidate> & { id: string; minutes: number }): OverlapCandidate => {
  const { minutes, ...rest } = over;
  return {
    kind: 'SPEECH',
    datetimeMs: T + minutes * MIN,
    currency: 'USD',
    importance: 'HIGH',
    timeUncertain: false,
    ...rest,
  };
};

describe('overlap', () => {
  const items: OverlapCandidate[] = [
    cand({ id: 'a', minutes: 30 }),
    cand({ id: 'b', minutes: 30, currency: 'EUR' }),
    cand({ id: 'c', minutes: 61 }),
    cand({ id: 'd', minutes: 10, kind: 'EVENT', importance: 'LOW', eventId: 'ev-d' }),
    cand({ id: 'same-time', minutes: 0, kind: 'EVENT', eventId: 'ev-t' }),
    cand({ id: 'group-mate', minutes: 5, kind: 'EVENT', eventId: 'ev-group' }),
    cand({ id: 'medium', minutes: 15, importance: 'MEDIUM' }),
    cand({ id: 'approx', minutes: 20, kind: 'EVENT', eventId: 'ev-x', timeUncertain: true, name: 'Approximate event' }),
    cand({ id: 'pre', minutes: -30 }),
    cand({ id: 'pre-edge', minutes: -60 }),
  ];
  const relevant = relevantCandidates(items, ['USD', 'JPY'], 'MEDIUM', new Set(['ev-group']));

  it('keeps only pair currencies, importance >= MEDIUM and drops the target group', () => {
    expect(relevant.map((c) => c.id).sort()).toEqual(
      ['a', 'approx', 'c', 'medium', 'pre', 'pre-edge', 'same-time'].sort(),
    );
  });

  it('a window holds only (T, T+n]: window 15 does not pick up the +30 item, the end is inclusive', () => {
    expect(overlapsInWindow(relevant, T, 15).map((i) => i.id)).toEqual(['medium']);
    expect(overlapsInWindow(relevant, T, 30).map((i) => i.id)).toEqual(['medium', 'approx', 'a']);
    expect(overlapsInWindow(relevant, T, 60).map((i) => i.id)).toEqual(['medium', 'approx', 'a']);
    expect(overlapsInWindow(relevant, T, 1)).toEqual([]);
    expect(overlapsInWindow(relevant, T, 5)).toEqual([]);
  });

  it('an item at exactly T (a simultaneous release) is never an overlap', () => {
    expect(overlapsInWindow(relevant, T, 60).some((i) => i.id === 'same-time')).toBe(false);
  });

  it('item fields: offsets, uncertainty, importance and the name only when known', () => {
    const [medium, approx] = overlapsInWindow(relevant, T, 60);
    expect(medium).toEqual({
      kind: 'SPEECH',
      id: 'medium',
      datetime: '2030-01-10T13:45:00.000Z',
      currency: 'USD',
      importance: 'MEDIUM',
      offset_minutes: 15,
      time_uncertain: false,
    });
    expect(approx).toMatchObject({
      kind: 'EVENT',
      name: 'Approximate event',
      time_uncertain: true,
      offset_minutes: 20,
    });
  });

  it('the hour before the release (T-60, T) is reported separately', () => {
    expect(overlapsBeforeRelease(relevant, T, 60).map((i) => i.id)).toEqual(['pre']);
  });
});

const sample = (
  label: HistorySampleInput['label'],
  reason: string | null = null,
  overlap = false,
): HistorySampleInput => ({
  event_id: `e-${label}-${reason ?? ''}-${Math.random()}`,
  release_datetime: '2029-12-06T13:30:00.000Z',
  label,
  reason,
  has_overlap: overlap,
});

describe('history sample-count rules (owner decision C)', () => {
  it('no samples: NO_HISTORY with counts, no shares', () => {
    const h = buildWindowHistory(15, [], RX_V1);
    expect(h).toMatchObject({
      status: 'NO_HISTORY',
      sample_count: 0,
      min_required: 3,
      max_samples: 10,
      determined_count: 0,
      shares: null,
      dominant_label: null,
      samples: [],
    });
  });

  it('2 determined samples: INSUFFICIENT_SAMPLE, raw counts and samples are returned, shares / dominant are null', () => {
    const h = buildWindowHistory(
      30,
      [
        sample('CONTINUATION'),
        sample('PULLBACK', null, true),
        sample('UNDETERMINED', 'NO_PRICE_DATA'),
        sample('UNDETERMINED', 'SMALL_INITIAL'),
      ],
      RX_V1,
    );
    expect(h.status).toBe('INSUFFICIENT_SAMPLE');
    expect(h).toMatchObject({
      sample_count: 4,
      determined_count: 2,
      undetermined_count: 2,
      overlap_count: 1,
      undetermined_by_reason: { NO_PRICE_DATA: 1, SMALL_INITIAL: 1 },
      class_counts: { CONTINUATION: 1, PULLBACK: 1, FULL_RETRACE: 0, REVERSAL: 0 },
      shares: null,
      dominant_label: null,
    });
    expect(h.samples).toHaveLength(4);
  });

  it('3 determined samples: OK with shares and the most common label', () => {
    const h = buildWindowHistory(
      60,
      [sample('PULLBACK'), sample('PULLBACK'), sample('REVERSAL'), sample('UNDETERMINED', 'MISSING_BARS')],
      RX_V1,
    );
    expect(h.status).toBe('OK');
    expect(h.shares).toEqual({ CONTINUATION: 0, PULLBACK: 0.6667, FULL_RETRACE: 0, REVERSAL: 0.3333 });
    expect(h.dominant_label).toBe('PULLBACK');
    expect(h.undetermined_by_reason).toEqual({ MISSING_BARS: 1 });
  });

  it('a tie for the most common label has no single answer (null) but status stays OK', () => {
    const h = buildWindowHistory(15, [sample('PULLBACK'), sample('REVERSAL'), sample('CONTINUATION')], RX_V1);
    expect(h.status).toBe('OK');
    expect(h.dominant_label).toBeNull();
  });

  it('keeps at most max_samples (10) samples, the newest first as given', () => {
    const many = Array.from({ length: 14 }, () => sample('CONTINUATION'));
    const h = buildWindowHistory(15, many, RX_V1);
    expect(h.sample_count).toBe(10);
    expect(h.samples).toHaveLength(10);
  });

  it('the limits come from the parameter set, not from the plan limits (history_events_max is not used)', () => {
    const p = deriveParams(RX_V1, { param_set_id: 'rx-test', history: { max_samples: 4, min_determined: 2 } });
    const h = buildWindowHistory(
      15,
      [sample('PULLBACK'), sample('PULLBACK'), sample('PULLBACK'), sample('PULLBACK'), sample('PULLBACK')],
      p,
    );
    expect(h).toMatchObject({ sample_count: 4, min_required: 2, max_samples: 4 });
  });
});

describe('parameter sets', () => {
  it('rx-v1 is registered, provisional and has the owner decisions', () => {
    expect(getParamSet('rx-v1')).toBe(RX_V1);
    expect(Object.keys(REACTION_PARAM_SETS)).toEqual(['rx-v1']);
    expect(RX_V1).toMatchObject({
      status: 'PROVISIONAL',
      windows: [1, 5, 15, 30, 60],
      classified_windows: [15, 30, 60],
      w0: 2,
      k_small: 2.0,
      rho: 1.0,
      history: { max_samples: 10, min_determined: 3 },
      baseline: { clock: 'America/New_York', kind: 'MAX_OWN_TYPICAL_NY' },
    });
    expect(() => getParamSet('rx-unknown')).toThrow(RangeError);
  });

  it('the content of rx-v1 is pinned by its hash: change a value => you need a new param set id', () => {
    expect(paramsHash(RX_V1)).toBe('sha256:32971bfdc3d76a682aa490173292bfc42228df30ee958d1ad0ab1788aa1852f2');
  });

  it('the hash depends on the content and ignores key order', () => {
    const changed = deriveParams(RX_V1, { k_small: 2.1 });
    expect(paramsHash(changed)).not.toBe(paramsHash(RX_V1));
    const reordered = JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(RX_V1).reverse()))) as typeof RX_V1;
    expect(paramsHash(reordered)).toBe(paramsHash(RX_V1));
  });

  it('is immutable and validated', () => {
    expect(Object.isFrozen(RX_V1)).toBe(true);
    expect(Object.isFrozen(RX_V1.baseline)).toBe(true);
    expect(() => deriveParams(RX_V1, { classified_windows: [3] })).toThrow(RangeError);
    expect(() => deriveParams(RX_V1, { history: { max_samples: 2, min_determined: 3 } })).toThrow(RangeError);
  });

  it('publicParams drops the id and status (they are separate meta fields)', () => {
    expect(Object.keys(publicParams(RX_V1))).not.toContain('param_set_id');
    expect(Object.keys(publicParams(RX_V1))).not.toContain('status');
  });
});
