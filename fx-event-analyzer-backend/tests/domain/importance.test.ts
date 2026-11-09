import { describe, expect, it } from 'vitest';
import { IMPORTANCE_STARS, meetsNotificationThreshold, sortImportancesDesc } from '../../src/domain/importance.js';

describe('IMPORTANCE_STARS (provisional mapping)', () => {
  it('maps LOW/MEDIUM/HIGH to ★1/★3/★5', () => {
    expect(IMPORTANCE_STARS).toEqual({ LOW: 1, MEDIUM: 3, HIGH: 5 });
  });
});

describe('meetsNotificationThreshold', () => {
  it('includes importance at or above the threshold', () => {
    expect(meetsNotificationThreshold('MEDIUM', 3)).toBe(true);
    expect(meetsNotificationThreshold('HIGH', 4)).toBe(true);
    expect(meetsNotificationThreshold('LOW', 1)).toBe(true);
  });

  it('excludes importance below the threshold', () => {
    expect(meetsNotificationThreshold('MEDIUM', 4)).toBe(false);
    expect(meetsNotificationThreshold('LOW', 2)).toBe(false);
  });
});

describe('sortImportancesDesc', () => {
  it('dedupes and orders HIGH, MEDIUM, LOW', () => {
    expect(sortImportancesDesc(['LOW', 'HIGH', 'LOW', 'MEDIUM'])).toEqual(['HIGH', 'MEDIUM', 'LOW']);
    expect(sortImportancesDesc(['MEDIUM'])).toEqual(['MEDIUM']);
  });
});
