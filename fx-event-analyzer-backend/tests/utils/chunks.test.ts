import { describe, expect, it } from 'vitest';
import { chunk, IN_FILTER_CHUNK_SIZE } from '../../src/utils/chunks.js';

describe('chunk (PostgREST in-filter size, HQ判断 2026-10-28 B3)', () => {
  it('splits into slices of at most 100 by default', () => {
    const ids = Array.from({ length: 250 }, (_, i) => String(i));
    expect(chunk(ids).map((slice) => slice.length)).toEqual([100, 100, 50]);
    expect(IN_FILTER_CHUNK_SIZE).toBe(100);
  });
  it('returns no slice for an empty list and rejects a bad size', () => {
    expect(chunk([])).toEqual([]);
    expect(() => chunk([1], 0)).toThrow(/positive integer/);
  });
});
