import { beforeEach, describe, expect, it } from 'vitest';
import type { BlsScheduleEntry } from '../../src/ingestion/mappings/blsSchedule.js';
import { findMappingByCode, type IndicatorMapping } from '../../src/ingestion/mappings/indicators.js';
import { buildBlsScheduleReleases, createBlsNativeResolver } from '../../src/ingestion/pipelines/blsCalendar.js';
import { ingestCalendarReleases } from '../../src/ingestion/pipelines/economicCalendar.js';
import type { OfficialStatsProvider } from '../../src/ingestion/providers.js';
import { JobCounters } from '../../src/ingestion/runner.js';
import type { OfficialObservation } from '../../src/ingestion/types.js';
import { MemoryIngestionStore } from '../helpers/memoryIngestionStore.js';

/** A BLS provider backed by a fixed table of month → value, like the real API but in memory. */
class FakeBls implements OfficialStatsProvider {
  readonly name = 'BLS' as const;
  readonly supportsPointInTime = false;
  calls: { seriesId: string; start: string; end: string }[] = [];
  constructor(private readonly bySeries: Map<string, Map<string, number>>) {}

  fetchObservations(query: { seriesId: string; observationStart: string; observationEnd: string }) {
    this.calls.push({ seriesId: query.seriesId, start: query.observationStart, end: query.observationEnd });
    const months = this.bySeries.get(query.seriesId) ?? new Map<string, number>();
    const observations: OfficialObservation[] = [];
    for (const [period, value] of months) {
      if (period >= query.observationStart.slice(0, 7) && period <= query.observationEnd.slice(0, 7)) {
        observations.push({
          source: 'BLS',
          seriesId: query.seriesId,
          periodStart: `${period}-01`,
          value,
          asOfDate: '2026-10-17',
          releaseStatus: 'UNKNOWN',
        });
      }
    }
    return Promise.resolve(observations);
  }
}

const CPI_SERIES = 'CUUR0000SA0'; // US_CPI, YOY_PCT
const NFP_SERIES = 'CES0000000001'; // US_NFP, DIFF

function fakeBlsWith(cpi: Record<string, number>, nfp: Record<string, number>): FakeBls {
  return new FakeBls(
    new Map([
      [CPI_SERIES, new Map(Object.entries(cpi))],
      [NFP_SERIES, new Map(Object.entries(nfp))],
    ]),
  );
}

describe('createBlsNativeResolver', () => {
  const cpiMapping = findMappingByCode('US_CPI')!;
  const nfpMapping = findMappingByCode('US_NFP')!;

  it('computes YOY_PCT for CPI from 12 months back, at any asOfDate age', async () => {
    const bls = fakeBlsWith({ '2025-09': 320.0, '2026-09': 332.16 }, {});
    const resolver = createBlsNativeResolver(bls);
    // 2026-09 YoY, asked as-of an old date far in the past: must still resolve (no 20-day staleness gate).
    const result = await resolver.resolve(cpiMapping, '2026-09', '2026-10-14');
    expect(result?.sourceRef).toBe(`BLS:${CPI_SERIES}@2026-10-17`);
    expect(result?.value).toBeCloseTo(3.8, 6);
  });

  it('computes DIFF for NFP from the prior month', async () => {
    const bls = fakeBlsWith({}, { '2026-08': 159_015, '2026-09': 159_044 });
    const resolver = createBlsNativeResolver(bls);
    const result = await resolver.resolve(nfpMapping, '2026-09', '2026-10-02');
    expect(result).toEqual({ value: 29, sourceRef: `BLS:${NFP_SERIES}@2026-10-17` });
  });

  it('returns null (never a guess) when BLS has not published the period yet', async () => {
    const bls = fakeBlsWith({ '2025-10': 320 }, {});
    const resolver = createBlsNativeResolver(cpiMapping ? bls : bls);
    const result = await resolver.resolve(cpiMapping, '2026-10', '2026-11-10');
    expect(result).toBeNull();
  });

  it('returns null and reports the error instead of throwing when the provider fails', async () => {
    const failing: OfficialStatsProvider = {
      name: 'BLS',
      supportsPointInTime: false,
      fetchObservations: () => Promise.reject(new Error('network down')),
    };
    const errors: unknown[] = [];
    const resolver = createBlsNativeResolver(failing, (e) => errors.push(e));
    const result = await resolver.resolve(cpiMapping, '2026-09', '2026-10-14');
    expect(result).toBeNull();
    expect(errors).toHaveLength(1);
  });

  it('returns null for a mapping with no BLS official series', async () => {
    const noBls: IndicatorMapping = {
      ...cpiMapping,
      official: [{ source: 'FRED', seriesId: 'X', transform: 'LEVEL' }],
    };
    const resolver = createBlsNativeResolver(fakeBlsWith({}, {}));
    expect(await resolver.resolve(noBls, '2026-09', '2026-10-14')).toBeNull();
  });
});

describe('buildBlsScheduleReleases', () => {
  const NOW = () => new Date('2026-10-17T12:00:00Z');

  it('builds a release for a past, published period with actual/previous/revisedPrevious set', async () => {
    const bls = fakeBlsWith({ '2025-09': 320.0, '2026-09': 332.16, '2025-08': 318.0, '2026-08': 328.0 }, {});
    const resolver = createBlsNativeResolver(bls);
    const entries: BlsScheduleEntry[] = [
      { indicatorCode: 'US_CPI', referencePeriod: '2026-09', releaseDate: '2026-10-14' },
    ];
    const result = await buildBlsScheduleReleases({ official: resolver, entries, now: NOW });

    expect(result.notYetAvailable).toEqual([]);
    expect(result.unmapped).toEqual([]);
    expect(result.releases).toHaveLength(1);
    const release = result.releases[0]!;
    expect(release.provider).toBe('bls_schedule');
    expect(release.providerEventId).toBe('bls_schedule:US_CPI:2026-09');
    expect(release.releaseAtPrecision).toBe('EXACT');
    expect(release.referencePeriod).toBe('2026-09');
    expect(release.forecast).toBeNull();
    expect(release.actual?.unit).toBe('%'); // 332.16/320 − 1 = 3.8%
    expect(release.actual?.value).toBeCloseTo(3.8, 6);
    expect(release.previous?.unit).toBe('%'); // 328/318 − 1 ≈ 3.14%
    expect(release.previous?.value).toBeCloseTo(3.1446541, 6);
    expect(release.revisedPrevious).toEqual(release.previous);
    // 2026-10-14 08:30 America/New_York is EDT (UTC−4) → 12:30Z.
    expect(release.releaseAt).toBe('2026-10-14T12:30:00.000Z');
  });

  it('converts an EST-month release date correctly (winter, UTC−5)', async () => {
    const bls = fakeBlsWith({ '2025-01': 300, '2026-01': 310, '2025-12': 298, '2025-02': 1 /* unused */ }, {});
    const resolver = createBlsNativeResolver(bls);
    const entries: BlsScheduleEntry[] = [
      { indicatorCode: 'US_CPI', referencePeriod: '2026-01', releaseDate: '2026-02-13' },
    ];
    const result = await buildBlsScheduleReleases({ official: resolver, entries, now: () => new Date('2026-03-01Z') });
    expect(result.releases).toHaveLength(1);
    // 2026-02-13 08:30 America/New_York is EST (UTC−5) → 13:30Z.
    expect(result.releases[0]!.releaseAt).toBe('2026-02-13T13:30:00.000Z');
  });

  it('does not build a release for a future-dated entry', async () => {
    const resolver = createBlsNativeResolver(fakeBlsWith({ '2026-10': 999 }, {}));
    const entries: BlsScheduleEntry[] = [
      { indicatorCode: 'US_CPI', referencePeriod: '2026-10', releaseDate: '2026-11-10' },
    ];
    const result = await buildBlsScheduleReleases({ official: resolver, entries, now: NOW });
    expect(result.releases).toEqual([]);
    expect(result.notYetAvailable).toEqual(entries);
  });

  it('does not build a release when the scheduled date has passed but BLS has not published the value', async () => {
    const resolver = createBlsNativeResolver(fakeBlsWith({}, {})); // nothing published
    const entries: BlsScheduleEntry[] = [
      { indicatorCode: 'US_CPI', referencePeriod: '2026-09', releaseDate: '2026-10-14' },
    ];
    const result = await buildBlsScheduleReleases({ official: resolver, entries, now: NOW });
    expect(result.releases).toEqual([]);
    expect(result.notYetAvailable).toEqual(entries);
  });

  it('reports an entry with no mapping as unmapped instead of throwing', async () => {
    const resolver = createBlsNativeResolver(fakeBlsWith({}, {}));
    const entries = [
      { indicatorCode: 'US_CORE_CPI', referencePeriod: '2026-09', releaseDate: '2026-10-14' },
    ] as unknown as BlsScheduleEntry[]; // US_CORE_CPI has no bls_schedule provider key
    const result = await buildBlsScheduleReleases({ official: resolver, entries, now: NOW });
    expect(result.releases).toEqual([]);
    expect(result.unmapped).toEqual(entries);
  });
});

describe('BLS schedule → ingestCalendarReleases (no paid calendar involved)', () => {
  let store: MemoryIngestionStore;

  beforeEach(() => {
    store = new MemoryIngestionStore();
    store.indicators = [
      { id: 'ind-cpi', code: 'US_CPI', importance: 'HIGH', favorable_direction: 'HIGHER_IS_POSITIVE' },
    ];
  });

  it('publishes a VERIFIED snapshot (actual and the cross-check share the same BLS resolver)', async () => {
    const bls = fakeBlsWith({ '2025-09': 320.0, '2026-09': 332.16 }, {});
    const official = createBlsNativeResolver(bls);
    const entries: BlsScheduleEntry[] = [
      { indicatorCode: 'US_CPI', referencePeriod: '2026-09', releaseDate: '2026-10-14' },
    ];
    const { releases } = await buildBlsScheduleReleases({ official, entries, now: () => new Date('2026-10-17Z') });

    const counters = new JobCounters();
    await ingestCalendarReleases(
      'bls_schedule',
      releases,
      { store, official, now: () => new Date('2026-10-17Z') },
      counters,
    );

    expect(counters.errorMessages).toEqual([]);
    const event = store.events.find((e) => e.provider_event_id === 'bls_schedule:US_CPI:2026-09');
    expect(event?.status).toBe('RELEASED');
    expect(event?.release_datetime_precision).toBe('EXACT');
    const snapshot = store.snapshots.find((s) => s.event_id === event!.id);
    expect(snapshot).toMatchObject({ verification_status: 'VERIFIED', source: 'U.S. Bureau of Labor Statistics' });
    expect(snapshot?.actual).toBeCloseTo(3.8, 6);
  });

  it('records a revision when a later run sees BLS has revised the previous month', async () => {
    const official1 = createBlsNativeResolver(
      fakeBlsWith({ '2025-09': 320.0, '2026-09': 332.16, '2025-08': 318.0, '2026-08': 328.0 }, {}),
    );
    const entries: BlsScheduleEntry[] = [
      { indicatorCode: 'US_CPI', referencePeriod: '2026-09', releaseDate: '2026-10-14' },
    ];
    const first = await buildBlsScheduleReleases({ official: official1, entries, now: () => new Date('2026-10-17Z') });
    await ingestCalendarReleases(
      'bls_schedule',
      first.releases,
      { store, official: official1, now: () => new Date('2026-10-17Z') },
      new JobCounters(),
    );

    // A later run: August's YoY CPI has been revised from 3.14% to 3.20%.
    const official2 = createBlsNativeResolver(
      fakeBlsWith({ '2025-09': 320.0, '2026-09': 332.16, '2025-08': 318.0, '2026-08': 328.2 }, {}),
    );
    const second = await buildBlsScheduleReleases({ official: official2, entries, now: () => new Date('2026-11-01Z') });
    const counters = new JobCounters();
    await ingestCalendarReleases(
      'bls_schedule',
      second.releases,
      { store, official: official2, now: () => new Date('2026-11-01Z') },
      counters,
    );

    const event = store.events.find((e) => e.provider_event_id === 'bls_schedule:US_CPI:2026-09')!;
    const revisions = store.revisions.filter((r) => r.event_id === event.id);
    expect(revisions).toHaveLength(1);
    expect(revisions[0]?.field_name).toBe('PREVIOUS');
    expect(revisions[0]?.old_value).toBeCloseTo(3.1447, 4);
    expect(revisions[0]?.new_value).toBeCloseTo(3.2075, 4);
  });
});
