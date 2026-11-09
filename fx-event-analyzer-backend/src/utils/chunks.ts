/**
 * Ids per PostgREST `in.(…)` filter. The filter travels in the request URL, so a long id list is split
 * (100 UUIDs ≈ 3.7 KB) instead of growing one URL without bound.
 */
export const IN_FILTER_CHUNK_SIZE = 100;

/** `items` in consecutive slices of at most `size` (none for an empty list). */
export function chunk<T>(items: readonly T[], size: number = IN_FILTER_CHUNK_SIZE): T[][] {
  if (!Number.isInteger(size) || size < 1) throw new Error(`chunk size must be a positive integer (got ${size})`);
  const slices: T[][] = [];
  for (let start = 0; start < items.length; start += size) slices.push(items.slice(start, start + size));
  return slices;
}
