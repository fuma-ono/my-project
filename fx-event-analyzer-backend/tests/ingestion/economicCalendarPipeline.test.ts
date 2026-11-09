import { beforeEach, describe, expect, it } from 'vitest';
import { parseTradingEconomicsCalendar } from '../../src/ingestion/adapters/tradingEconomics.js';
import type { IndicatorMapping } from '../../src/ingestion/mappings/indicators.js';
import { ingestCalendarReleases, reverifyAwaitingOfficial } from '../../src/ingestion/pipelines/economicCalendar.js';
import { JobCounters } from '../../src/ingestion/runner.js';
import type { NormalizedCalendarRelease } from '../../src/ingestion/types.js';
import type { OfficialValueResolver } from '../../src/ingestion/verification/official.js';
import { jsonFixture, MemoryIngestionStore } from '../helpers/memoryIngestionStore.js';

/** Official values keyed by "CODE|period" (what FRED/BLS would give). */
class FakeOfficial implements OfficialValueResolver {
  values = new Map<string, number>();
  calls: { code: string; period: string; asOf: string }[] = [];
  resolve(mapping: IndicatorMapping, period: string, asOfDate: string) {
    this.calls.push({ code: mapping.code, period, asOf: asOfDate });
    const value = this.values.get(`${mapping.code}|${period}`);
    return Promise.resolve(value === undefined ? null : { value, sourceRef: `FRED:TEST@${asOfDate}` });
  }
}

const FETCHED_AT = '2026-10-15T09:00:00.000Z';
const NOW = () => new Date(FETCHED_AT);

async function teReleases(): Promise<NormalizedCalendarRelease[]> {
  return parseTradingEconomicsCalendar(await jsonFixture('tradingeconomics-calendar.json'), FETCHED_AT);
}

function withChanges(
  releases: NormalizedCalendarRelease[],
  id: string,
  change: Partial<NormalizedCalendarRelease>,
): NormalizedCalendarRelease[] {
  return releases.map((r) => (r.providerEventId === id ? { ...r, ...change } : r));
}

describe('economic calendar pipeline', () => {
  let store: MemoryIngestionStore;
  let official: FakeOfficial;

  async function run(releases: NormalizedCalendarRelease[]): Promise<JobCounters> {
    const counters = new JobCounters();
    await ingestCalendarReleases('tradingeconomics', releases, { store, official, now: NOW }, counters);
    return counters;
  }

  beforeEach(() => {
    store = new MemoryIngestionStore();
    store.indicators = [
      { id: 'ind-cpi', code: 'US_CPI', importance: 'HIGH', favorable_direction: 'HIGHER_IS_POSITIVE' },
      { id: 'ind-nfp', code: 'US_NFP', importance: 'HIGH', favorable_direction: 'HIGHER_IS_POSITIVE' },
      { id: 'ind-retail', code: 'US_RETAIL_SALES', importance: 'MEDIUM', favorable_direction: 'HIGHER_IS_POSITIVE' },
    ];
    official = new FakeOfficial();
    official.values.set('US_CPI|2026-09', 3.7376847);
    official.values.set('US_NFP|2026-09', 29);
    official.values.set('US_NFP|2026-08', 133);
  });

  it('publishes verified actuals as immutable RELEASE snapshots', async () => {
    const counters = await run(await teReleases());

    const cpiEvent = store.events.find((e) => e.provider_event_id === '400001')!;
    expect(cpiEvent).toMatchObject({
      status: 'RELEASED',
      data_status: 'AVAILABLE',
      release_datetime_precision: 'EXACT',
    });
    expect(store.snapshots.find((s) => s.event_id === cpiEvent.id)).toMatchObject({
      actual: 3.7,
      forecast: 3.6,
      previous: 3.4,
      unit: '%',
      source: 'U.S. Bureau of Labor Statistics',
      surprise: 0.1,
      surprise_direction: 'POSITIVE',
      verification_status: 'VERIFIED',
      verification_source: 'FRED:TEST@2026-10-14',
      official_actual: 3.7377,
    });
    // Official value is looked up as of the release date (US Eastern).
    expect(official.calls).toContainEqual({ code: 'US_CPI', period: '2026-09', asOf: '2026-10-14' });

    const nfpEvent = store.events.find((e) => e.provider_event_id === '400003')!;
    expect(store.snapshots.find((s) => s.event_id === nfpEvent.id)).toMatchObject({
      actual: 29,
      forecast: 50,
      previous: 120,
      unit: 'K',
      surprise: -21,
      surprise_direction: 'NEGATIVE',
    });
    // The revised previous (120K → 133K) matches the official August change → event_revisions.
    expect(store.revisions).toEqual([
      expect.objectContaining({ event_id: nfpEvent.id, field_name: 'PREVIOUS', old_value: 120, new_value: 133 }),
    ]);

    // Schedule-only row (retail sales, no actual yet).
    expect(store.events.find((e) => e.provider_event_id === '400005')).toMatchObject({
      status: 'SCHEDULED',
      data_status: 'PENDING',
      release_datetime: '2026-10-16T12:30:00.000Z',
    });
    expect(counters.skipReasons).toEqual({ UNMAPPED_INDICATOR: 1, INDICATOR_NOT_IN_DB: 2 });
    expect(counters.details.indicator_not_in_db).toEqual(['US_CORE_CPI', 'US_UNEMPLOYMENT_RATE']);
    expect(counters.errors).toBe(0);
  });

  it('is idempotent: re-running the same fetch changes nothing', async () => {
    await run(await teReleases());
    const snapshot = JSON.stringify({ e: store.events, s: store.snapshots, r: store.revisions, st: store.staged });
    const second = await run(await teReleases());
    expect(JSON.stringify({ e: store.events, s: store.snapshots, r: store.revisions, st: store.staged })).toBe(
      snapshot,
    );
    expect(second.errors).toBe(0);
  });

  it('holds an actual that does not match the official value as PENDING_REVIEW (not published)', async () => {
    const releases = withChanges(await teReleases(), '400001', { actual: { value: 3.8, unit: '%' } });
    const counters = await run(releases);
    const event = store.events.find((e) => e.provider_event_id === '400001')!;
    expect(event).toMatchObject({ status: 'RELEASED', data_status: 'PENDING' });
    expect(store.snapshots.some((s) => s.event_id === event.id)).toBe(false);
    expect(store.staged).toEqual([
      expect.objectContaining({
        event_id: event.id,
        kind: 'RELEASE',
        actual: 3.8,
        official_actual: 3.7377,
        verification_status: 'PENDING_REVIEW',
        reasons: ['OFFICIAL_MISMATCH'],
      }),
    ]);
    expect(counters.review).toBe(1);

    // Same wrong value again: still exactly one staged row.
    await run(releases);
    expect(store.staged).toHaveLength(1);

    // The provider corrects itself: published, staged row resolved.
    await run(await teReleases());
    expect(store.snapshots.find((s) => s.event_id === event.id)?.actual).toBe(3.7);
    expect(store.staged[0]).toMatchObject({ verification_status: 'VERIFIED' });
    expect(store.staged[0]!.resolved_at).toBeTruthy();
  });

  it('waits for the official number (AWAITING_OFFICIAL) and publishes on re-verification', async () => {
    official.values.delete('US_CPI|2026-09');
    await run(await teReleases());
    const event = store.events.find((e) => e.provider_event_id === '400001')!;
    expect(store.snapshots.some((s) => s.event_id === event.id)).toBe(false);
    expect(store.staged.find((s) => s.event_id === event.id)).toMatchObject({
      verification_status: 'AWAITING_OFFICIAL',
      reference_period: '2026-09',
    });

    // Still nothing official → stays waiting.
    const still = new JobCounters();
    await reverifyAwaitingOfficial({ store, official, now: NOW }, still);
    expect(still.skipReasons).toEqual({ OFFICIAL_STILL_UNAVAILABLE: 1 });

    official.values.set('US_CPI|2026-09', 3.7376847);
    const counters = new JobCounters();
    await reverifyAwaitingOfficial({ store, official, now: NOW }, counters);
    expect(counters.success).toBe(1);
    expect(store.snapshots.find((s) => s.event_id === event.id)).toMatchObject({
      actual: 3.7,
      verification_status: 'VERIFIED',
    });
    expect(store.events.find((e) => e.id === event.id)).toMatchObject({ data_status: 'AVAILABLE' });
    expect(store.staged.find((s) => s.event_id === event.id)).toMatchObject({ verification_status: 'VERIFIED' });
  });

  it('re-verification that finds a mismatch moves the value to PENDING_REVIEW', async () => {
    official.values.delete('US_CPI|2026-09');
    await run(await teReleases());
    official.values.set('US_CPI|2026-09', 3.9);
    const counters = new JobCounters();
    await reverifyAwaitingOfficial({ store, official, now: NOW }, counters);
    expect(counters.review).toBe(1);
    expect(store.staged.find((s) => s.indicator_code === 'US_CPI')).toMatchObject({
      verification_status: 'PENDING_REVIEW',
      reasons: ['OFFICIAL_MISMATCH'],
      official_actual: 3.9,
    });
    expect(store.snapshots.some((s) => s.actual === 3.7 && s.forecast === 3.6)).toBe(false);
  });

  it('validation failures block publication even when the official value matches', async () => {
    official.values.set('US_CPI|2026-09', 9.0);
    const releases = withChanges(await teReleases(), '400001', { actual: { value: 9.0, unit: '%' } });
    await run(
      withChanges(releases, '400003', {
        actual: { value: 29, unit: '%' }, // wrong unit for a thousands series
      }),
    );
    const byId = (id: string) => store.staged.find((s) => s.provider_event_id === id);
    expect(byId('400001')?.reasons).toEqual(['OUTLIER_VS_PREVIOUS']);
    expect(byId('400003')?.reasons).toEqual(['UNIT_MISMATCH', 'UNPARSEABLE_ACTUAL']);
    expect(store.snapshots).toHaveLength(0);
  });

  it('flags a future-dated actual', async () => {
    const releases = withChanges(await teReleases(), '400001', { fetchedAt: '2026-10-14T12:00:00.000Z' });
    await run(releases);
    expect(store.staged.find((s) => s.provider_event_id === '400001')?.reasons).toContain('FUTURE_DATED_ACTUAL');
  });

  it('applies a schedule change only when it is at the agency release time', async () => {
    await run(await teReleases());
    const retail = () => store.events.find((e) => e.provider_event_id === '400005')!;

    // 09:30 ET is not when Census releases → ignored and logged.
    const odd = await run(withChanges(await teReleases(), '400005', { releaseAt: '2026-10-16T13:30:00.000Z' }));
    expect(retail().release_datetime).toBe('2026-10-16T12:30:00.000Z');
    expect(odd.details.schedule_change_ignored).toHaveLength(1);

    // Moved to another day at 08:30 ET → applied.
    await run(withChanges(await teReleases(), '400005', { releaseAt: '2026-10-19T12:30:00.000Z' }));
    expect(retail().release_datetime).toBe('2026-10-19T12:30:00.000Z');
  });

  it('stores a new event at an unexpected time as APPROXIMATE and does not publish its actual', async () => {
    const releases = withChanges(await teReleases(), '400001', { releaseAt: '2026-10-14T14:00:00.000Z' });
    await run(releases);
    const event = store.events.find((e) => e.provider_event_id === '400001')!;
    expect(event.release_datetime_precision).toBe('APPROXIMATE');
    expect(store.staged.find((s) => s.event_id === event.id)?.reasons).toContain('RELEASE_TIME_UNEXPECTED');
  });

  it('records a later different actual as a verified ACTUAL revision without touching the snapshot', async () => {
    await run(await teReleases());
    const event = store.events.find((e) => e.provider_event_id === '400001')!;
    official.values.set('US_CPI|2026-09', 3.8);
    await run(withChanges(await teReleases(), '400001', { actual: { value: 3.8, unit: '%' } }));
    expect(store.snapshots.find((s) => s.event_id === event.id)?.actual).toBe(3.7);
    expect(store.revisions.filter((r) => r.event_id === event.id)).toEqual([
      expect.objectContaining({ field_name: 'ACTUAL', old_value: 3.7, new_value: 3.8 }),
    ]);
    // Seen again: not recorded twice.
    await run(withChanges(await teReleases(), '400001', { actual: { value: 3.8, unit: '%' } }));
    expect(store.revisions.filter((r) => r.event_id === event.id)).toHaveLength(1);
    // A further revision chains from the last recorded value.
    official.values.set('US_CPI|2026-09', 3.9);
    await run(withChanges(await teReleases(), '400001', { actual: { value: 3.9, unit: '%' } }));
    expect(store.revisions.filter((r) => r.event_id === event.id).at(-1)).toMatchObject({
      old_value: 3.8,
      new_value: 3.9,
    });
  });

  it('holds two provider rows for the same indicator and period (DUPLICATE_IN_BATCH)', async () => {
    const releases = await teReleases();
    const cpi = releases.find((r) => r.providerEventId === '400001')!;
    await run([...releases, { ...cpi, providerEventId: '499999' }]);
    expect(
      store.staged
        .filter((s) => s.reasons.includes('DUPLICATE_IN_BATCH'))
        .map((s) => s.provider_event_id)
        .sort(),
    ).toEqual(['400001', '499999']);
  });

  it('infers the reference period for providers without one, and never publishes it unverified', async () => {
    const releases = (await teReleases()).map((r) => ({ ...r, referencePeriod: null }));
    official.values.clear();
    await run(releases);
    const cpi = store.staged.find((s) => s.provider_event_id === '400001')!;
    expect(cpi).toMatchObject({ reference_period: '2026-09', verification_status: 'AWAITING_OFFICIAL' });
    expect(store.snapshots).toHaveLength(0);
  });
});
