import { describe, expect, it } from 'vitest';
import { buildMeta, parsePagination, rangeFor, resolveSort } from '../../src/utils/pagination.js';

describe('parsePagination', () => {
  it('defaults to page 1, limit 20 when nothing is supplied', () => {
    expect(parsePagination({})).toEqual({ page: 1, limit: 20 });
  });

  it('parses valid page/limit strings (as arrive from query params)', () => {
    expect(parsePagination({ page: '3', limit: '50' })).toEqual({ page: 3, limit: 50 });
  });

  it('caps limit at 100 even when the client asks for more', () => {
    expect(parsePagination({ limit: '9999' })).toEqual({ page: 1, limit: 100 });
  });

  it('falls back to defaults for invalid/non-positive values', () => {
    expect(parsePagination({ page: '0', limit: '-5' })).toEqual({ page: 1, limit: 20 });
    expect(parsePagination({ page: 'not-a-number', limit: 'also-not' })).toEqual({ page: 1, limit: 20 });
  });
});

describe('buildMeta', () => {
  it('sets has_next when more rows remain past this page', () => {
    expect(buildMeta(1, 20, 45)).toEqual({ page: 1, limit: 20, total: 45, has_next: true });
  });
  it('clears has_next on the last page', () => {
    expect(buildMeta(3, 20, 45)).toEqual({ page: 3, limit: 20, total: 45, has_next: false });
  });
});

describe('rangeFor', () => {
  it('computes an inclusive [from, to] range matching PostgREST .range()', () => {
    expect(rangeFor(1, 20)).toEqual({ from: 0, to: 19 });
    expect(rangeFor(3, 20)).toEqual({ from: 40, to: 59 });
  });
});

describe('resolveSort', () => {
  const ALLOWLIST = ['name', 'importance', 'created_at'] as const;

  it('accepts a requested value that is on the allowlist', () => {
    expect(resolveSort('importance', ALLOWLIST, 'name')).toBe('importance');
  });

  it('falls back to the default for anything not on the allowlist — including an injection attempt', () => {
    expect(resolveSort(undefined, ALLOWLIST, 'name')).toBe('name');
    expect(resolveSort('name; DROP TABLE economic_indicators;--', ALLOWLIST, 'name')).toBe('name');
    expect(resolveSort('__proto__', ALLOWLIST, 'name')).toBe('name');
  });
});
