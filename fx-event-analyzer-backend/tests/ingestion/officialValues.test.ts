/**
 * HQ決定(2026-11-10「公式経済指標の実績値取得・保存処理」): 公式機関の初回公表値を、公表日・対象期間・数値・単位・出典が
 * そろったときだけ RELEASED として保存する。そろわなければ DATA_PENDING(SCHEDULED・PENDING)のまま。初回値は上書きせず、
 * 改定は event_revisions に別の履歴として足す。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { OfficialScheduleTable } from '../../src/ingestion/mappings/gbAuCaSchedule.js';
import { ingestOfficialValues, OFFICIAL_VALUE_SOURCES } from '../../src/ingestion/pipelines/officialValues.js';
import { JobCounters } from '../../src/ingestion/runner.js';
import { MemoryIngestionStore } from '../helpers/memoryIngestionStore.js';

const ONS_CPI_URL = 'https://www.ons.gov.uk/economy/inflationandpriceindices/timeseries/d7g7/mm23/data';
const TABLE: OfficialScheduleTable = {
  provider: 'ons_release_calendar',
  entries: [
    {
      indicatorCode: 'GB_CPI',
      key: '2026-10',
      referencePeriod: '2026-10',
      releaseDate: '2026-11-18',
      time: '07:00',
      timeZone: 'Europe/London',
      sources: ['x'],
      checkedAt: '2026-11-10',
    },
    // 労働市場: 対象期間が公式に確認できていない回(referencePeriod なし)
    {
      indicatorCode: 'GB_UNEMPLOYMENT_RATE',
      key: '2026-11',
      releaseDate: '2026-11-17',
      time: '07:00',
      timeZone: 'Europe/London',
      sources: ['x'],
      checkedAt: '2026-11-10',
    },
  ],
};
const AFTER = new Date('2026-11-18T09:00:00Z'); // 公表の2時間後
const CPI_ID = 'ev-cpi';

/** ONS の D7G7 の JSON。releasedOn(英国の日付)の 00:00 に公表された、とする(ONS の releaseDate は前日 23:00Z = 00:00 GMT/BST)。 */
function onsCpi(months: [label: string, value: string, updatedOn: string][], releasedOn: string) {
  const midnightLondon = (date: string) => new Date(`${date}T00:00:00Z`).toISOString(); // 11月は GMT
  return {
    description: { cdid: 'D7G7', unit: '%', releaseDate: midnightLondon(releasedOn) },
    months: months.map(([date, value, updatedOn]) => ({ date, value, updateDate: midnightLondon(updatedOn) })),
  };
}

class FakeFetcher {
  responses = new Map<string, unknown>();
  failing = new Set<string>();
  calls: string[] = [];
  getJson(url: string): Promise<unknown> {
    this.calls.push(url);
    if (this.failing.has(url)) return Promise.reject(new Error('HTTP 503'));
    return Promise.resolve(this.responses.get(url) ?? {});
  }
}

describe('ingestOfficialValues', () => {
  let store: MemoryIngestionStore;
  let fetcher: FakeFetcher;
  const sources = OFFICIAL_VALUE_SOURCES.filter(
    (s) => s.indicatorCode === 'GB_CPI' || s.indicatorCode === 'GB_UNEMPLOYMENT_RATE',
  );

  beforeEach(() => {
    store = new MemoryIngestionStore();
    fetcher = new FakeFetcher();
    store.indicators = [
      { id: 'ind-gb-cpi', code: 'GB_CPI', importance: 'HIGH', favorable_direction: 'HIGHER_IS_POSITIVE' },
      { id: 'ind-gb-u', code: 'GB_UNEMPLOYMENT_RATE', importance: 'MEDIUM', favorable_direction: 'LOWER_IS_POSITIVE' },
    ];
    store.events = [
      {
        id: CPI_ID,
        indicator_id: 'ind-gb-cpi',
        provider: 'ons_release_calendar',
        provider_event_id: 'ons_release_calendar:GB_CPI:2026-10',
        importance: 'HIGH',
        release_datetime: '2026-11-18T07:00:00.000Z',
        release_datetime_precision: 'EXACT',
        status: 'SCHEDULED',
        data_status: 'PENDING',
      },
      {
        id: 'ev-u',
        indicator_id: 'ind-gb-u',
        provider: 'ons_release_calendar',
        provider_event_id: 'ons_release_calendar:GB_UNEMPLOYMENT_RATE:2026-11',
        importance: 'MEDIUM',
        release_datetime: '2026-11-17T07:00:00.000Z',
        release_datetime_precision: 'EXACT',
        status: 'SCHEDULED',
        data_status: 'PENDING',
      },
    ];
  });

  const run = (now = AFTER) => {
    const counters = new JobCounters();
    return ingestOfficialValues({ store, fetcher, sources, tables: [TABLE], now: () => now }, counters).then(
      (result) => ({ result, counters }),
    );
  };
  const cpiEvent = () => store.events.find((e) => e.id === CPI_ID)!;

  it('publishes the first official value when the release date, period, value, unit and source all match', async () => {
    fetcher.responses.set(
      ONS_CPI_URL,
      onsCpi(
        [
          ['2026 SEP', '3.5', '2026-10-21'],
          ['2026 OCT', '3.7', '2026-11-18'],
        ],
        '2026-11-18',
      ),
    );
    const { result } = await run();
    expect(result.published).toBe(1);
    expect(store.snapshots).toHaveLength(1);
    expect(store.snapshots[0]).toMatchObject({
      event_id: CPI_ID,
      actual: 3.7,
      forecast: null, // 予想は入れない
      previous: null, // 前回値を流用しない
      unit: '%',
      source: 'Office for National Statistics',
      source_url: ONS_CPI_URL,
      captured_at: AFTER.toISOString(),
      verification_status: 'VERIFIED',
      verification_source: 'D7G7@2026-10',
      official_actual: 3.7,
    });
    expect(cpiEvent()).toMatchObject({ status: 'RELEASED', data_status: 'AVAILABLE' });
  });

  it('release date mismatch (the API still shows the previous release): nothing saved — the previous value is never reused', async () => {
    fetcher.responses.set(ONS_CPI_URL, onsCpi([['2026 SEP', '3.5', '2026-10-21']], '2026-10-21'));
    const { result, counters } = await run();
    expect(result.published).toBe(0);
    expect(result.pending).toBeGreaterThanOrEqual(1);
    expect(store.snapshots).toEqual([]);
    expect(cpiEvent()).toMatchObject({ status: 'SCHEDULED', data_status: 'PENDING' });
    expect(counters.skipReasons.NOT_RELEASED_OR_DATE_MISMATCH).toBe(1);
  });

  it('period mismatch (released today, but for another month): nothing saved', async () => {
    fetcher.responses.set(ONS_CPI_URL, onsCpi([['2026 NOV', '3.9', '2026-11-18']], '2026-11-18'));
    const { counters } = await run();
    expect(store.snapshots).toEqual([]);
    expect(cpiEvent().status).toBe('SCHEDULED');
    expect(counters.skipReasons.PERIOD_MISMATCH).toBe(1);
  });

  it('an event without an official reference period (UK labour market) is never published', async () => {
    fetcher.responses.set(ONS_CPI_URL, onsCpi([['2026 OCT', '3.7', '2026-11-18']], '2026-11-18'));
    fetcher.responses.set(
      'https://www.ons.gov.uk/employmentandlabourmarket/peoplenotinwork/unemployment/timeseries/mgsx/lms/data',
      {
        description: { cdid: 'MGSX', releaseDate: '2026-11-17T00:00:00.000Z' },
        months: [{ date: '2026 AUG', value: '4.8', updateDate: '2026-11-17T00:00:00.000Z' }],
      },
    );
    const { counters } = await run();
    expect(store.snapshots.map((s) => s.event_id)).toEqual([CPI_ID]);
    expect(store.events.find((e) => e.id === 'ev-u')!.status).toBe('SCHEDULED');
    expect(counters.skipReasons.NO_REFERENCE_PERIOD).toBe(1);
  });

  it('a re-run does not register twice and never overwrites the RELEASED first value', async () => {
    fetcher.responses.set(ONS_CPI_URL, onsCpi([['2026 OCT', '3.7', '2026-11-18']], '2026-11-18'));
    await run();
    const { result } = await run();
    expect(result.published).toBe(0);
    expect(store.snapshots).toHaveLength(1);
    expect(store.snapshots[0]!.actual).toBe(3.7);
    expect(store.revisions).toEqual([]);
  });

  it('a later official revision is kept apart from the first value (event_revisions, once)', async () => {
    fetcher.responses.set(ONS_CPI_URL, onsCpi([['2026 OCT', '3.7', '2026-11-18']], '2026-11-18'));
    await run();
    // 次の公表(12/16)で 10月分が 3.8 に改定された
    fetcher.responses.set(
      ONS_CPI_URL,
      onsCpi(
        [
          ['2026 OCT', '3.8', '2026-12-16'],
          ['2026 NOV', '3.6', '2026-12-16'],
        ],
        '2026-12-16',
      ),
    );
    const later = new Date('2026-12-16T09:00:00Z');
    const { result } = await run(later);
    expect(result.revisions).toBe(1);
    expect(store.snapshots[0]!.actual).toBe(3.7); // 初回値はそのまま
    expect(store.revisions).toEqual([
      expect.objectContaining({
        event_id: CPI_ID,
        field_name: 'ACTUAL',
        old_value: 3.7,
        new_value: 3.8,
        source: 'Office for National Statistics',
      }),
    ]);
    const again = await run(later);
    expect(again.result.revisions).toBe(0); // 同じ改定を二度足さない
    expect(store.revisions).toHaveLength(1);
  });

  it('a fetch failure keeps the event DATA_PENDING and writes nothing', async () => {
    fetcher.failing.add(ONS_CPI_URL);
    const { counters } = await run();
    expect(store.snapshots).toEqual([]);
    expect(cpiEvent()).toMatchObject({ status: 'SCHEDULED', data_status: 'PENDING' });
    expect(counters.skipReasons.FETCH_FAILED).toBeGreaterThanOrEqual(1);
  });

  it('data without a unit or a source is never made RELEASED', async () => {
    fetcher.responses.set(ONS_CPI_URL, onsCpi([['2026 OCT', '3.7', '2026-11-18']], '2026-11-18'));
    const noUnit = sources.map((s) => (s.indicatorCode === 'GB_CPI' ? { ...s, unit: '' } : s));
    const counters = new JobCounters();
    await ingestOfficialValues({ store, fetcher, sources: noUnit, tables: [TABLE], now: () => AFTER }, counters);
    expect(store.snapshots).toEqual([]);
    expect(counters.skipReasons.NO_UNIT_OR_SOURCE).toBe(1);
    const noSource = sources.map((s) => (s.indicatorCode === 'GB_CPI' ? { ...s, sourceName: '' } : s));
    await ingestOfficialValues(
      { store, fetcher, sources: noSource, tables: [TABLE], now: () => AFTER },
      new JobCounters(),
    );
    expect(store.snapshots).toEqual([]);
  });

  it('a non-numeric or blank value is never published', async () => {
    fetcher.responses.set(ONS_CPI_URL, onsCpi([['2026 OCT', '', '2026-11-18']], '2026-11-18'));
    await run();
    expect(store.snapshots).toEqual([]);
    fetcher.responses.set(ONS_CPI_URL, onsCpi([['2026 OCT', '..', '2026-11-18']], '2026-11-18'));
    await run();
    expect(store.snapshots).toEqual([]);
  });

  it('events before the release time are not looked at (nothing is fetched)', async () => {
    const { result } = await run(new Date('2026-11-17T06:00:00Z'));
    expect(result.published).toBe(0);
    expect(fetcher.calls).toEqual([]);
  });
});
