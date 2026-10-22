import { beforeEach, describe, expect, it } from 'vitest';
import { BLS_SCHEDULE, type BlsScheduleEntry } from '../../src/ingestion/mappings/blsSchedule.js';
import { findMappingByCode, type IndicatorMapping } from '../../src/ingestion/mappings/indicators.js';
import {
  buildBlsScheduleReleases,
  createBlsNativeResolver,
  readOnlyIngestionStore,
  runBlsCalendarIngestion,
  scheduleObservationRange,
  syncBlsScheduledEvents,
} from '../../src/ingestion/pipelines/blsCalendar.js';
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

/** Wide enough for every fixture period below (never the real schedule's exact range). */
const WIDE_RANGE = { start: '2024-01-01', end: '2027-12-31' };

describe('createBlsNativeResolver', () => {
  const cpiMapping = findMappingByCode('US_CPI')!;
  const nfpMapping = findMappingByCode('US_NFP')!;

  it('computes YOY_PCT for CPI from 12 months back, at any asOfDate age', async () => {
    const bls = fakeBlsWith({ '2025-09': 320.0, '2026-09': 332.16 }, {});
    const resolver = createBlsNativeResolver(bls, WIDE_RANGE);
    // 2026-09 YoY, asked as-of an old date far in the past: must still resolve (no 20-day staleness gate).
    const result = await resolver.resolve(cpiMapping, '2026-09', '2026-10-14');
    expect(result?.sourceRef).toBe(`BLS:${CPI_SERIES}@2026-10-17`);
    expect(result?.value).toBeCloseTo(3.8, 6);
  });

  it('computes DIFF for NFP from the prior month', async () => {
    const bls = fakeBlsWith({}, { '2026-08': 159_015, '2026-09': 159_044 });
    const resolver = createBlsNativeResolver(bls, WIDE_RANGE);
    const result = await resolver.resolve(nfpMapping, '2026-09', '2026-10-02');
    expect(result).toEqual({ value: 29, sourceRef: `BLS:${NFP_SERIES}@2026-10-17` });
  });

  it('returns null (never a guess) when BLS has not published the period yet', async () => {
    const bls = fakeBlsWith({ '2025-10': 320 }, {});
    const resolver = createBlsNativeResolver(bls, WIDE_RANGE);
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
    const resolver = createBlsNativeResolver(failing, WIDE_RANGE, (e) => errors.push(e));
    const result = await resolver.resolve(cpiMapping, '2026-09', '2026-10-14');
    expect(result).toBeNull();
    expect(errors).toHaveLength(1);
  });

  it('returns null for a mapping with no BLS official series', async () => {
    const noBls: IndicatorMapping = {
      ...cpiMapping,
      official: [{ source: 'FRED', seriesId: 'X', transform: 'LEVEL' }],
    };
    const resolver = createBlsNativeResolver(fakeBlsWith({}, {}), WIDE_RANGE);
    expect(await resolver.resolve(noBls, '2026-09', '2026-10-14')).toBeNull();
  });

  it('fetches a series only once no matter how many different periods are resolved (BLS v1: 25 requests/day)', async () => {
    const bls = fakeBlsWith(
      { '2025-01': 300, '2025-09': 320, '2026-09': 332.16, '2025-08': 318, '2026-08': 328 },
      { '2026-08': 159_015, '2026-09': 159_044 },
    );
    const resolver = createBlsNativeResolver(bls, WIDE_RANGE);
    await resolver.resolve(cpiMapping, '2026-09', '2026-10-14');
    await resolver.resolve(cpiMapping, '2026-08', '2026-10-14'); // same series, different period
    await resolver.resolve(cpiMapping, '2025-09', '2026-10-14'); // same series again
    await resolver.resolve(nfpMapping, '2026-09', '2026-10-02'); // a different series
    expect(bls.calls).toHaveLength(2); // one per series (CUUR0000SA0, CES0000000001), not per period
    expect(bls.calls.map((c) => c.seriesId).sort()).toEqual([NFP_SERIES, CPI_SERIES].sort());
  });
});

describe('scheduleObservationRange', () => {
  it('spans 12 months before the earliest reference period through the latest one', () => {
    const entries: BlsScheduleEntry[] = [
      { indicatorCode: 'US_CPI', referencePeriod: '2026-03', releaseDate: '2026-04-10' },
      { indicatorCode: 'US_NFP', referencePeriod: '2026-09', releaseDate: '2026-10-02' },
      { indicatorCode: 'US_CPI', referencePeriod: '2026-01', releaseDate: '2026-02-13' },
    ];
    expect(scheduleObservationRange(entries)).toEqual({ start: '2025-01-01', end: '2026-09-01' });
  });
});

describe('buildBlsScheduleReleases', () => {
  const NOW = () => new Date('2026-10-17T12:00:00Z');

  it('builds a release for a past, published period with actual/previous/revisedPrevious set', async () => {
    const bls = fakeBlsWith({ '2025-09': 320.0, '2026-09': 332.16, '2025-08': 318.0, '2026-08': 328.0 }, {});
    const resolver = createBlsNativeResolver(bls, WIDE_RANGE);
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
    const resolver = createBlsNativeResolver(bls, WIDE_RANGE);
    const entries: BlsScheduleEntry[] = [
      { indicatorCode: 'US_CPI', referencePeriod: '2026-01', releaseDate: '2026-02-13' },
    ];
    const result = await buildBlsScheduleReleases({ official: resolver, entries, now: () => new Date('2026-03-01Z') });
    expect(result.releases).toHaveLength(1);
    // 2026-02-13 08:30 America/New_York is EST (UTC−5) → 13:30Z.
    expect(result.releases[0]!.releaseAt).toBe('2026-02-13T13:30:00.000Z');
  });

  it('does not build a release for a future-dated entry', async () => {
    const resolver = createBlsNativeResolver(fakeBlsWith({ '2026-10': 999 }, {}), WIDE_RANGE);
    const entries: BlsScheduleEntry[] = [
      { indicatorCode: 'US_CPI', referencePeriod: '2026-10', releaseDate: '2026-11-10' },
    ];
    const result = await buildBlsScheduleReleases({ official: resolver, entries, now: NOW });
    expect(result.releases).toEqual([]);
    expect(result.notYetAvailable).toEqual(entries);
  });

  it('does not build a release when the scheduled date has passed but BLS has not published the value', async () => {
    const resolver = createBlsNativeResolver(fakeBlsWith({}, {}), WIDE_RANGE); // nothing published
    const entries: BlsScheduleEntry[] = [
      { indicatorCode: 'US_CPI', referencePeriod: '2026-09', releaseDate: '2026-10-14' },
    ];
    // NOW is only 3 days after the scheduled date — a normal wait, not overdue.
    const result = await buildBlsScheduleReleases({ official: resolver, entries, now: NOW });
    expect(result.releases).toEqual([]);
    expect(result.notYetAvailable).toEqual(entries);
    expect(result.overdue).toEqual([]);
  });

  it('flags an entry as overdue once OVERDUE_AFTER_DAYS have passed with still no BLS value (likely a BLS reschedule, not a normal wait)', async () => {
    const resolver = createBlsNativeResolver(fakeBlsWith({}, {}), WIDE_RANGE); // nothing published, ever
    const entries: BlsScheduleEntry[] = [
      { indicatorCode: 'US_CPI', referencePeriod: '2026-09', releaseDate: '2026-10-14' },
    ];
    // 60 days after the scheduled date (> OVERDUE_AFTER_DAYS = 45): still nothing from BLS.
    const result = await buildBlsScheduleReleases({
      official: resolver,
      entries,
      now: () => new Date('2026-12-13T12:00:00Z'),
    });
    expect(result.releases).toEqual([]);
    expect(result.notYetAvailable).toEqual(entries); // overdue is a subset of notYetAvailable, not a separate bucket
    expect(result.overdue).toEqual(entries);
  });

  it('reports an entry with no mapping as unmapped instead of throwing', async () => {
    const resolver = createBlsNativeResolver(fakeBlsWith({}, {}), WIDE_RANGE);
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
    const official = createBlsNativeResolver(bls, WIDE_RANGE);
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
      WIDE_RANGE,
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
      WIDE_RANGE,
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

describe('syncBlsScheduledEvents (future releases → SCHEDULED rows, from the table alone)', () => {
  let store: MemoryIngestionStore;
  const NOW = () => new Date('2026-10-22T00:00:00Z');
  const nfpNov: BlsScheduleEntry = { indicatorCode: 'US_NFP', referencePeriod: '2026-10', releaseDate: '2026-11-06' };
  const cpiSummer: BlsScheduleEntry = {
    indicatorCode: 'US_CPI',
    referencePeriod: '2027-06',
    releaseDate: '2027-07-14',
  };

  beforeEach(() => {
    store = new MemoryIngestionStore();
    store.indicators = [
      { id: 'ind-cpi', code: 'US_CPI', importance: 'HIGH', favorable_direction: 'HIGHER_IS_POSITIVE' },
      { id: 'ind-nfp', code: 'US_NFP', importance: 'HIGH', favorable_direction: 'HIGHER_IS_POSITIVE' },
    ];
  });

  async function sync(entries: readonly BlsScheduleEntry[], now: () => Date = NOW) {
    const counters = new JobCounters();
    const counts = await syncBlsScheduledEvents({ store, entries, now }, counters);
    return { counts, counters };
  }

  it('inserts one SCHEDULED row per future entry with the DST-correct UTC instant and no values', async () => {
    const { counts, counters } = await sync([nfpNov, cpiSummer]);
    expect(counters.errorMessages).toEqual([]);
    expect(counts).toEqual({
      scheduled_inserted: 2,
      scheduled_updated: 0,
      scheduled_unchanged: 0,
      cancelled: 0,
      cancelled_unchanged: 0,
    });
    expect(counters.details.scheduled_inserted).toBe(2);
    expect(store.events).toHaveLength(2);
    // 2026-11-06 is after US DST ended (2026-11-01): 08:30 EST (UTC-5) is 13:30Z.
    expect(store.events.find((e) => e.provider_event_id === 'bls_schedule:US_NFP:2026-10')).toMatchObject({
      provider: 'bls_schedule',
      indicator_id: 'ind-nfp',
      release_datetime: '2026-11-06T13:30:00.000Z',
      release_datetime_precision: 'EXACT',
      status: 'SCHEDULED',
      data_status: 'PENDING',
      importance: 'HIGH',
    });
    // 2027-07-14 is in EDT (UTC-4): 12:30Z.
    expect(store.events.find((e) => e.provider_event_id === 'bls_schedule:US_CPI:2027-06')?.release_datetime).toBe(
      '2027-07-14T12:30:00.000Z',
    );
    expect(store.snapshots).toEqual([]);
    expect(store.staged).toEqual([]);
    expect(store.scheduleChanges).toEqual([]);
    // Existing counters keep their meaning: the schedule part is not a fetch / success.
    expect([counters.fetched, counters.success, counters.skipped, counters.review]).toEqual([0, 0, 0, 0]);
  });

  it('is idempotent: a re-run writes nothing and counts the rows as unchanged', async () => {
    await sync([nfpNov, cpiSummer]);
    const { counts } = await sync([nfpNov, cpiSummer]);
    expect(store.events).toHaveLength(2);
    expect(counts).toMatchObject({ scheduled_inserted: 0, scheduled_updated: 0, scheduled_unchanged: 2 });
    expect(store.scheduleChanges).toEqual([]);
  });

  it('a date changed in the table updates the SAME row (trigger records RESCHEDULED)', async () => {
    await sync([nfpNov]);
    const id = store.events[0]!.id;
    const { counts, counters } = await sync([{ ...nfpNov, releaseDate: '2026-11-13' }]);
    expect(counts).toMatchObject({ scheduled_inserted: 0, scheduled_updated: 1, scheduled_unchanged: 0 });
    expect(store.events).toHaveLength(1);
    expect(store.events[0]).toMatchObject({ id, release_datetime: '2026-11-13T13:30:00.000Z', status: 'SCHEDULED' });
    expect(counters.details.schedule_rescheduled).toEqual([
      {
        provider_event_id: 'bls_schedule:US_NFP:2026-10',
        from: '2026-11-06T13:30:00.000Z',
        to: '2026-11-13T13:30:00.000Z',
      },
    ]);
    expect(store.scheduleChanges).toEqual([
      {
        target_id: id,
        change_type: 'RESCHEDULED',
        old_datetime: '2026-11-06T13:30:00.000Z',
        new_datetime: '2026-11-13T13:30:00.000Z',
      },
    ]);
  });

  it('after the release, the RELEASED path turns the same SCHEDULED row into RELEASED with values (no second row)', async () => {
    const entry: BlsScheduleEntry = { indicatorCode: 'US_CPI', referencePeriod: '2026-10', releaseDate: '2026-11-10' };
    await sync([entry]);
    expect(store.events).toHaveLength(1);
    const id = store.events[0]!.id;

    // A later run, after 2026-11-10 08:30 ET, when BLS has published October.
    const later = () => new Date('2026-11-12T00:00:00Z');
    const counters = new JobCounters();
    const counts = await syncBlsScheduledEvents({ store, entries: [entry], now: later }, counters);
    expect(counts).toMatchObject({ scheduled_inserted: 0, scheduled_updated: 0, scheduled_unchanged: 0 });
    const official = createBlsNativeResolver(fakeBlsWith({ '2025-10': 320.0, '2026-10': 332.8 }, {}), WIDE_RANGE);
    const built = await buildBlsScheduleReleases({ official, entries: [entry], now: later });
    expect(built.releases).toHaveLength(1);
    await ingestCalendarReleases('bls_schedule', built.releases, { store, official, now: later }, counters);

    expect(counters.errorMessages).toEqual([]);
    expect(store.events).toHaveLength(1);
    expect(store.events[0]).toMatchObject({
      id,
      status: 'RELEASED',
      data_status: 'AVAILABLE',
      release_datetime: '2026-11-10T13:30:00.000Z',
    });
    const snapshot = store.snapshots.find((s) => s.event_id === id);
    expect(snapshot?.verification_status).toBe('VERIFIED');
    expect(snapshot?.actual).toBeCloseTo(4.0, 6);
    expect(store.scheduleChanges).toEqual([]); // released, not rescheduled
  });

  it('a cancelled entry turns an existing SCHEDULED row CANCELLED (trigger records CANCELLED) and is never built into a release', async () => {
    await sync([nfpNov]);
    const id = store.events[0]!.id;
    const cancelledEntry: BlsScheduleEntry = {
      ...nfpNov,
      cancelled: true,
      cancelledNote: 'https://www.bls.gov/schedule/news_release/empsit.htm (test fixture)',
    };
    const { counts } = await sync([cancelledEntry]);
    expect(counts).toMatchObject({ cancelled: 1, scheduled_unchanged: 0 });
    expect(store.events).toHaveLength(1);
    expect(store.events[0]).toMatchObject({ id, status: 'CANCELLED', data_status: 'UNAVAILABLE' });
    expect(store.scheduleChanges).toEqual([
      { target_id: id, change_type: 'CANCELLED', old_datetime: '2026-11-06T13:30:00.000Z', new_datetime: null },
    ]);

    const again = await sync([cancelledEntry]);
    expect(again.counts).toMatchObject({ cancelled: 0, cancelled_unchanged: 1 });
    expect(store.scheduleChanges).toHaveLength(1);

    // Even long after its date, a cancelled entry is neither a release nor overdue.
    const official = createBlsNativeResolver(fakeBlsWith({}, { '2026-09': 1, '2026-10': 2 }), WIDE_RANGE);
    const built = await buildBlsScheduleReleases({
      official,
      entries: [cancelledEntry],
      now: () => new Date('2027-01-31T00:00:00Z'),
    });
    expect(built.releases).toEqual([]);
    expect(built.overdue).toEqual([]);
    expect(built.cancelled).toEqual([cancelledEntry]);
  });

  it('a cancelled entry with no row is inserted as CANCELLED (shown in the calendar; no trigger fires on insert)', async () => {
    const { counts } = await sync([{ ...cpiSummer, cancelled: true, cancelledNote: 'test fixture' }]);
    expect(counts).toMatchObject({ cancelled: 1, scheduled_inserted: 0 });
    expect(store.events).toHaveLength(1);
    expect(store.events[0]).toMatchObject({
      provider_event_id: 'bls_schedule:US_CPI:2027-06',
      status: 'CANCELLED',
      data_status: 'UNAVAILABLE',
      release_datetime: '2027-07-14T12:30:00.000Z',
    });
    expect(store.scheduleChanges).toEqual([]);
  });

  it('never cancels, reschedules or reinstates a RELEASED / CANCELLED row (noted for a human instead)', async () => {
    store.events.push({
      id: 'event-released',
      indicator_id: 'ind-nfp',
      provider: 'bls_schedule',
      provider_event_id: 'bls_schedule:US_NFP:2026-10',
      release_datetime: '2026-11-06T13:30:00.000Z',
      release_datetime_precision: 'EXACT',
      importance: 'HIGH',
      status: 'RELEASED',
      data_status: 'AVAILABLE',
    });
    store.events.push({
      id: 'event-cancelled',
      indicator_id: 'ind-cpi',
      provider: 'bls_schedule',
      provider_event_id: 'bls_schedule:US_CPI:2027-06',
      release_datetime: '2027-07-14T12:30:00.000Z',
      release_datetime_precision: 'EXACT',
      importance: 'HIGH',
      status: 'CANCELLED',
      data_status: 'UNAVAILABLE',
    });
    const { counters } = await sync([
      { ...nfpNov, releaseDate: '2026-11-20' },
      { ...nfpNov, cancelled: true, cancelledNote: 'test fixture' },
      cpiSummer,
    ]);
    expect(store.events[0]).toMatchObject({ status: 'RELEASED', release_datetime: '2026-11-06T13:30:00.000Z' });
    expect(store.events[1]).toMatchObject({ status: 'CANCELLED' });
    expect(counters.details.schedule_entry_conflict).toEqual([
      { provider_event_id: 'bls_schedule:US_NFP:2026-10', entry: 'SCHEDULED', row: 'RELEASED' },
      { provider_event_id: 'bls_schedule:US_NFP:2026-10', entry: 'CANCELLED', row: 'RELEASED' },
      { provider_event_id: 'bls_schedule:US_CPI:2027-06', entry: 'SCHEDULED', row: 'CANCELLED' },
    ]);
    expect(store.scheduleChanges).toEqual([]);
  });

  it('a row whose entry was removed from the table is noted and left untouched (never auto-cancelled)', async () => {
    await sync([nfpNov, cpiSummer]);
    const { counters } = await sync([cpiSummer]);
    const removed = store.events.find((e) => e.provider_event_id === 'bls_schedule:US_NFP:2026-10');
    expect(removed).toMatchObject({ status: 'SCHEDULED', release_datetime: '2026-11-06T13:30:00.000Z' });
    expect(counters.details.schedule_rows_not_in_table).toEqual([
      {
        provider_event_id: 'bls_schedule:US_NFP:2026-10',
        status: 'SCHEDULED',
        release_datetime: '2026-11-06T13:30:00.000Z',
      },
    ]);
    expect(store.scheduleChanges).toEqual([]);
  });

  it('leaves past entries to the existing RELEASED path (no row created for them here)', async () => {
    const past: BlsScheduleEntry = { indicatorCode: 'US_CPI', referencePeriod: '2026-09', releaseDate: '2026-10-14' };
    const { counts } = await sync([past]);
    expect(counts.scheduled_inserted).toBe(0);
    expect(store.events).toEqual([]);
  });

  it('keeps overdue detection working for a SCHEDULED row whose date passed long ago with no BLS value', async () => {
    const entry: BlsScheduleEntry = { indicatorCode: 'US_CPI', referencePeriod: '2026-10', releaseDate: '2026-11-10' };
    await sync([entry]); // registered while still in the future
    const muchLater = () => new Date('2027-01-15T00:00:00Z'); // > OVERDUE_AFTER_DAYS after 2026-11-10
    await sync([entry], muchLater);
    const built = await buildBlsScheduleReleases({
      official: createBlsNativeResolver(fakeBlsWith({}, {}), WIDE_RANGE),
      entries: [entry],
      now: muchLater,
    });
    expect(built.overdue).toEqual([entry]);
    expect(store.events).toHaveLength(1);
    expect(store.events[0]).toMatchObject({ status: 'SCHEDULED', release_datetime: '2026-11-10T13:30:00.000Z' });
  });

  it('skips an indicator without an economic_indicators row (noted) without failing the others', async () => {
    store.indicators = store.indicators.filter((i) => i.code !== 'US_NFP');
    const { counts, counters } = await sync([nfpNov, cpiSummer]);
    expect(counts.scheduled_inserted).toBe(1);
    expect(counters.details.indicator_not_in_db).toEqual(['US_NFP']);
  });

  it('the real BLS_SCHEDULE table: every future entry gets one SCHEDULED row at 08:30 New York time', async () => {
    const counters = new JobCounters();
    const counts = await syncBlsScheduledEvents({ store, now: NOW }, counters);
    expect(counters.errorMessages).toEqual([]);
    const future = BLS_SCHEDULE.filter((e) => e.releaseDate > '2026-10-22');
    expect(future.length).toBeGreaterThan(0);
    expect(counts.scheduled_inserted).toBe(future.length);
    expect(new Set(store.events.map((e) => e.provider_event_id)).size).toBe(future.length);
    const newYork = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'America/New_York',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    for (const event of store.events) expect(newYork.format(new Date(event.release_datetime))).toBe('08:30');
  });
});

describe('runBlsCalendarIngestion (the job body): a failing scheduled sync never stops the RELEASED path', () => {
  const NOW = () => new Date('2026-10-22T00:00:00Z');
  const cpiSep: BlsScheduleEntry = { indicatorCode: 'US_CPI', referencePeriod: '2026-09', releaseDate: '2026-10-14' };
  const nfpNov: BlsScheduleEntry = { indicatorCode: 'US_NFP', referencePeriod: '2026-10', releaseDate: '2026-11-06' };
  const official = () => createBlsNativeResolver(fakeBlsWith({ '2025-09': 320.0, '2026-09': 332.16 }, {}), WIDE_RANGE);

  function withIndicators<T extends MemoryIngestionStore>(store: T): T {
    store.indicators = [
      { id: 'ind-cpi', code: 'US_CPI', importance: 'HIGH', favorable_direction: 'HIGHER_IS_POSITIVE' as const },
      { id: 'ind-nfp', code: 'US_NFP', importance: 'HIGH', favorable_direction: 'HIGHER_IS_POSITIVE' as const },
    ];
    return store;
  }

  function eventOf(store: MemoryIngestionStore, providerEventId: string) {
    return store.events.find((e) => e.provider_event_id === providerEventId);
  }

  it('the indicator lookup throws (once) → the past release is still ingested and the sync error is recorded', async () => {
    class LookupFailsOnce extends MemoryIngestionStore {
      failed = false;
      override findIndicatorsByCode(codes: readonly string[]) {
        if (!this.failed) {
          this.failed = true;
          return Promise.reject(new Error('connection reset'));
        }
        return super.findIndicatorsByCode(codes);
      }
    }
    const store = withIndicators(new LookupFailsOnce());
    const counters = new JobCounters();
    const { scheduledSyncErrors } = await runBlsCalendarIngestion(
      { store, official: official(), entries: [cpiSep, nfpNov], now: NOW },
      counters,
    );

    expect(scheduledSyncErrors).toBe(1);
    expect(counters.details.scheduled_sync_errors).toBe(1);
    expect(counters.errorMessages).toEqual(['scheduled_sync: aborted: connection reset']);
    // The counts still reach details (all 0: nothing was registered).
    expect(counters.details).toMatchObject({ scheduled_inserted: 0, scheduled_updated: 0, scheduled_unchanged: 0 });
    // The RELEASED path ran: CPI September is RELEASED; no future row was made.
    expect(eventOf(store, 'bls_schedule:US_CPI:2026-09')?.status).toBe('RELEASED');
    expect(counters.success).toBe(1);
    expect(eventOf(store, 'bls_schedule:US_NFP:2026-10')).toBeUndefined();
  });

  it('listing un-released rows throws → rows already inserted are counted, the error recorded, the past path still runs', async () => {
    class ListFails extends MemoryIngestionStore {
      override listUnreleasedEventsByProvider(): never {
        throw new Error('statement timeout');
      }
    }
    const store = withIndicators(new ListFails());
    const counters = new JobCounters();
    const { scheduledSyncErrors } = await runBlsCalendarIngestion(
      { store, official: official(), entries: [cpiSep, nfpNov], now: NOW },
      counters,
    );

    expect(scheduledSyncErrors).toBe(1);
    expect(counters.errorMessages).toEqual([
      'scheduled_sync: schedule_rows_not_in_table check failed: statement timeout',
    ]);
    expect(counters.details.scheduled_inserted).toBe(1);
    expect(eventOf(store, 'bls_schedule:US_NFP:2026-10')?.status).toBe('SCHEDULED');
    expect(eventOf(store, 'bls_schedule:US_CPI:2026-09')?.status).toBe('RELEASED');
  });

  it('a per-entry insert failure is recorded with the prefix and the past path continues', async () => {
    class InsertNfpFails extends MemoryIngestionStore {
      override insertEvent(event: Parameters<MemoryIngestionStore['insertEvent']>[0]) {
        if (event.provider_event_id === 'bls_schedule:US_NFP:2026-10')
          return Promise.reject(new Error('duplicate key'));
        return super.insertEvent(event);
      }
    }
    const store = withIndicators(new InsertNfpFails());
    const counters = new JobCounters();
    const { scheduledSyncErrors } = await runBlsCalendarIngestion(
      { store, official: official(), entries: [cpiSep, nfpNov], now: NOW },
      counters,
    );
    expect(scheduledSyncErrors).toBe(1);
    expect(counters.errorMessages).toEqual(['scheduled_sync: bls_schedule:US_NFP:2026-10: duplicate key']);
    expect(eventOf(store, 'bls_schedule:US_CPI:2026-09')?.status).toBe('RELEASED');
  });

  it('no failure → scheduled_sync_errors 0, a SCHEDULED future row and the RELEASED past row', async () => {
    const store = withIndicators(new MemoryIngestionStore());
    const counters = new JobCounters();
    const { scheduledSyncErrors } = await runBlsCalendarIngestion(
      { store, official: official(), entries: [cpiSep, nfpNov], now: NOW },
      counters,
    );
    expect(scheduledSyncErrors).toBe(0);
    expect(counters.errorMessages).toEqual([]);
    expect(counters.details).toMatchObject({ scheduled_sync_errors: 0, scheduled_inserted: 1, not_yet_available: 1 });
    expect(store.events.map((e) => [e.provider_event_id, e.status]).sort()).toEqual([
      ['bls_schedule:US_CPI:2026-09', 'RELEASED'],
      ['bls_schedule:US_NFP:2026-10', 'SCHEDULED'],
    ]);
  });
});

describe('when a schedule change is / is not recorded (event_schedule_changes, dev-environment.md §11)', () => {
  let store: MemoryIngestionStore;
  const entry: BlsScheduleEntry = { indicatorCode: 'US_CPI', referencePeriod: '2026-10', releaseDate: '2026-11-10' };
  const moved: BlsScheduleEntry = { ...entry, releaseDate: '2026-11-17' };

  beforeEach(() => {
    store = new MemoryIngestionStore();
    store.indicators = [
      { id: 'ind-cpi', code: 'US_CPI', importance: 'HIGH', favorable_direction: 'HIGHER_IS_POSITIVE' as const },
    ];
  });

  /** One job run at `at`; `published` = whether BLS has published October by then. */
  async function run(entries: readonly BlsScheduleEntry[], at: string, published: boolean) {
    const values: Record<string, number> = published ? { '2025-10': 320.0, '2026-10': 332.8 } : { '2025-10': 320.0 };
    const official = createBlsNativeResolver(fakeBlsWith(values, {}), WIDE_RANGE);
    const counters = new JobCounters();
    await runBlsCalendarIngestion({ store, official, entries, now: () => new Date(at) }, counters);
    expect(counters.errorMessages).toEqual([]);
  }

  it('table fixed only after BOTH dates passed: the release update itself records RESCHEDULED (row was still SCHEDULED)', async () => {
    await run([entry], '2026-10-22T00:00:00Z', false); // SCHEDULED at 11-10
    // BLS moved it to 11-17 and nobody fixed the table. On 11-12 the table date has passed but BLS has
    // not published → the row stays SCHEDULED at the old instant.
    await run([entry], '2026-11-12T00:00:00Z', false);
    expect(store.events[0]).toMatchObject({ status: 'SCHEDULED', release_datetime: '2026-11-10T13:30:00.000Z' });
    // Table fixed on 11-20 (after 11-17, BLS has published): the sync skips the past entry; the RELEASED
    // path changes release_datetime and status in ONE update → the trigger sees OLD.status = SCHEDULED.
    await run([moved], '2026-11-20T00:00:00Z', true);
    expect(store.events[0]).toMatchObject({ status: 'RELEASED', release_datetime: '2026-11-17T13:30:00.000Z' });
    expect(store.scheduleChanges).toEqual([
      {
        target_id: store.events[0]!.id,
        change_type: 'RESCHEDULED',
        old_datetime: '2026-11-10T13:30:00.000Z',
        new_datetime: '2026-11-17T13:30:00.000Z',
      },
    ]);
  });

  it('table fixed after the row became RELEASED: the stored time is kept and nothing is recorded', async () => {
    await run([entry], '2026-10-22T00:00:00Z', false);
    await run([entry], '2026-11-12T00:00:00Z', true); // published → RELEASED at the table's 11-10
    expect(store.events[0]?.status).toBe('RELEASED');
    await run([moved], '2026-11-20T00:00:00Z', true);
    expect(store.events[0]).toMatchObject({ status: 'RELEASED', release_datetime: '2026-11-10T13:30:00.000Z' });
    expect(store.scheduleChanges).toEqual([]);
  });
});

describe('dry run (syncBlsScheduledEvents dryRun + readOnlyIngestionStore): writes nothing', () => {
  const NOW = () => new Date('2026-10-22T00:00:00Z');
  const indicators = [
    { id: 'ind-cpi', code: 'US_CPI', importance: 'HIGH' as const, favorable_direction: 'HIGHER_IS_POSITIVE' as const },
    { id: 'ind-nfp', code: 'US_NFP', importance: 'HIGH' as const, favorable_direction: 'HIGHER_IS_POSITIVE' as const },
  ];

  it('the real table on 2026-10-22: reports the same 28 inserts a real run makes, without writing', async () => {
    const store = new MemoryIngestionStore();
    store.indicators = [...indicators];
    const counters = new JobCounters();
    const counts = await syncBlsScheduledEvents(
      { store: readOnlyIngestionStore(store), now: NOW, dryRun: true },
      counters,
    );
    expect(counters.errorMessages).toEqual([]);
    expect(store.events).toEqual([]);
    expect(store.scheduleChanges).toEqual([]);

    const realCounts = await syncBlsScheduledEvents({ store, now: NOW }, new JobCounters());
    expect(counts).toEqual(realCounts);
    expect(counts.scheduled_inserted).toBe(28);
    const writes = counters.details.dry_run_writes as { action: string; provider_event_id: string }[];
    expect(writes).toHaveLength(28);
    expect(writes.every((w) => w.action === 'insert')).toBe(true);
    expect(writes.map((w) => w.provider_event_id).sort()).toEqual(store.events.map((e) => e.provider_event_id).sort());
  });

  it('the read-only store rejects every write method and passes reads through', async () => {
    const readOnly = readOnlyIngestionStore(new MemoryIngestionStore());
    await expect(readOnly.findEventByProviderId('bls_schedule', 'x')).resolves.toBeNull();
    await expect(readOnly.listUnreleasedEventsByProvider('bls_schedule')).resolves.toEqual([]);
    await expect(readOnly.insertEvent({} as never)).rejects.toThrow(/read-only store: insertEvent/);
    await expect(readOnly.updateEvent('id', {})).rejects.toThrow(/read-only store: updateEvent/);
    await expect(readOnly.insertIngestionLog({} as never)).rejects.toThrow(/read-only store/);
    await expect(readOnly.reserveApiCredits({} as never)).rejects.toThrow(/read-only store/);
  });

  it('even if dryRun were forgotten, the read-only store turns each write into a recorded error (no row)', async () => {
    const store = new MemoryIngestionStore();
    store.indicators = [...indicators];
    const counters = new JobCounters();
    await syncBlsScheduledEvents(
      {
        store: readOnlyIngestionStore(store),
        entries: [{ indicatorCode: 'US_NFP', referencePeriod: '2026-10', releaseDate: '2026-11-06' }],
        now: NOW,
      },
      counters,
    );
    expect(store.events).toEqual([]);
    expect(counters.errorMessages[0]).toMatch(/read-only store: insertEvent/);
  });
});
