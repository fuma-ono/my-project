/**
 * 米国コアCPI・失業率・平均時給(HQ指示 2026-10-26)を、US_CPI・US_NFP と同じ BLS の公式発表
 * スケジュール経路(blsCalendar.ts)で取り込めること。既存の US_CPI・US_NFP の予定・値は変わらないこと。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  BLS_SCHEDULE,
  CPI_RELEASE_INDICATORS,
  EMPSIT_RELEASE_INDICATORS,
  type BlsScheduleEntry,
} from '../../src/ingestion/mappings/blsSchedule.js';
import { findMappingByCode } from '../../src/ingestion/mappings/indicators.js';
import {
  blsScheduleEventId,
  buildBlsScheduleReleases,
  createBlsNativeResolver,
  createBlsSecondaryResolver,
  planBlsScheduleWrites,
  scheduleObservationRange,
} from '../../src/ingestion/pipelines/blsCalendar.js';
import { ingestCalendarReleases } from '../../src/ingestion/pipelines/economicCalendar.js';
import type { OfficialStatsProvider } from '../../src/ingestion/providers.js';
import { JobCounters } from '../../src/ingestion/runner.js';
import type { OfficialObservation } from '../../src/ingestion/types.js';
import { MemoryIngestionStore } from '../helpers/memoryIngestionStore.js';

/** BLS in memory: series id → month → value. Records each fetch. */
class FakeBls implements OfficialStatsProvider {
  readonly name = 'BLS' as const;
  readonly supportsPointInTime = false;
  calls: string[] = [];
  constructor(private readonly bySeries: Record<string, Record<string, number>>) {}

  fetchObservations(query: { seriesId: string; observationStart: string; observationEnd: string }) {
    this.calls.push(query.seriesId);
    const observations: OfficialObservation[] = Object.entries(this.bySeries[query.seriesId] ?? {}).map(
      ([period, value]) => ({
        source: 'BLS',
        seriesId: query.seriesId,
        periodStart: `${period}-01`,
        value,
        asOfDate: '2026-10-17',
        releaseStatus: 'UNKNOWN',
      }),
    );
    return Promise.resolve(observations);
  }
}

const WIDE_RANGE = { start: '2024-01-01', end: '2027-12-31' };
const NOW = () => new Date('2026-10-17T12:00:00Z');

// 2026-09 の発表(CPI 2026-10-14、雇用統計 2026-10-02)に使う値
const SERIES = {
  CUUR0000SA0L1E: { '2025-08': 298.0, '2025-09': 300.0, '2026-08': 306.0, '2026-09': 309.0 }, // コアCPI 季節調整なし
  CUSR0000SA0L1E: { '2026-07': 328.0, '2026-08': 330.0, '2026-09': 330.99 }, // コアCPI 季節調整済み
  LNS14000000: { '2026-08': 4.3, '2026-09': 4.4 }, // 失業率
  CES0500000003: { '2025-08': 34.9, '2025-09': 35.0, '2026-07': 36.2, '2026-08': 36.3, '2026-09': 36.41 }, // 平均時給(ドル)
  CES0000000001: { '2026-08': 159_015, '2026-09': 159_044 }, // NFP
};

const CORE: BlsScheduleEntry = { indicatorCode: 'US_CORE_CPI', referencePeriod: '2026-09', releaseDate: '2026-10-14' };
const UNEMP: BlsScheduleEntry = {
  indicatorCode: 'US_UNEMPLOYMENT_RATE',
  referencePeriod: '2026-09',
  releaseDate: '2026-10-02',
};
const AHE: BlsScheduleEntry = {
  indicatorCode: 'US_AVG_HOURLY_EARNINGS',
  referencePeriod: '2026-09',
  releaseDate: '2026-10-02',
};
const NFP: BlsScheduleEntry = { indicatorCode: 'US_NFP', referencePeriod: '2026-09', releaseDate: '2026-10-02' };

function resolvers(bls: FakeBls) {
  return {
    official: createBlsNativeResolver(bls, WIDE_RANGE),
    officialSecondary: createBlsSecondaryResolver(bls, WIDE_RANGE),
  };
}

describe('mappings for the 3 added BLS indicators', () => {
  it.each([
    ['US_CORE_CPI', 'CUUR0000SA0L1E', 'YOY_PCT', 'NSA', 'YOY_PCT', 'MOM_PCT', 'CUSR0000SA0L1E'],
    ['US_UNEMPLOYMENT_RATE', 'LNS14000000', 'LEVEL', 'SA', 'LEVEL', undefined, undefined],
    ['US_AVG_HOURLY_EARNINGS', 'CES0500000003', 'MOM_PCT', 'SA', 'MOM_PCT', 'YOY_PCT', 'CES0500000003'],
  ])('%s: BLS %s, %s, %s', (code, seriesId, valueKind, sa, transform, secondaryKind, secondarySeries) => {
    const mapping = findMappingByCode(code)!;
    expect(mapping.providers.bls_schedule).toEqual({ country: 'US', event: code });
    expect(mapping.official).toEqual([{ source: 'BLS', seriesId, transform }]);
    expect(mapping.valueKind).toBe(valueKind);
    expect(mapping.seasonalAdjustment).toBe(sa);
    expect(mapping.unit).toBe('PERCENT');
    expect(mapping.decimals).toBe(1);
    expect(mapping.release).toEqual({ timeZone: 'America/New_York', localTimes: ['08:30'] });
    expect(mapping.requireOfficialMatch).toBe(true);
    expect(mapping.secondary?.valueKind).toBe(secondaryKind);
    expect(mapping.secondary?.official.seriesId).toBe(secondarySeries);
  });

  it('leaves US_CPI and US_NFP as they were', () => {
    const cpi = findMappingByCode('US_CPI')!;
    expect(cpi.official).toEqual([{ source: 'BLS', seriesId: 'CUUR0000SA0', transform: 'YOY_PCT' }]);
    expect(cpi.secondary).toEqual({
      valueKind: 'MOM_PCT',
      official: { source: 'BLS', seriesId: 'CUUR0000SA0', transform: 'MOM_PCT' },
    });
    const nfp = findMappingByCode('US_NFP')!;
    expect(nfp.official).toEqual([{ source: 'BLS', seriesId: 'CES0000000001', transform: 'DIFF' }]);
    expect(nfp.secondary).toBeUndefined();
  });
});

describe('BLS_SCHEDULE for the added indicators', () => {
  const datesOf = (code: string) =>
    BLS_SCHEDULE.filter((e) => e.indicatorCode === code).map((e) => [e.referencePeriod, e.releaseDate]);

  it('keeps the 24 US_CPI and 24 US_NFP entries unchanged', () => {
    const cpi = datesOf('US_CPI');
    const nfp = datesOf('US_NFP');
    expect(cpi).toHaveLength(24);
    expect(nfp).toHaveLength(24);
    expect(cpi[0]).toEqual(['2025-12', '2026-01-13']);
    expect(cpi[23]).toEqual(['2027-11', '2027-12-10']);
    expect(nfp[0]).toEqual(['2025-12', '2026-01-09']);
    expect(nfp[23]).toEqual(['2027-11', '2027-12-03']);
  });

  it('gives each indicator the dates of its own release (CPI / Employment Situation)', () => {
    for (const code of CPI_RELEASE_INDICATORS) expect(datesOf(code)).toEqual(datesOf('US_CPI'));
    for (const code of EMPSIT_RELEASE_INDICATORS) expect(datesOf(code)).toEqual(datesOf('US_NFP'));
    // 24か月 × 5指標(CPI 系・雇用統計系) + PPI 24か月 × 2 + JOLTS 11か月(2027年は BLS がまだ出していない)
    expect(BLS_SCHEDULE).toHaveLength(24 * 5 + 24 * 2 + 11);
  });

  it('has one unique event id per indicator and period', () => {
    const ids = BLS_SCHEDULE.map(blsScheduleEventId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('bls_schedule:US_AVG_HOURLY_EARNINGS:2026-09');
  });

  it('fetches each BLS series once per resolver for the whole schedule (the job batches them into one HTTP request)', async () => {
    const bls = new FakeBls({});
    const range = scheduleObservationRange(BLS_SCHEDULE);
    await buildBlsScheduleReleases({
      official: createBlsNativeResolver(bls, range),
      officialSecondary: createBlsSecondaryResolver(bls, range),
      now: NOW,
    });
    // 一次: CPI・コアCPI(季節調整なし)・NFP・失業率・平均時給・PPI・コアPPI・JOLTS。
    // 副: CPI・コアCPI(季節調整済み)・平均時給・PPI・コアPPI(季節調整なし)。
    expect([...bls.calls].sort()).toEqual(
      [
        'CES0000000001',
        'CES0500000003',
        'CES0500000003',
        'CUSR0000SA0L1E',
        'CUUR0000SA0',
        'CUUR0000SA0',
        'CUUR0000SA0L1E',
        'JTS000000000000000JOL',
        'LNS14000000',
        'WPSFD4',
        'WPSFD49104',
        'WPUFD4',
        'WPUFD49104',
      ].sort(),
    );
  });
});

describe('buildBlsScheduleReleases for the added indicators', () => {
  it('computes core CPI YoY (NSA) with MoM from the SA series', async () => {
    const { releases } = await buildBlsScheduleReleases({
      ...resolvers(new FakeBls(SERIES)),
      entries: [CORE],
      now: NOW,
    });
    const release = releases[0]!;
    expect(release.providerEventId).toBe('bls_schedule:US_CORE_CPI:2026-09');
    expect(release.releaseAt).toBe('2026-10-14T12:30:00.000Z'); // CPI と同じ 08:30 EDT
    expect(release.actual).toEqual({ value: expect.closeTo(3.0, 6) as number, unit: '%' });
    expect(release.previous?.value).toBeCloseTo((306 / 298 - 1) * 100, 6);
    expect(release.secondaryActual).toBeCloseTo((330.99 / 330 - 1) * 100, 6);
    expect(release.secondaryPrevious).toBeCloseTo((330 / 328 - 1) * 100, 6);
  });

  it('takes the unemployment rate level as is (no secondary)', async () => {
    const { releases } = await buildBlsScheduleReleases({
      ...resolvers(new FakeBls(SERIES)),
      entries: [UNEMP],
      now: NOW,
    });
    const release = releases[0]!;
    expect(release.releaseAt).toBe('2026-10-02T12:30:00.000Z'); // 雇用統計と同じ
    expect(release.actual).toEqual({ value: 4.4, unit: '%' });
    expect(release.previous).toEqual({ value: 4.3, unit: '%' });
    expect(release.secondaryActual).toBeNull();
    expect(release.secondaryPrevious).toBeNull();
  });

  it('computes average hourly earnings MoM % with YoY % as the secondary, from the same SA series', async () => {
    const { releases } = await buildBlsScheduleReleases({
      ...resolvers(new FakeBls(SERIES)),
      entries: [AHE],
      now: NOW,
    });
    const release = releases[0]!;
    expect(release.actual?.value).toBeCloseTo((36.41 / 36.3 - 1) * 100, 6);
    expect(release.previous?.value).toBeCloseTo((36.3 / 36.2 - 1) * 100, 6);
    expect(release.secondaryActual).toBeCloseTo((36.41 / 35.0 - 1) * 100, 6);
    expect(release.secondaryPrevious).toBeCloseTo((36.3 / 34.9 - 1) * 100, 6);
  });

  it('skips (never guesses) an indicator BLS has not published yet, without affecting NFP of the same release', async () => {
    const series = { ...SERIES, LNS14000000: { '2026-08': 4.3 } };
    const result = await buildBlsScheduleReleases({
      ...resolvers(new FakeBls(series)),
      entries: [NFP, UNEMP],
      now: NOW,
    });
    expect(result.releases.map((r) => r.providerEventId)).toEqual(['bls_schedule:US_NFP:2026-09']);
    expect(result.notYetAvailable).toEqual([UNEMP]);
    expect(result.releases[0]!.actual).toEqual({ value: 29, unit: 'K' });
  });

  it('builds SCHEDULED releases for the future dates of the added indicators too', async () => {
    const future: BlsScheduleEntry[] = [
      { indicatorCode: 'US_UNEMPLOYMENT_RATE', referencePeriod: '2026-10', releaseDate: '2026-11-06' },
      { indicatorCode: 'US_AVG_HOURLY_EARNINGS', referencePeriod: '2026-10', releaseDate: '2026-11-06' },
    ];
    const { releases } = await buildBlsScheduleReleases({
      ...resolvers(new FakeBls(SERIES)),
      entries: future,
      now: NOW,
    });
    expect(releases.map((r) => [r.providerEventId, r.releaseAt, r.actual])).toEqual([
      ['bls_schedule:US_UNEMPLOYMENT_RATE:2026-10', '2026-11-06T13:30:00.000Z', null],
      ['bls_schedule:US_AVG_HOURLY_EARNINGS:2026-10', '2026-11-06T13:30:00.000Z', null],
    ]);
    expect(releases[0]!.previous).toEqual({ value: 4.4, unit: '%' });
  });
});

describe('the added indicators → ingestCalendarReleases', () => {
  let store: MemoryIngestionStore;

  beforeEach(() => {
    store = new MemoryIngestionStore();
    store.indicators = [
      { id: 'ind-nfp', code: 'US_NFP', importance: 'HIGH', favorable_direction: 'HIGHER_IS_POSITIVE' },
      { id: 'ind-core', code: 'US_CORE_CPI', importance: 'HIGH', favorable_direction: 'HIGHER_IS_POSITIVE' },
      { id: 'ind-unemp', code: 'US_UNEMPLOYMENT_RATE', importance: 'HIGH', favorable_direction: 'LOWER_IS_POSITIVE' },
      {
        id: 'ind-ahe',
        code: 'US_AVG_HOURLY_EARNINGS',
        importance: 'MEDIUM',
        favorable_direction: 'HIGHER_IS_POSITIVE',
      },
    ];
  });

  async function run(entries: BlsScheduleEntry[], series: Record<string, Record<string, number>> = SERIES) {
    const { official, officialSecondary } = resolvers(new FakeBls(series));
    const built = await buildBlsScheduleReleases({ official, officialSecondary, entries, now: NOW });
    const counters = new JobCounters();
    const plan = await planBlsScheduleWrites(store, built.releases, counters);
    await ingestCalendarReleases('bls_schedule', built.releases, { store, official, now: NOW }, counters);
    return { counters, plan };
  }

  it('publishes VERIFIED snapshots with the secondary kind, one row per indicator', async () => {
    const { counters } = await run([CORE, UNEMP, AHE, NFP]);
    expect(counters.errorMessages).toEqual([]);
    const byId = (id: string) => store.events.find((e) => e.provider_event_id === id)!;
    const snapshotOf = (id: string) => store.snapshots.find((s) => s.event_id === byId(id).id)!;

    expect(store.events).toHaveLength(4);
    expect(byId('bls_schedule:US_AVG_HOURLY_EARNINGS:2026-09').importance).toBe('MEDIUM');
    expect(snapshotOf('bls_schedule:US_CORE_CPI:2026-09')).toMatchObject({
      verification_status: 'VERIFIED',
      secondary_value_kind: 'MOM_PCT',
    });
    expect(snapshotOf('bls_schedule:US_UNEMPLOYMENT_RATE:2026-09')).toMatchObject({
      verification_status: 'VERIFIED',
      actual: 4.4,
      secondary_value_kind: null,
    });
    expect(snapshotOf('bls_schedule:US_AVG_HOURLY_EARNINGS:2026-09')).toMatchObject({
      verification_status: 'VERIFIED',
      secondary_value_kind: 'YOY_PCT',
    });
    expect(snapshotOf('bls_schedule:US_NFP:2026-09')).toMatchObject({ verification_status: 'VERIFIED', actual: 29 });
  });

  it('is idempotent: a second run with the same data adds no rows and plans no writes', async () => {
    await run([CORE, UNEMP, AHE]);
    const before = { events: store.events.length, snapshots: store.snapshots.length };
    const { counters, plan } = await run([CORE, UNEMP, AHE]);
    expect(counters.errorMessages).toEqual([]);
    expect(plan).toMatchObject({ released_unchanged: 3, released_insert: 0, released_update: 0, scheduled_insert: 0 });
    expect({ events: store.events.length, snapshots: store.snapshots.length }).toEqual(before);
    expect(store.revisions).toEqual([]);
  });

  it('records a revision when BLS later revises the previous month (unemployment 4.3 → 4.2)', async () => {
    await run([UNEMP]);
    await run([UNEMP], { ...SERIES, LNS14000000: { '2026-08': 4.2, '2026-09': 4.4 } });
    const event = store.events.find((e) => e.provider_event_id === 'bls_schedule:US_UNEMPLOYMENT_RATE:2026-09')!;
    const revisions = store.revisions.filter((r) => r.event_id === event.id);
    expect(revisions).toHaveLength(1);
    expect(revisions[0]).toMatchObject({ field_name: 'PREVIOUS', old_value: 4.3, new_value: 4.2 });
  });

  it('skips an indicator with no economic_indicators row (migration not applied) without stopping the others', async () => {
    store.indicators = store.indicators.filter((i) => i.code !== 'US_AVG_HOURLY_EARNINGS');
    const { counters } = await run([AHE, NFP]);
    expect(counters.details.indicator_not_in_db).toEqual(['US_AVG_HOURLY_EARNINGS']);
    expect(store.events.map((e) => e.provider_event_id)).toEqual(['bls_schedule:US_NFP:2026-09']);
  });
});
