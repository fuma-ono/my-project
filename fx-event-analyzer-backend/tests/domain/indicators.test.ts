import { describe, expect, it } from 'vitest';
import { normalizeKeyPoints } from '../../src/domain/indicators.js';

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
