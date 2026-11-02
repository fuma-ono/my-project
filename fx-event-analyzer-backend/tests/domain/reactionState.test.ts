/**
 * 相場反応の reaction_state(HQ判断 2026-10-30 P1-1 段階1、api-design v1.44)。
 * 行が無いことだけを理由に「取得できない」としないこと、analysis_status を変えないことを確かめる。
 */
import { describe, expect, it } from 'vitest';
import { resolveTimeframeAnalysisStatus } from '../../src/domain/dataQuality.js';
import { buildMajorFxReactions } from '../../src/domain/majorFxReactions.js';
import { resolveReactionState } from '../../src/domain/reactionState.js';

const RELEASE = '2026-10-14T12:30:00Z';
const MIN = 60_000;
const DAY = 86_400_000;
const at = (offsetMs: number) => new Date(Date.parse(RELEASE) + offsetMs);
const base = {
  timeframe: '5m' as const,
  precision: 'EXACT' as const,
  eventStatus: 'RELEASED',
  releaseDatetime: RELEASE,
};

describe('resolveReactionState', () => {
  it('#1 no row, T+N still in the future → NOT_DUE (analysis_status stays DATA_PENDING)', () => {
    expect(resolveReactionState({ ...base, hasRow: false, now: at(4 * MIN) })).toEqual({
      reaction_state: 'NOT_DUE',
      retry_scheduled: null,
    });
    expect(resolveTimeframeAnalysisStatus('5m', 'EXACT', 'PENDING')).toBe('DATA_PENDING');
  });

  it('#1b a released event exactly at T+N is due (not NOT_DUE)', () => {
    expect(resolveReactionState({ ...base, hasRow: false, now: at(5 * MIN) }).reaction_state).toBe('NOT_CALCULATED');
  });

  it('#2 no row, past T+N, within the job horizon (7 days) → NOT_CALCULATED, retry_scheduled true', () => {
    expect(resolveReactionState({ ...base, hasRow: false, now: at(2 * DAY) })).toEqual({
      reaction_state: 'NOT_CALCULATED',
      retry_scheduled: true,
    });
  });

  it('#3 no row, older than the horizon (like the 10/2 NFP) → NOT_CALCULATED, retry_scheduled false — never "unavailable"', () => {
    const state = resolveReactionState({ ...base, hasRow: false, now: at(28 * DAY) });
    expect(state).toEqual({ reaction_state: 'NOT_CALCULATED', retry_scheduled: false });
    // analysis_status for a missing row is unchanged: DATA_PENDING, not DATA_UNAVAILABLE
    expect(resolveTimeframeAnalysisStatus('5m', 'EXACT', 'PENDING')).toBe('DATA_PENDING');
  });

  it('#3b the horizon boundary matches the job (release_datetime >= now − 7 days)', () => {
    expect(resolveReactionState({ ...base, hasRow: false, now: at(7 * DAY) }).retry_scheduled).toBe(true);
    expect(resolveReactionState({ ...base, hasRow: false, now: at(7 * DAY + 1) }).retry_scheduled).toBe(false);
  });

  it('#4 #5 a stored row (UNAVAILABLE like the 10/14 CPI, or AVAILABLE) → CALCULATED; the result is analysis_status', () => {
    expect(resolveReactionState({ ...base, hasRow: true, now: at(28 * DAY) })).toEqual({
      reaction_state: 'CALCULATED',
      retry_scheduled: null,
    });
    expect(resolveTimeframeAnalysisStatus('5m', 'EXACT', 'UNAVAILABLE')).toBe('DATA_UNAVAILABLE');
    expect(resolveTimeframeAnalysisStatus('5m', 'EXACT', 'AVAILABLE')).toBe('READY');
  });

  it('#6 a timeframe excluded by precision (APPROXIMATE 1m, DATE_ONLY 5m) → null (NOT_ANALYZABLE wins)', () => {
    expect(
      resolveReactionState({ ...base, timeframe: '1m', precision: 'APPROXIMATE', hasRow: false, now: at(DAY) }),
    ).toEqual({ reaction_state: null, retry_scheduled: null });
    expect(resolveReactionState({ ...base, precision: 'DATE_ONLY', hasRow: false, now: at(DAY) }).reaction_state).toBe(
      null,
    );
    expect(
      resolveReactionState({ ...base, timeframe: '5m', precision: 'APPROXIMATE', hasRow: false, now: at(DAY) })
        .reaction_state,
    ).toBe('NOT_CALCULATED');
  });

  it('a SCHEDULED event (no value yet) is NOT_DUE even after its time — the job only computes RELEASED events', () => {
    expect(resolveReactionState({ ...base, eventStatus: 'SCHEDULED', hasRow: false, now: at(DAY) })).toEqual({
      reaction_state: 'NOT_DUE',
      retry_scheduled: null,
    });
  });

  it('a CANCELLED event → null', () => {
    expect(resolveReactionState({ ...base, eventStatus: 'CANCELLED', hasRow: false, now: at(DAY) })).toEqual({
      reaction_state: null,
      retry_scheduled: null,
    });
  });
});

describe('buildMajorFxReactions with reaction_state', () => {
  const pairs = [{ fx_pair_id: 'p1', symbol: 'USDJPY' }];
  const rows = [{ fx_pair_id: 'p1', timeframe: '1m', pips: 12, change_percent: 0.08, data_status: 'AVAILABLE' }];

  it('adds reaction_state / retry_scheduled per timeframe when the context is given', () => {
    const [major] = buildMajorFxReactions(pairs, rows, 'EXACT', {
      eventStatus: 'RELEASED',
      releaseDatetime: RELEASE,
      now: at(28 * DAY),
    });
    expect(major!.reactions.map((r) => [r.timeframe, r.analysis_status, r.reaction_state, r.retry_scheduled])).toEqual([
      ['1m', 'READY', 'CALCULATED', null],
      ['5m', 'DATA_PENDING', 'NOT_CALCULATED', false],
      ['15m', 'DATA_PENDING', 'NOT_CALCULATED', false],
    ]);
  });

  it('without the context the shape is unchanged (no new keys) — existing callers and old clients are unaffected', () => {
    const [major] = buildMajorFxReactions(pairs, rows, 'EXACT');
    expect(Object.keys(major!.reactions[0]!).sort()).toEqual([
      'analysis_status',
      'change_percent',
      'pips',
      'timeframe',
    ]);
  });
});

describe('reactionState timeframe minutes', () => {
  it('match the reaction calculation (speechReactions.TIMEFRAME_MINUTES)', async () => {
    const { TIMEFRAME_MINUTES } = await import('../../src/domain/speechReactions.js');
    for (const [timeframe, minutes] of Object.entries(TIMEFRAME_MINUTES)) {
      const due = resolveReactionState({
        ...base,
        timeframe: timeframe as '1m',
        hasRow: false,
        now: at(minutes * MIN - 1),
      });
      expect(due.reaction_state, timeframe).toBe('NOT_DUE');
      expect(
        resolveReactionState({ ...base, timeframe: timeframe as '1m', hasRow: false, now: at(minutes * MIN) })
          .reaction_state,
      ).toBe('NOT_CALCULATED');
    }
  });
});
