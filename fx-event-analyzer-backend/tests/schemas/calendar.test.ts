import { describe, expect, it } from 'vitest';
import { calendarQuerySchema } from '../../src/schemas/calendar.js';

describe('calendarQuerySchema', () => {
  const parse = (query: unknown) => calendarQuerySchema.safeParse(query).success;
  const range = { from: '2026-10-01T00:00:00+09:00', to: '2026-11-01T00:00:00+09:00' };

  it('accepts a month range with optional filters', () => {
    expect(parse(range)).toBe(true);
    expect(parse({ ...range, importance: 'HIGH', currency: 'USD' })).toBe(true);
  });

  it('requires both from and to', () => {
    expect(parse({})).toBe(false);
    expect(parse({ from: range.from })).toBe(false);
    expect(parse({ to: range.to })).toBe(false);
  });

  it('rejects non-ISO datetimes', () => {
    expect(parse({ from: '2026-10-01', to: range.to })).toBe(false);
  });

  it('rejects to <= from (compared as instants)', () => {
    expect(parse({ from: range.from, to: range.from })).toBe(false);
    expect(parse({ from: '2026-10-01T00:00:00Z', to: '2026-10-01T08:00:00+09:00' })).toBe(false);
  });

  it('allows exactly 62 days and rejects more', () => {
    expect(parse({ from: '2026-10-01T00:00:00Z', to: '2026-12-02T00:00:00Z' })).toBe(true);
    expect(parse({ from: '2026-10-01T00:00:00Z', to: '2026-12-02T00:00:01Z' })).toBe(false);
  });

  it('rejects bad importance / currency', () => {
    expect(parse({ ...range, importance: 'high' })).toBe(false);
    expect(parse({ ...range, importance: 'CRITICAL' })).toBe(false);
    expect(parse({ ...range, currency: 'usd' })).toBe(false);
  });
});
