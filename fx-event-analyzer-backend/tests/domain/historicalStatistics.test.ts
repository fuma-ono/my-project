import { describe, expect, it } from 'vitest';
import { computeAdvancedHistoricalStats, computeHistoricalStats } from '../../src/domain/historicalStatistics.js';

describe('computeHistoricalStats', () => {
  it('returns null for an empty row set', () => {
    expect(computeHistoricalStats([])).toBeNull();
  });

  it('computes averages, extremes, and up/down/no-change counts', () => {
    const rows = [
      { movement: 0.28, pips: 28 },
      { movement: -0.1, pips: -10 },
      { movement: 0, pips: 0 },
      { movement: 0.5, pips: 50 },
    ];
    const stats = computeHistoricalStats(rows);
    expect(stats).not.toBeNull();
    expect(stats!.average_movement).toBeCloseTo(0.17);
    expect(stats!.average_pips).toBeCloseTo(17);
    expect(stats!.max_movement).toBeCloseTo(0.5);
    expect(stats!.min_movement).toBeCloseTo(-0.1);
    expect(stats!.upward_count).toBe(2);
    expect(stats!.downward_count).toBe(1);
    expect(stats!.no_change_count).toBe(1);
  });
});

describe('computeAdvancedHistoricalStats', () => {
  it('returns null for an empty row set', () => {
    expect(computeAdvancedHistoricalStats([])).toBeNull();
  });

  it('averages absolute values, treating up and down movements symmetrically', () => {
    const rows = [
      { movement: 0.3, pips: 30 },
      { movement: -0.3, pips: -30 },
    ];
    expect(computeAdvancedHistoricalStats(rows)).toEqual({
      average_absolute_movement: 0.3,
      average_absolute_pips: 30,
    });
  });
});
