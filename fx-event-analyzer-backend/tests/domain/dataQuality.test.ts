import { describe, expect, it } from 'vitest';
import {
  availableTimeframes,
  mapEventDataStatus,
  mapReactionDataStatus,
  resolveTimeframeAnalysisStatus,
} from '../../src/domain/dataQuality.js';

describe('mapEventDataStatus', () => {
  it('maps AVAILABLE -> READY', () => {
    expect(mapEventDataStatus('AVAILABLE')).toBe('READY');
  });
  it('maps PENDING and PARTIAL -> DATA_PENDING', () => {
    expect(mapEventDataStatus('PENDING')).toBe('DATA_PENDING');
    expect(mapEventDataStatus('PARTIAL')).toBe('DATA_PENDING');
  });
  it('maps UNAVAILABLE -> DATA_UNAVAILABLE', () => {
    expect(mapEventDataStatus('UNAVAILABLE')).toBe('DATA_UNAVAILABLE');
  });
});

describe('mapReactionDataStatus', () => {
  it('maps AVAILABLE -> READY, PENDING -> DATA_PENDING, UNAVAILABLE -> DATA_UNAVAILABLE', () => {
    expect(mapReactionDataStatus('AVAILABLE')).toBe('READY');
    expect(mapReactionDataStatus('PENDING')).toBe('DATA_PENDING');
    expect(mapReactionDataStatus('UNAVAILABLE')).toBe('DATA_UNAVAILABLE');
  });
});

describe('availableTimeframes', () => {
  it('excludes nothing for EXACT precision', () => {
    expect(availableTimeframes('EXACT')).toEqual(['1m', '5m', '15m', '30m', '60m']);
  });
  it('excludes 1m for APPROXIMATE precision', () => {
    expect(availableTimeframes('APPROXIMATE')).toEqual(['5m', '15m', '30m', '60m']);
  });
  it('excludes 1m and 5m for DATE_ONLY precision', () => {
    expect(availableTimeframes('DATE_ONLY')).toEqual(['15m', '30m', '60m']);
  });
  it('excludes 1m and 5m for UNKNOWN precision', () => {
    expect(availableTimeframes('UNKNOWN')).toEqual(['15m', '30m', '60m']);
  });
});

describe('resolveTimeframeAnalysisStatus', () => {
  it('is NOT_ANALYZABLE for an excluded timeframe even when the stored reaction is AVAILABLE', () => {
    expect(resolveTimeframeAnalysisStatus('1m', 'APPROXIMATE', 'AVAILABLE')).toBe('NOT_ANALYZABLE');
  });

  it('precision-based exclusion takes priority over stored data_status', () => {
    expect(resolveTimeframeAnalysisStatus('5m', 'DATE_ONLY', 'PENDING')).toBe('NOT_ANALYZABLE');
  });

  it('falls through to the normal mapping for an allowed timeframe', () => {
    expect(resolveTimeframeAnalysisStatus('15m', 'DATE_ONLY', 'AVAILABLE')).toBe('READY');
    expect(resolveTimeframeAnalysisStatus('60m', 'UNKNOWN', 'PENDING')).toBe('DATA_PENDING');
    expect(resolveTimeframeAnalysisStatus('60m', 'UNKNOWN', 'UNAVAILABLE')).toBe('DATA_UNAVAILABLE');
  });

  it('applies no exclusion for EXACT precision', () => {
    expect(resolveTimeframeAnalysisStatus('1m', 'EXACT', 'AVAILABLE')).toBe('READY');
  });
});
