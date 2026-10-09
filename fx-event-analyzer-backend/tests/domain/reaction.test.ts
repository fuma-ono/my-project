import { describe, expect, it } from 'vitest';
import { calculateMaxExcursion, calculateReaction } from '../../src/domain/reaction.js';

describe('calculateReaction', () => {
  it('returns nulls when pre-release price is missing', () => {
    expect(calculateReaction({ preReleasePrice: null, postReleasePrice: 147.5, pipSize: 0.01 })).toEqual({
      movement: null,
      pips: null,
      changePercent: null,
    });
  });

  it('returns nulls when post-release price is missing', () => {
    expect(calculateReaction({ preReleasePrice: 147.2, postReleasePrice: null, pipSize: 0.01 })).toEqual({
      movement: null,
      pips: null,
      changePercent: null,
    });
  });

  it('computes movement/pips/change_percent for USDJPY (pip_size 0.01)', () => {
    const result = calculateReaction({ preReleasePrice: 147.2, postReleasePrice: 147.48, pipSize: 0.01 });
    expect(result.movement).toBeCloseTo(0.28);
    expect(result.pips).toBeCloseTo(28.0);
    expect(result.changePercent).toBeCloseTo(0.1902, 3);
  });

  it('computes movement/pips/change_percent for EURUSD (pip_size 0.0001)', () => {
    const result = calculateReaction({ preReleasePrice: 1.085, postReleasePrice: 1.0835, pipSize: 0.0001 });
    expect(result.movement).toBeCloseTo(-0.0015);
    expect(result.pips).toBeCloseTo(-15.0);
    expect(result.changePercent).toBeCloseTo(-0.1382, 3);
  });
});

describe('calculateMaxExcursion', () => {
  it('returns nulls when pre-release price is missing', () => {
    expect(calculateMaxExcursion({ preReleasePrice: null, pricesInWindow: [147.3], pipSize: 0.01 })).toEqual({
      maxUpward: null,
      maxDownward: null,
      maxUpwardPips: null,
      maxDownwardPips: null,
    });
  });

  it('returns nulls when the window has no prices', () => {
    expect(calculateMaxExcursion({ preReleasePrice: 147.2, pricesInWindow: [], pipSize: 0.01 })).toEqual({
      maxUpward: null,
      maxDownward: null,
      maxUpwardPips: null,
      maxDownwardPips: null,
    });
  });

  it('takes the max/min excursion relative to pre-release price, not consecutive deltas', () => {
    // A window that goes up, back down, then up again — a cumulative-delta
    // implementation would get this wrong; pre-release-relative must not.
    const result = calculateMaxExcursion({
      preReleasePrice: 147.2,
      pricesInWindow: [147.5, 147.15, 148.1, 147.0],
      pipSize: 0.01,
    });
    expect(result.maxUpward).toBeCloseTo(0.9); // 148.1 - 147.2
    expect(result.maxDownward).toBeCloseTo(-0.2); // 147.0 - 147.2
    expect(result.maxUpwardPips).toBeCloseTo(90.0);
    expect(result.maxDownwardPips).toBeCloseTo(-20.0);
  });
});
