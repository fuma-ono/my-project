/**
 * HQ指示(2026-10-27「指標の追加」): 米国 PPI・コアPPI・JOLTS を BLS の経路で取り込めること、
 * 全系列を1回の HTTP でまとめて取ること(BLS v1 の 25クエリ/日)。
 */
import { describe, expect, it } from 'vitest';
import {
  BLS_SCHEDULE,
  JOLTS_RELEASE_INDICATORS,
  PPI_RELEASE_INDICATORS,
  type BlsScheduleEntry,
} from '../../src/ingestion/mappings/blsSchedule.js';
import { findMappingByCode } from '../../src/ingestion/mappings/indicators.js';
import {
  blsScheduleSeriesIds,
  buildBlsScheduleReleases,
  createBlsBatchProvider,
  createBlsNativeResolver,
  createBlsSecondaryResolver,
  scheduleObservationRange,
  type BlsBatchSource,
} from '../../src/ingestion/pipelines/blsCalendar.js';
import type { OfficialObservation } from '../../src/ingestion/types.js';

const NOW = () => new Date('2026-10-27T12:00:00Z');

/** In-memory BLS that answers multi-series requests (like the v1 API) and counts them. */
class FakeBatchBls implements BlsBatchSource {
  requests: string[][] = [];
  constructor(private readonly bySeries: Record<string, Record<string, number>>) {}
  fetchManyObservations(query: { seriesIds: readonly string[]; observationStart: string; observationEnd: string }) {
    this.requests.push([...query.seriesIds]);
    const out: OfficialObservation[] = [];
    for (const seriesId of query.seriesIds) {
      for (const [period, value] of Object.entries(this.bySeries[seriesId] ?? {})) {
        out.push({
          source: 'BLS',
          seriesId,
          periodStart: `${period}-01`,
          value,
          asOfDate: '2026-10-27',
          releaseStatus: 'UNKNOWN',
        });
      }
    }
    return Promise.resolve(out);
  }
}

const SERIES = {
  WPSFD4: { '2026-07': 157.0, '2026-08': 157.662, '2026-09': 159.78 },
  WPUFD4: { '2025-08': 153.0, '2025-09': 154.0, '2026-08': 157.5, '2026-09': 158.9 },
  WPSFD49104: { '2026-07': 159.0, '2026-08': 159.5, '2026-09': 160.1 },
  WPUFD49104: { '2025-08': 155.0, '2025-09': 155.6, '2026-08': 159.2, '2026-09': 159.9 },
  JTS000000000000000JOL: { '2026-07': 7208, '2026-08': 7227 },
};

describe('PPI / JOLTS mappings and schedule', () => {
  it.each([
    ['US_PPI', 'WPSFD4', 'WPUFD4'],
    ['US_CORE_PPI', 'WPSFD49104', 'WPUFD49104'],
  ])('%s: MoM of the SA index, YoY of the NSA index (as BLS publishes)', (code, sa, nsa) => {
    const m = findMappingByCode(code)!;
    expect(m.official).toEqual([{ source: 'BLS', seriesId: sa, transform: 'MOM_PCT' }]);
    expect(m.secondary).toEqual({
      valueKind: 'YOY_PCT',
      official: { source: 'BLS', seriesId: nsa, transform: 'YOY_PCT' },
    });
    expect(m.release).toEqual({ timeZone: 'America/New_York', localTimes: ['08:30'] });
  });

  it('JOLTS is a level in thousands released at 10:00 New York', () => {
    const m = findMappingByCode('US_JOLTS')!;
    expect(m.official).toEqual([{ source: 'BLS', seriesId: 'JTS000000000000000JOL', transform: 'LEVEL' }]);
    expect(m.unit).toBe('THOUSANDS');
    expect(m.release.localTimes).toEqual(['10:00']);
  });

  it('PPI has the 24 official dates; JOLTS only the 11 BLS has published (no 2027 guess)', () => {
    for (const code of PPI_RELEASE_INDICATORS) {
      const rows = BLS_SCHEDULE.filter((e) => e.indicatorCode === code);
      expect(rows).toHaveLength(24);
      expect(rows[0]).toMatchObject({ referencePeriod: '2025-12', releaseDate: '2026-01-30' });
      expect(rows.find((e) => e.referencePeriod === '2026-10')?.releaseDate).toBe('2026-11-13');
      expect(rows[23]).toMatchObject({ referencePeriod: '2027-11', releaseDate: '2027-12-15' });
    }
    const jolts = BLS_SCHEDULE.filter((e) => e.indicatorCode === JOLTS_RELEASE_INDICATORS[0]);
    expect(jolts).toHaveLength(11);
    expect(jolts.find((e) => e.referencePeriod === '2026-09')?.releaseDate).toBe('2026-11-03');
    expect(jolts.every((e) => e.releaseDate < '2027-01-01')).toBe(true);
  });
});

describe('createBlsBatchProvider', () => {
  it('sends ONE request for every series of the schedule, shared by both resolvers', async () => {
    const source = new FakeBatchBls(SERIES);
    const range = scheduleObservationRange(BLS_SCHEDULE);
    const bls = createBlsBatchProvider(source, blsScheduleSeriesIds(), range);
    await buildBlsScheduleReleases({
      official: createBlsNativeResolver(bls, range),
      officialSecondary: createBlsSecondaryResolver(bls, range),
      now: NOW,
    });
    expect(source.requests).toHaveLength(1);
    expect(source.requests[0]).toEqual(blsScheduleSeriesIds());
    expect(blsScheduleSeriesIds()).toHaveLength(11); // 重なりを除いて11系列。v1 の1クエリ25系列に収まる
  });

  it('computes PPI MoM (SA) / YoY (NSA) and the JOLTS level from the batch', async () => {
    const source = new FakeBatchBls(SERIES);
    const range = { start: '2024-01-01', end: '2027-12-31' };
    const bls = createBlsBatchProvider(source, blsScheduleSeriesIds(), range);
    const entries: BlsScheduleEntry[] = [
      { indicatorCode: 'US_PPI', referencePeriod: '2026-09', releaseDate: '2026-10-15' },
      { indicatorCode: 'US_JOLTS', referencePeriod: '2026-08', releaseDate: '2026-09-29' },
    ];
    const { releases } = await buildBlsScheduleReleases({
      official: createBlsNativeResolver(bls, range),
      officialSecondary: createBlsSecondaryResolver(bls, range),
      entries,
      now: NOW,
    });
    const ppi = releases.find((r) => r.providerEventId === 'bls_schedule:US_PPI:2026-09')!;
    expect(ppi.releaseAt).toBe('2026-10-15T12:30:00.000Z');
    expect(ppi.actual?.value).toBeCloseTo((159.78 / 157.662 - 1) * 100, 6); // 1.34 → BLS「+1.3%」
    expect(ppi.secondaryActual).toBeCloseTo((158.9 / 154.0 - 1) * 100, 6);
    const jolts = releases.find((r) => r.providerEventId === 'bls_schedule:US_JOLTS:2026-08')!;
    expect(jolts.releaseAt).toBe('2026-09-29T14:00:00.000Z'); // 10:00 EDT
    expect(jolts.actual).toEqual({ value: 7227, unit: 'K' });
    expect(source.requests).toHaveLength(1);
  });

  it('fails every series of the run when the one request fails (values stay empty, retried next run)', async () => {
    const source: BlsBatchSource = {
      fetchManyObservations: () => Promise.reject(new Error('BLS: REQUEST_NOT_PROCESSED')),
    };
    const bls = createBlsBatchProvider(source, ['WPSFD4'], { start: '2024-01-01', end: '2027-12-31' });
    await expect(
      bls.fetchObservations({ seriesId: 'WPSFD4', observationStart: '2024-01-01', observationEnd: '2027-12-31' }),
    ).rejects.toThrow('REQUEST_NOT_PROCESSED');
  });

  it('refuses a series outside the batch (a config mistake, not a silent extra request)', async () => {
    const bls = createBlsBatchProvider(new FakeBatchBls({}), ['WPSFD4'], { start: '2024-01-01', end: '2027-12-31' });
    await expect(
      bls.fetchObservations({ seriesId: 'XXX', observationStart: '2024-01-01', observationEnd: '2027-12-31' }),
    ).rejects.toThrow('not in the batch');
  });
});
