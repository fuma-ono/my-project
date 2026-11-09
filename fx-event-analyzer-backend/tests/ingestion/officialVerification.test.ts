import { describe, expect, it } from 'vitest';
import { parseBlsResponse } from '../../src/ingestion/adapters/bls.js';
import { findMappingByCode } from '../../src/ingestion/mappings/indicators.js';
import { createLiveOfficialResolver } from '../../src/ingestion/pipelines/officialStats.js';
import type { ObservationQuery, OfficialStatsProvider } from '../../src/ingestion/providers.js';
import type { OfficialObservation } from '../../src/ingestion/types.js';
import {
  compareWithOfficial,
  computeOfficialValue,
  createOfficialResolver,
  observationWindow,
} from '../../src/ingestion/verification/official.js';
import { jsonFixture } from '../helpers/memoryIngestionStore.js';

async function blsObservations(seriesId: string): Promise<OfficialObservation[]> {
  const all = parseBlsResponse(await jsonFixture('bls-v1-2025-2026.json'), '2026-10-15');
  return all.filter((o) => o.seriesId === seriesId);
}

describe('computeOfficialValue (recorded BLS data, 2026-10-15)', () => {
  it('computes headline CPI YoY from the NSA index', async () => {
    const cpi = await blsObservations('CUUR0000SA0');
    // 336.940 / 324.800 − 1 = 3.7377 %
    expect(computeOfficialValue(cpi, '2026-09', 'YOY_PCT')).toBeCloseTo(3.7377, 4);
  });

  it('computes payroll CHANGE in thousands and the unemployment LEVEL', async () => {
    expect(computeOfficialValue(await blsObservations('CES0000000001'), '2026-09', 'DIFF')).toBe(29);
    expect(computeOfficialValue(await blsObservations('LNS14000000'), '2026-09', 'LEVEL')).toBe(4.2);
  });

  it('never fills a month that was not published (October 2025)', async () => {
    const cpi = await blsObservations('CUUR0000SA0');
    expect(cpi.find((o) => o.periodStart === '2025-10-01')?.value).toBeNull();
    expect(computeOfficialValue(cpi, '2025-10', 'LEVEL')).toBeNull();
    expect(computeOfficialValue(cpi, '2025-11', 'MOM_PCT')).toBeNull();
  });

  it('marks BLS preliminary observations', async () => {
    const payrolls = await blsObservations('CES0000000001');
    expect(payrolls.find((o) => o.periodStart === '2026-09-01')?.releaseStatus).toBe('PRELIMINARY');
    expect(payrolls.find((o) => o.periodStart === '2026-07-01')?.releaseStatus).toBe('UNKNOWN');
  });
});

describe('compareWithOfficial (rounding-aware)', () => {
  it('matches after rounding both sides to the published decimals', () => {
    expect(compareWithOfficial(3.7, 3.7376847, 1, 0)).toMatchObject({ match: true, officialRounded: 3.7 });
    expect(compareWithOfficial(3.8, 3.7376847, 1, 0)).toMatchObject({ match: false, difference: 0.1 });
    expect(compareWithOfficial(29, 29, 0, 0).match).toBe(true);
    // A tolerance of one unit of the last decimal, when configured.
    expect(compareWithOfficial(0.3, 0.24, 1, 0.1).match).toBe(true);
  });
});

describe('official resolver', () => {
  const cpi = findMappingByCode('US_CPI')!;

  it('falls back to the next source when the first has no value or fails', async () => {
    const errors: string[] = [];
    const resolver = createOfficialResolver(
      (ref) => {
        if (ref.source === 'FRED') return Promise.reject(new Error('HTTP 500'));
        return blsObservations(ref.seriesId);
      },
      (ref) => errors.push(ref.seriesId),
    );
    // 本番の対応表は BLS だけ(FRED は外した)。フォールバックの仕組みは2つの照合元を並べて確かめる。
    const twoSources = {
      ...cpi,
      official: [{ source: 'FRED' as const, seriesId: 'CPIAUCNS', transform: 'YOY_PCT' as const }, ...cpi.official],
    };
    const resolved = await resolver.resolve(twoSources, '2026-09', '2026-10-14');
    expect(resolved?.sourceRef).toBe('BLS:CUUR0000SA0@2026-10-15');
    expect(resolved?.value).toBeCloseTo(3.7377, 4);
    expect(errors).toEqual(['CPIAUCNS']);
  });

  it('returns null rather than a guess when no source has the period', async () => {
    const resolver = createOfficialResolver(() => Promise.resolve([]));
    expect(await resolver.resolve(cpi, '2026-10', '2026-11-12')).toBeNull();
  });

  it('does not use a current-vintage-only source (BLS) for old as-of dates', async () => {
    const queries: ObservationQuery[] = [];
    const bls: OfficialStatsProvider = {
      name: 'BLS',
      supportsPointInTime: false,
      fetchObservations: (query) => {
        queries.push(query);
        return blsObservations(query.seriesId);
      },
    };
    const resolver = createLiveOfficialResolver({ BLS: bls }, undefined, () => new Date('2026-10-15T00:00:00Z'));
    expect(await resolver.resolve(cpi, '2025-09', '2025-10-24')).toBeNull();
    expect(queries).toHaveLength(0);
    expect(await resolver.resolve(cpi, '2026-09', '2026-10-14')).not.toBeNull();
    expect(queries[0]).toMatchObject({
      seriesId: 'CUUR0000SA0',
      observationStart: '2025-09-01',
      observationEnd: '2026-09-01',
    });
  });

  it('observation windows cover what each transform needs', () => {
    expect(observationWindow('2026-09', 'YOY_PCT')).toEqual({ start: '2025-09-01', end: '2026-09-01' });
    expect(observationWindow('2026-01', 'DIFF')).toEqual({ start: '2025-12-01', end: '2026-01-01' });
    expect(observationWindow('2026-09', 'LEVEL')).toEqual({ start: '2026-09-01', end: '2026-09-01' });
  });
});
