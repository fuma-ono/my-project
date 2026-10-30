/**
 * ユーロ圏の経済指標 第1弾(HQ承認・HQ判断 2026-10-30「Eurostat経済指標 第1弾」): EU_HICP(速報値)・
 * EU_UNEMPLOYMENT_RATE。Eurostat の取得・公表日程・前回値・時刻の扱い(APPROXIMATE)・当時の値の扱い・
 * 重複の無いこと・BLS の経路への影響が無いこと・出典(attribution)を確かめる。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { attributionForIndicator, EUROSTAT_ATTRIBUTION } from '../../src/domain/attribution.js';
import { buildCalendarItems } from '../../src/domain/calendar.js';
import { availableTimeframes } from '../../src/domain/dataQuality.js';
import { eurostatUrl, parseEurostatResponse, parseEurostatSeriesId } from '../../src/ingestion/adapters/eurostat.js';
import { BLS_SCHEDULE } from '../../src/ingestion/mappings/blsSchedule.js';
import {
  EUROSTAT_INDICATOR_SCHEDULES,
  EUROSTAT_SCHEDULE,
  FIRST_RELEASE_WINDOW_HOURS,
  type EurostatScheduleEntry,
} from '../../src/ingestion/mappings/eurostatSchedule.js';
import {
  buildMappingIndex,
  EUROSTAT_SERIES,
  findMappingByCode,
  INDICATOR_MAPPINGS,
} from '../../src/ingestion/mappings/indicators.js';
import { blsScheduleEventId } from '../../src/ingestion/pipelines/blsCalendar.js';
import { ingestCalendarReleases } from '../../src/ingestion/pipelines/economicCalendar.js';
import {
  buildEurostatScheduleReleases,
  createEurostatNativeResolver,
  createEurostatSeriesCache,
  eurostatObservationRange,
  eurostatScheduleEventId,
  eurostatScheduleSeriesIds,
  EUROSTAT_SCHEDULE_PROVIDER,
} from '../../src/ingestion/pipelines/eurostatCalendar.js';
import { officialSeriesToFetch } from '../../src/ingestion/pipelines/officialStats.js';
import type { OfficialStatsProvider } from '../../src/ingestion/providers.js';
import { classifySnapshotMatch } from '../../src/ingestion/quality/metrics.js';
import { JobCounters } from '../../src/ingestion/runner.js';
import { previousReferencePeriod } from '../../src/ingestion/time.js';
import type { NormalizedCalendarRelease, OfficialObservation } from '../../src/ingestion/types.js';
import { validateRelease } from '../../src/ingestion/validation/economicRelease.js';
import { MemoryIngestionStore } from '../helpers/memoryIngestionStore.js';

/** A JSON-stat 2.0 body shaped like the real API (2026-10-30: une_rt_m, EA21; values from the real response). */
function jsonStat(values: Record<string, number | null>, status: Record<string, string> = {}, extraDim?: number) {
  const months = Object.keys(values);
  const index = Object.fromEntries(months.map((m, i) => [m, i]));
  const value: Record<string, number> = {};
  const statusOut: Record<string, string> = {};
  months.forEach((m, i) => {
    const v = values[m];
    if (v !== null && v !== undefined) value[String(i)] = v;
    if (status[m]) statusOut[String(i)] = status[m]!;
  });
  return {
    version: '2.0',
    class: 'dataset',
    updated: '2026-10-21T11:00:00+0200',
    id: ['freq', 'unit', 'geo', 'time'],
    size: [1, extraDim ?? 1, 1, months.length],
    value,
    status: statusOut,
    dimension: {
      freq: { category: { index: { M: 0 } } },
      unit: { category: { index: extraDim ? { PC_ACT: 0, THS_PER: 1 } : { PC_ACT: 0 } } },
      geo: { category: { index: { EA21: 0 } } },
      time: { category: { index } },
    },
  };
}

/** An in-memory Eurostat: series id → month → value. */
class FakeEurostat implements OfficialStatsProvider {
  readonly name = 'EUROSTAT' as const;
  readonly supportsPointInTime = false;
  calls: string[] = [];
  constructor(private readonly bySeries: Record<string, Record<string, number>>) {}
  fetchObservations(query: { seriesId: string; observationStart: string; observationEnd: string }) {
    this.calls.push(query.seriesId);
    const observations: OfficialObservation[] = Object.entries(this.bySeries[query.seriesId] ?? {})
      .filter(([m]) => m >= query.observationStart.slice(0, 7) && m <= query.observationEnd.slice(0, 7))
      .map(([m, value]) => ({
        source: 'EUROSTAT',
        seriesId: query.seriesId,
        periodStart: `${m}-01`,
        value,
        asOfDate: '2026-10-30',
        releaseStatus: 'UNKNOWN',
      }));
    return Promise.resolve(observations);
  }
}

/** Values from the real Eurostat responses read on 2026-10-30 (prc_hicp_fpd / une_rt_m, EA21). */
const REAL = {
  [EUROSTAT_SERIES.HICP_FLASH_YOY]: { '2026-07': 2.9, '2026-08': 3.2, '2026-09': 3.8 },
  [EUROSTAT_SERIES.HICP_FINAL_YOY]: { '2026-06': 2.8, '2026-07': 3.0, '2026-08': 3.2, '2026-09': 3.8 },
  [EUROSTAT_SERIES.UNEMPLOYMENT_RATE]: { '2026-07': 6.4, '2026-08': 6.4 },
};

const hicp = (referencePeriod: string, releaseDate: string): EurostatScheduleEntry => ({
  indicatorCode: 'EU_HICP',
  referencePeriod,
  releaseDate,
});
const unemployment = (referencePeriod: string, releaseDate: string): EurostatScheduleEntry => ({
  indicatorCode: 'EU_UNEMPLOYMENT_RATE',
  referencePeriod,
  releaseDate,
});

function cacheOf(data: Record<string, Record<string, number>>) {
  const provider = new FakeEurostat(data);
  return { provider, series: createEurostatSeriesCache(provider, { start: '2025-01-01', end: '2027-12-01' }) };
}

describe('Eurostat adapter (JSON-stat 2.0)', () => {
  it('reads monthly values; status e/p → PRELIMINARY; a period with no value is absent (never filled)', () => {
    const body = jsonStat({ '2026-07': 6.4, '2026-08': 6.4, '2026-09': null }, { '2026-08': 'e' });
    const seriesId = EUROSTAT_SERIES.UNEMPLOYMENT_RATE;
    expect(parseEurostatResponse(body, seriesId, '2026-10-30')).toEqual([
      {
        source: 'EUROSTAT',
        seriesId,
        periodStart: '2026-07-01',
        value: 6.4,
        asOfDate: '2026-10-30',
        releaseStatus: 'UNKNOWN',
      },
      {
        source: 'EUROSTAT',
        seriesId,
        periodStart: '2026-08-01',
        value: 6.4,
        asOfDate: '2026-10-30',
        releaseStatus: 'PRELIMINARY',
      },
    ]);
  });

  it('refuses a response where a non-time dimension has more than one value (never picks one by guess)', () => {
    expect(() => parseEurostatResponse(jsonStat({ '2026-08': 6.4 }, {}, 2), 'x?unit=PC_ACT', '2026-10-30')).toThrow(
      /dimension "unit" has 2 values/,
    );
  });

  it('builds the dissemination URL from the series id (dataset + dimension filters + period range, no key)', () => {
    const url = eurostatUrl(EUROSTAT_SERIES.HICP_FLASH_YOY, { start: '2025-12-01', end: '2027-06-01' });
    expect(url).toBe(
      'https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/prc_hicp_fpd?coicop18=TOTAL&geo=EA21&release=FLS&unit=RCH_A&sinceTimePeriod=2025-12&untilTimePeriod=2027-06&format=JSON&lang=EN',
    );
    expect(() => parseEurostatSeriesId('une_rt_m')).toThrow(/no dimension filters/);
  });

  it('uses the EA21 euro area in every series (the 2026 composition; EA20 returns no recent data)', () => {
    for (const id of Object.values(EUROSTAT_SERIES))
      expect(parseEurostatSeriesId(id).filters).toContainEqual(['geo', 'EA21']);
  });
});

describe('previousReferencePeriod (前回値は対象期間で決める)', () => {
  it('monthly → the month before, across a year end; quarterly → the quarter before', () => {
    expect(previousReferencePeriod('2026-09')).toBe('2026-08');
    expect(previousReferencePeriod('2026-01')).toBe('2025-12');
    expect(previousReferencePeriod('2026-Q1')).toBe('2025-Q4');
    expect(previousReferencePeriod('2026-Q3')).toBe('2026-Q2');
  });

  it('throws for a period it cannot read (no guessed previous)', () => {
    expect(() => previousReferencePeriod('2026')).toThrow();
    expect(() => previousReferencePeriod('2026-10-01')).toThrow();
  });
});

describe('Eurostat release schedule (mappings/eurostatSchedule.ts)', () => {
  it('has one entry per indicator and period, and unique event ids that never collide with the BLS path', () => {
    const keys = EUROSTAT_SCHEDULE.map((e) => `${e.indicatorCode}|${e.referencePeriod}`);
    expect(new Set(keys).size).toBe(keys.length);
    const ids = EUROSTAT_SCHEDULE.map(eurostatScheduleEventId);
    expect(new Set(ids).size).toBe(ids.length);
    const blsIds = new Set(BLS_SCHEDULE.map(blsScheduleEventId));
    expect(ids.some((id) => blsIds.has(id))).toBe(false);
    expect(ids.every((id) => id.startsWith('eurostat_schedule:EU_'))).toBe(true);
  });

  it('every release is after its reference month began, and dates rise with the period', () => {
    for (const code of ['EU_HICP', 'EU_UNEMPLOYMENT_RATE'] as const) {
      const rows = EUROSTAT_SCHEDULE.filter((e) => e.indicatorCode === code);
      rows.forEach((row, i) => {
        expect(row.releaseDate >= `${row.referencePeriod}-01`).toBe(true);
        if (i > 0) {
          expect(rows[i - 1]!.referencePeriod).toBe(previousReferencePeriod(row.referencePeriod)); // no gap
          expect(row.releaseDate > rows[i - 1]!.releaseDate).toBe(true);
        }
      });
    }
  });

  it('unemployment starts at the latest release (2026-10-30, September) — no earlier month (HQ判断 2026-10-30 1)', () => {
    const rows = EUROSTAT_SCHEDULE.filter((e) => e.indicatorCode === 'EU_UNEMPLOYMENT_RATE');
    expect(rows[0]).toEqual({
      indicatorCode: 'EU_UNEMPLOYMENT_RATE',
      referencePeriod: '2026-09',
      releaseDate: '2026-10-30',
    });
    expect(EUROSTAT_INDICATOR_SCHEDULES.EU_UNEMPLOYMENT_RATE.valueVintage).toBe('LATEST_ONLY');
    expect(EUROSTAT_INDICATOR_SCHEDULES.EU_HICP.valueVintage).toBe('AS_PUBLISHED');
  });

  it('every scheduled indicator has a mapping with an eurostat_schedule key, an EUROSTAT series and APPROXIMATE 11:00 Luxembourg', () => {
    for (const code of Object.keys(EUROSTAT_INDICATOR_SCHEDULES)) {
      const mapping = findMappingByCode(code)!;
      expect(mapping.providers.eurostat_schedule).toBeDefined();
      expect(mapping.official[0]?.source).toBe('EUROSTAT');
      expect(mapping.release).toEqual({
        timeZone: 'Europe/Luxembourg',
        localTimes: ['11:00'],
        precision: 'APPROXIMATE',
      });
      expect(mapping.agency.name).toBe('Eurostat');
    }
    expect(() => buildMappingIndex('eurostat_schedule')).not.toThrow();
    expect(eurostatScheduleSeriesIds()).toEqual(
      [EUROSTAT_SERIES.HICP_FINAL_YOY, EUROSTAT_SERIES.HICP_FLASH_YOY, EUROSTAT_SERIES.UNEMPLOYMENT_RATE].sort(),
    );
  });
});

describe('buildEurostatScheduleReleases', () => {
  it('past HICP flash: actual = the flash as published, previous = the previous month’s FINAL; no forecast; APPROXIMATE', async () => {
    const { series } = cacheOf(REAL);
    const built = await buildEurostatScheduleReleases({
      series,
      entries: [hicp('2026-07', '2026-07-31')],
      now: () => new Date('2026-10-30T03:00:00Z'),
    });
    expect(built.releases).toHaveLength(1);
    expect(built.releases[0]).toMatchObject({
      provider: 'eurostat_schedule',
      providerEventId: 'eurostat_schedule:EU_HICP:2026-07',
      providerIndicatorKey: 'eu|eu_hicp',
      // 11:00 CEST (summer) = 09:00Z
      releaseAt: '2026-07-31T09:00:00.000Z',
      releaseAtPrecision: 'APPROXIMATE',
      referencePeriod: '2026-07',
      actual: { value: 2.9, unit: '%' }, // flash 2.9 — not the final 3.0
      forecast: null,
      previous: { value: 2.8, unit: '%' }, // June final
    });
  });

  it('future entry: SCHEDULED row (actual null) at 11:00 CET = 10:00Z in winter; never a forecast', async () => {
    const { series } = cacheOf(REAL);
    const built = await buildEurostatScheduleReleases({
      series,
      entries: [unemployment('2026-09', '2026-10-30'), hicp('2026-10', '2026-11-04')],
      now: () => new Date('2026-10-30T03:00:00Z'),
    });
    expect(built.releases.map((r) => [r.providerEventId, r.releaseAt, r.actual, r.forecast])).toEqual([
      ['eurostat_schedule:EU_UNEMPLOYMENT_RATE:2026-09', '2026-10-30T10:00:00.000Z', null, null],
      ['eurostat_schedule:EU_HICP:2026-10', '2026-11-04T10:00:00.000Z', null, null],
    ]);
  });

  it('unemployment (LATEST_ONLY) is built only within the first-release window; later it is never built from a possibly revised value', async () => {
    const data = { ...REAL, [EUROSTAT_SERIES.UNEMPLOYMENT_RATE]: { '2026-08': 6.4, '2026-09': 6.3 } };
    const { series } = cacheOf(data);
    const entry = unemployment('2026-09', '2026-10-30');
    const releaseAt = Date.parse('2026-10-30T10:00:00Z');

    const inside = await buildEurostatScheduleReleases({
      series,
      entries: [entry],
      now: () => new Date(releaseAt + 3_600_000),
    });
    expect(inside.releases[0]).toMatchObject({
      actual: { value: 6.3, unit: '%' },
      previous: { value: 6.4, unit: '%' },
    });

    const later = new Date(releaseAt + (FIRST_RELEASE_WINDOW_HOURS + 1) * 3_600_000);
    const outside = await buildEurostatScheduleReleases({ series, entries: [entry], now: () => later });
    expect(outside.releases).toEqual([]);
    expect(outside.outsideFirstReleaseWindow).toEqual([entry]);
  });

  it('a past entry whose value Eurostat does not show yet is notYetAvailable (nothing built, never guessed)', async () => {
    const { series } = cacheOf(REAL);
    const built = await buildEurostatScheduleReleases({
      series,
      entries: [unemployment('2026-09', '2026-10-30')],
      now: () => new Date('2026-10-30T10:30:00Z'), // just after 11:00 CET, before the data are posted
    });
    expect(built.releases).toEqual([]);
    expect(built.notYetAvailable).toHaveLength(1);
  });

  it('fetches each series once for the whole schedule', async () => {
    const { provider, series } = cacheOf(REAL);
    await buildEurostatScheduleReleases({ series, now: () => new Date('2026-10-30T03:00:00Z') });
    expect([...provider.calls].sort()).toEqual(eurostatScheduleSeriesIds());
    expect(eurostatObservationRange()).toEqual({ start: '2025-12-01', end: '2027-06-01' });
  });
});

describe('ingestCalendarReleases with the Eurostat path (MemoryIngestionStore)', () => {
  let store: MemoryIngestionStore;
  beforeEach(() => {
    store = new MemoryIngestionStore();
    store.indicators = [
      { id: 'ind-hicp', code: 'EU_HICP', importance: 'HIGH', favorable_direction: 'HIGHER_IS_POSITIVE' },
      { id: 'ind-une', code: 'EU_UNEMPLOYMENT_RATE', importance: 'MEDIUM', favorable_direction: 'LOWER_IS_POSITIVE' },
    ];
  });

  async function run(now: string, entries: EurostatScheduleEntry[]) {
    const { series } = cacheOf(REAL);
    const built = await buildEurostatScheduleReleases({ series, entries, now: () => new Date(now) });
    const counters = new JobCounters();
    await ingestCalendarReleases(
      EUROSTAT_SCHEDULE_PROVIDER,
      built.releases,
      { store, official: createEurostatNativeResolver(series), now: () => new Date(now) },
      counters,
    );
    return counters;
  }

  it('publishes the past HICP flash as RELEASED + VERIFIED (self-match), stored APPROXIMATE (no 1-minute reaction)', async () => {
    const counters = await run('2026-10-30T03:00:00Z', [hicp('2026-09', '2026-10-02')]);
    expect(counters.errors).toBe(0);
    expect(store.staged).toEqual([]);
    expect(store.events).toHaveLength(1);
    expect(store.events[0]).toMatchObject({
      provider: 'eurostat_schedule',
      provider_event_id: 'eurostat_schedule:EU_HICP:2026-09',
      release_datetime: '2026-10-02T09:00:00.000Z',
      release_datetime_precision: 'APPROXIMATE',
      status: 'RELEASED',
      data_status: 'AVAILABLE',
    });
    expect(store.snapshots[0]).toMatchObject({
      actual: 3.8,
      previous: 3.2,
      forecast: null,
      unit: '%',
      source: 'Eurostat',
      source_url: 'https://ec.europa.eu/eurostat',
      verification_status: 'VERIFIED',
    });
    expect(store.snapshots[0]!.verification_source).toMatch(/^EUROSTAT:prc_hicp_fpd\?/);
    expect(availableTimeframes('APPROXIMATE')).not.toContain('1m');
    expect(
      classifySnapshotMatch({
        verification_status: 'VERIFIED',
        provider: 'eurostat_schedule',
        verification_source: store.snapshots[0]!.verification_source,
      }),
    ).toBe('SELF_MATCH');
  });

  it('running twice registers nothing twice (same event, one snapshot, no revision)', async () => {
    const entries = [
      hicp('2026-08', '2026-09-01'),
      hicp('2026-09', '2026-10-02'),
      unemployment('2026-09', '2026-10-30'),
    ];
    await run('2026-10-30T03:00:00Z', entries);
    await run('2026-10-30T04:00:00Z', entries);
    expect(store.events).toHaveLength(3);
    expect(store.snapshots).toHaveLength(2);
    expect(store.revisions).toEqual([]);
    expect(store.events.find((e) => e.provider_event_id.endsWith('EU_UNEMPLOYMENT_RATE:2026-09'))).toMatchObject({
      status: 'SCHEDULED',
      release_datetime_precision: 'APPROXIMATE',
    });
  });
});

describe('no effect on the existing paths', () => {
  it('an APPROXIMATE release of an indicator whose mapping is exact (US_CPI) is still held as MISSING_EXACT_TIME', () => {
    const release: NormalizedCalendarRelease = {
      provider: 'bls_schedule',
      providerEventId: 'x',
      providerIndicatorKey: 'us|us_cpi',
      eventName: 'US CPI',
      releaseAt: '2026-10-14T12:30:00.000Z',
      releaseAtPrecision: 'APPROXIMATE',
      referencePeriod: '2026-09',
      actual: { value: 3, unit: '%' },
      forecast: null,
      previous: null,
      revisedPrevious: null,
      fetchedAt: '2026-10-14T13:00:00.000Z',
    };
    expect(validateRelease(release, findMappingByCode('US_CPI')!, { futureActualToleranceMs: 0 }).issues).toContain(
      'MISSING_EXACT_TIME',
    );
    const eu = { ...release, providerIndicatorKey: 'eu|eu_hicp', releaseAt: '2026-10-02T09:00:00.000Z' };
    expect(validateRelease(eu, findMappingByCode('EU_HICP')!, { futureActualToleranceMs: 0 }).issues).toEqual([]);
  });

  it('the BLS mappings and schedule are unchanged in shape (no Eurostat key, release time exact)', () => {
    for (const mapping of INDICATOR_MAPPINGS.filter((m) => m.providers.bls_schedule)) {
      expect(mapping.providers.eurostat_schedule).toBeUndefined();
      expect(mapping.release.precision).toBeUndefined();
      expect(mapping.official.every((ref) => ref.source === 'BLS')).toBe(true);
    }
  });

  it('ingest:official never fetches (so never stores) a Eurostat series — official_observations allows FRED/BLS only', () => {
    const fake = new FakeEurostat({});
    const refs = officialSeriesToFetch({ BLS: { ...fake, name: 'BLS' } as unknown as OfficialStatsProvider });
    expect(refs.some((ref) => ref.source === 'EUROSTAT')).toBe(false);
    expect(refs.length).toBeGreaterThan(0);
  });
});

describe('出典(attribution, api-design v1.43)', () => {
  it('Eurostat indicators carry the Eurostat source and the disclaimer; other indicators none', () => {
    expect(attributionForIndicator('EU_HICP')).toEqual(EUROSTAT_ATTRIBUTION);
    expect(attributionForIndicator('EU_UNEMPLOYMENT_RATE')).toEqual(EUROSTAT_ATTRIBUTION);
    expect(EUROSTAT_ATTRIBUTION).toEqual({
      source: 'Eurostat（欧州連合統計局）',
      source_url: 'https://ec.europa.eu/eurostat',
      notice: 'Eurostat の公表データをもとに作成しています。Eurostat は本アプリでの利用について責任を負いません。',
    });
    expect(attributionForIndicator('US_CPI')).toBeNull();
    expect(attributionForIndicator(undefined)).toBeNull();
  });

  it('GET /calendar: an EU indicator item has the Eurostat attribution, a US one null', () => {
    const base = {
      indicator_id: 'i',
      indicator_name: 'n',
      importance: 'HIGH',
      release_datetime: '2026-11-04T10:00:00Z',
      release_datetime_precision: 'APPROXIMATE',
      status: 'SCHEDULED',
    };
    const items = buildCalendarItems(
      [
        { ...base, id: 'eu', indicator_code: 'EU_HICP', country_code: 'EU', currency_code: 'EUR' },
        { ...base, id: 'us', indicator_code: 'US_CPI', country_code: 'US', currency_code: 'USD' },
      ],
      [],
    );
    expect(items.find((i) => i.id === 'eu')?.attribution).toEqual(EUROSTAT_ATTRIBUTION);
    expect(items.find((i) => i.id === 'us')?.attribution).toBeNull();
  });
});
