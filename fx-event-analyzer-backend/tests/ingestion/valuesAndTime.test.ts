import { describe, expect, it } from 'vitest';
import {
  isMinuteAligned,
  localDate,
  shiftMonth,
  utcWallStringToIso,
  zonedWallTimeToUtc,
} from '../../src/ingestion/time.js';
import { parseProviderValue, roundTo, toMappedUnit } from '../../src/ingestion/values.js';

describe('parseProviderValue', () => {
  it('parses percent and magnitude suffixes', () => {
    expect(parseProviderValue('3.7%')).toEqual({ value: 3.7, unit: '%' });
    expect(parseProviderValue('254K')).toEqual({ value: 254, unit: 'K' });
    expect(parseProviderValue('-0.1%')).toEqual({ value: -0.1, unit: '%' });
    expect(parseProviderValue('1,234.5', 'K')).toEqual({ value: 1234.5, unit: 'K' });
    expect(parseProviderValue(29, 'K')).toEqual({ value: 29, unit: 'K' });
  });

  it('treats empty / dash / N/A as "no value" (null), never 0', () => {
    expect(parseProviderValue('')).toBeNull();
    expect(parseProviderValue('-')).toBeNull();
    expect(parseProviderValue('N/A')).toBeNull();
    expect(parseProviderValue(null)).toBeNull();
  });

  it('returns undefined for garbage so the caller fails loudly', () => {
    expect(parseProviderValue('abc')).toBeUndefined();
    expect(parseProviderValue('3.7%%')).toBeUndefined();
    expect(parseProviderValue(Number.NaN)).toBeUndefined();
  });
});

describe('toMappedUnit', () => {
  it('accepts % for PERCENT and rejects other units', () => {
    expect(toMappedUnit({ value: 3.7, unit: '%' }, 'PERCENT', false)).toBe(3.7);
    expect(toMappedUnit({ value: 3.7, unit: 'K' }, 'PERCENT', false)).toBeNull();
    expect(toMappedUnit({ value: 3.7, unit: null }, 'PERCENT', false)).toBeNull();
    expect(toMappedUnit({ value: 3.7, unit: null }, 'PERCENT', true)).toBe(3.7);
  });

  it('scales magnitudes into thousands', () => {
    expect(toMappedUnit({ value: 254, unit: 'K' }, 'THOUSANDS', false)).toBe(254);
    expect(toMappedUnit({ value: 1.2, unit: 'M' }, 'THOUSANDS', false)).toBe(1200);
    expect(toMappedUnit({ value: 3.7, unit: '%' }, 'THOUSANDS', false)).toBeNull();
  });
});

describe('roundTo (round half away from zero on the decimal string)', () => {
  it('rounds the way agencies publish', () => {
    expect(roundTo(0.15, 1)).toBe(0.2);
    expect(roundTo(-0.15, 1)).toBe(-0.2);
    expect(roundTo(2.675, 2)).toBe(2.68);
    expect(roundTo(3.7376847290640427, 1)).toBe(3.7);
    expect(roundTo(2.5643583511686643, 1)).toBe(2.6);
    expect(roundTo(28.5, 0)).toBe(29);
    expect(roundTo(-0.04, 1)).toBe(0);
  });
});

describe('time helpers', () => {
  it('converts US Eastern wall time to UTC across DST', () => {
    // EDT (UTC-4) in October, EST (UTC-5) in December.
    expect(zonedWallTimeToUtc(2026, 10, 14, 8, 30, 'America/New_York')?.toISOString()).toBe('2026-10-14T12:30:00.000Z');
    expect(zonedWallTimeToUtc(2026, 12, 10, 8, 30, 'America/New_York')?.toISOString()).toBe('2026-12-10T13:30:00.000Z');
    // 2026-03-08 02:30 does not exist in New York (spring forward).
    expect(zonedWallTimeToUtc(2026, 3, 8, 2, 30, 'America/New_York')).toBeNull();
  });

  it('localDate / shiftMonth / utcWallStringToIso / isMinuteAligned', () => {
    expect(localDate(new Date('2026-10-15T02:55:00Z'), 'America/New_York')).toBe('2026-10-14');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-09', -12)).toBe('2025-09');
    expect(utcWallStringToIso('2026-10-15 08:30:00')).toBe('2026-10-15T08:30:00.000Z');
    expect(utcWallStringToIso('2026-02-30 08:30:00')).toBeNull();
    expect(isMinuteAligned('2026-10-15T08:30:00.000Z')).toBe(true);
    expect(isMinuteAligned('2026-10-15T08:30:30.000Z')).toBe(false);
  });
});
