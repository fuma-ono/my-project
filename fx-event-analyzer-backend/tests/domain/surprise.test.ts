import { describe, expect, it } from 'vitest';
import { calculateSurprise } from '../../src/domain/surprise.js';

describe('calculateSurprise', () => {
  it('returns null (never 0) when forecast is missing', () => {
    expect(calculateSurprise(null, 3.3, 'HIGHER_IS_POSITIVE')).toEqual({ surprise: null, direction: null });
  });

  it('returns null (never 0) when actual is missing', () => {
    expect(calculateSurprise(3.1, null, 'HIGHER_IS_POSITIVE')).toEqual({ surprise: null, direction: null });
  });

  it('is NEUTRAL, distinct from null, when surprise is exactly 0', () => {
    const result = calculateSurprise(3.1, 3.1, 'HIGHER_IS_POSITIVE');
    expect(result.surprise).toBe(0);
    expect(result.direction).toBe('NEUTRAL');
  });

  it('is POSITIVE when actual beats forecast and higher is favorable', () => {
    const result = calculateSurprise(3.1, 3.3, 'HIGHER_IS_POSITIVE');
    expect(result.surprise).toBeCloseTo(0.2);
    expect(result.direction).toBe('POSITIVE');
  });

  it('is NEGATIVE when actual misses forecast and higher is favorable', () => {
    const result = calculateSurprise(3.1, 2.9, 'HIGHER_IS_POSITIVE');
    expect(result.surprise).toBeCloseTo(-0.2);
    expect(result.direction).toBe('NEGATIVE');
  });

  it('inverts direction when lower is favorable', () => {
    expect(calculateSurprise(4.0, 3.5, 'LOWER_IS_POSITIVE').direction).toBe('POSITIVE');
    expect(calculateSurprise(4.0, 4.5, 'LOWER_IS_POSITIVE').direction).toBe('NEGATIVE');
  });

  it('is always NEUTRAL for a NEUTRAL favorable_direction indicator, regardless of sign', () => {
    expect(calculateSurprise(0, 0.25, 'NEUTRAL').direction).toBe('NEUTRAL');
    expect(calculateSurprise(0, -0.25, 'NEUTRAL').direction).toBe('NEUTRAL');
  });
});
