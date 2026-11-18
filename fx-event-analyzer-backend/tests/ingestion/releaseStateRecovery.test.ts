/**
 * QA-1: 初回値(RELEASE スナップショット)を保存した後で、イベントの状態更新(RELEASED・AVAILABLE)が失敗した場合の回復。
 * スナップショットは DB のトリガーで更新・削除できないので、状態更新の失敗の後は「スナップショットは有るのにイベントは
 * SCHEDULED・PENDING」になる。修正前は、再実行が「スナップショットが有る」ことだけを見て改定の確認に進み、状態が直らなかった。
 *
 * 確かめること(official-values・jp-cpi-values・経済カレンダー本体・再検証の4経路):
 *  - 状態更新が失敗した実行: スナップショットは1件、イベントは SCHEDULED のまま、エラーが1件
 *  - 再実行: イベントが RELEASED・AVAILABLE になる。スナップショットは増えず、値も変わらない。改定の履歴も増えない
 *  - 取りやめ(CANCELLED)・BLS の値なし(UNAVAILABLE)の行は、スナップショットが有っても触らない
 *  - dry-run は何も書かない
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { parseTradingEconomicsCalendar } from '../../src/ingestion/adapters/tradingEconomics.js';
import type { OfficialScheduleTable } from '../../src/ingestion/mappings/gbAuCaSchedule.js';
import type { JpCpiScheduleEntry } from '../../src/ingestion/mappings/jpCpiSchedule.js';
import type { IndicatorMapping } from '../../src/ingestion/mappings/indicators.js';
import { ingestCalendarReleases, reverifyAwaitingOfficial } from '../../src/ingestion/pipelines/economicCalendar.js';
import { ingestJpCpiValues } from '../../src/ingestion/pipelines/jpCpiValues.js';
import { ingestOfficialValues, OFFICIAL_VALUE_SOURCES } from '../../src/ingestion/pipelines/officialValues.js';
import { needsReleasedStateRepair } from '../../src/ingestion/pipelines/releaseRecovery.js';
import { JobCounters } from '../../src/ingestion/runner.js';
import type { EventPatch } from '../../src/ingestion/store.js';
import type { NormalizedCalendarRelease } from '../../src/ingestion/types.js';
import type { OfficialValueResolver } from '../../src/ingestion/verification/official.js';
import { jsonFixture, MemoryIngestionStore } from '../helpers/memoryIngestionStore.js';

/** updateEvent を、指定の回数だけ失敗させる(DB の一時的な障害を真似る)。 */
class FlakyStore extends MemoryIngestionStore {
  failUpdates = 0;
  updateAttempts = 0;
  override updateEvent(eventId: string, patch: EventPatch): Promise<void> {
    this.updateAttempts += 1;
    if (this.failUpdates > 0) {
      this.failUpdates -= 1;
      return Promise.reject(new Error('connection reset'));
    }
    return super.updateEvent(eventId, patch);
  }
}

describe('needsReleasedStateRepair', () => {
  const snap = { actual: 1 };
  it('repairs only SCHEDULED/PENDING and RELEASED/PENDING, and only when a snapshot exists', () => {
    expect(needsReleasedStateRepair({ status: 'SCHEDULED', data_status: 'PENDING' }, snap)).toBe(true);
    expect(needsReleasedStateRepair({ status: 'RELEASED', data_status: 'PENDING' }, snap)).toBe(true);
    expect(needsReleasedStateRepair({ status: 'SCHEDULED', data_status: 'PENDING' }, null)).toBe(false);
    expect(needsReleasedStateRepair({ status: 'RELEASED', data_status: 'AVAILABLE' }, snap)).toBe(false);
    expect(needsReleasedStateRepair({ status: 'RELEASED', data_status: 'UNAVAILABLE' }, snap)).toBe(false);
    expect(needsReleasedStateRepair({ status: 'CANCELLED', data_status: 'PENDING' }, snap)).toBe(false);
    expect(needsReleasedStateRepair({ status: 'CANCELLED', data_status: 'UNAVAILABLE' }, snap)).toBe(false);
  });

  it('leaves every other status/data_status combination alone (C review condition 1)', () => {
    const statuses = ['SCHEDULED', 'RELEASED', 'CANCELLED'] as const;
    const dataStatuses = ['PENDING', 'AVAILABLE', 'PARTIAL', 'UNAVAILABLE'] as const;
    for (const status of statuses) {
      for (const data_status of dataStatuses) {
        const target = (status === 'SCHEDULED' || status === 'RELEASED') && data_status === 'PENDING';
        expect(needsReleasedStateRepair({ status, data_status }, snap), `${status}/${data_status}`).toBe(target);
        expect(
          needsReleasedStateRepair({ status, data_status }, null),
          `${status}/${data_status} without snapshot`,
        ).toBe(false);
      }
    }
  });
});

// ---------------------------------------------------------------- official-values

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
  ],
};
const ONS_CPI_URL = 'https://www.ons.gov.uk/economy/inflationandpriceindices/timeseries/d7g7/mm23/data';
const midnight = (date: string) => `${date}T00:00:00.000Z`;
const onsCpi = (value: string, releasedOn: string) => ({
  description: { cdid: 'D7G7', unit: '%', releaseDate: midnight(releasedOn) },
  months: [{ date: '2026 OCT', value, updateDate: midnight(releasedOn) }],
});

describe('QA-1: official-values recovers an event whose state update failed after the first value was saved', () => {
  const sources = OFFICIAL_VALUE_SOURCES.filter((s) => s.indicatorCode === 'GB_CPI');
  const AFTER = new Date('2026-11-18T09:00:00Z');
  let store: FlakyStore;
  let responses: Map<string, unknown>;
  const fetcher = { getJson: (url: string) => Promise.resolve(responses.get(url) ?? {}) };
  const event = () => store.events.find((e) => e.id === 'ev-cpi')!;
  const run = async (opts: { now?: Date; dryRun?: boolean } = {}) => {
    const counters = new JobCounters();
    const result = await ingestOfficialValues(
      { store, fetcher, sources, tables: [TABLE], now: () => opts.now ?? AFTER, dryRun: opts.dryRun === true },
      counters,
    );
    return { result, counters };
  };

  beforeEach(() => {
    store = new FlakyStore();
    responses = new Map([[ONS_CPI_URL, onsCpi('3.5', '2026-11-18')]]);
    store.indicators = [
      { id: 'ind-gb-cpi', code: 'GB_CPI', importance: 'HIGH', favorable_direction: 'HIGHER_IS_POSITIVE' },
    ];
    store.events = [
      {
        id: 'ev-cpi',
        indicator_id: 'ind-gb-cpi',
        provider: 'ons_release_calendar',
        provider_event_id: 'ons_release_calendar:GB_CPI:2026-10',
        importance: 'HIGH',
        release_datetime: '2026-11-18T07:00:00.000Z',
        release_datetime_precision: 'EXACT',
        status: 'SCHEDULED',
        data_status: 'PENDING',
      },
    ];
  });

  it('reproduces the stuck state, then a re-run repairs the event without touching the snapshot or revisions', async () => {
    store.failUpdates = 1;
    const first = await run();
    // 修正前もここまでは同じ: スナップショットは保存され、イベントは SCHEDULED のまま、エラーが1件
    expect(store.snapshots).toHaveLength(1);
    expect(event()).toMatchObject({ status: 'SCHEDULED', data_status: 'PENDING' });
    expect(first.counters.errors).toBe(1);
    expect(first.result.published).toBe(0);

    const second = await run();
    expect(event()).toMatchObject({ status: 'RELEASED', data_status: 'AVAILABLE' }); // 修正前: SCHEDULED のまま
    expect(second.counters.errors).toBe(0);
    expect(second.result.plan.map((p) => p.action)).toContain('REPAIR');
    expect(store.snapshots).toHaveLength(1);
    expect(store.snapshots[0]).toMatchObject({ actual: 3.5, verification_source: 'D7G7@2026-10' });
    expect(store.revisions).toEqual([]);

    const third = await run(); // 3回目は何もしない
    expect(third.result.plan.map((p) => p.action)).not.toContain('REPAIR');
    expect(store.snapshots).toHaveLength(1);
    expect(store.revisions).toEqual([]);
  });

  it('still records a later revision after the repair, and keeps the first value', async () => {
    store.failUpdates = 1;
    await run();
    responses.set(ONS_CPI_URL, onsCpi('3.6', '2026-11-18')); // 同じ月が 3.6 に改定
    const r = await run();
    expect(event()).toMatchObject({ status: 'RELEASED', data_status: 'AVAILABLE' });
    expect(r.result.revisions).toBe(1);
    expect(store.snapshots[0]!.actual).toBe(3.5);
    expect(store.revisions).toEqual([
      expect.objectContaining({ event_id: 'ev-cpi', field_name: 'ACTUAL', old_value: 3.5, new_value: 3.6 }),
    ]);
  });

  it('a repair that fails again is reported and retried on the next run; the snapshot stays single', async () => {
    store.failUpdates = 2;
    await run(); // 保存 → 状態更新が失敗
    const second = await run(); // 修復も失敗
    expect(second.counters.errors).toBe(1);
    expect(event().status).toBe('SCHEDULED');
    await run();
    expect(event()).toMatchObject({ status: 'RELEASED', data_status: 'AVAILABLE' });
    expect(store.snapshots).toHaveLength(1);
  });

  it('does not touch a cancelled event or a value-less (UNAVAILABLE) event that happens to have a snapshot', async () => {
    store.failUpdates = 1;
    await run();
    Object.assign(event(), { status: 'CANCELLED', data_status: 'UNAVAILABLE' });
    store.updateAttempts = 0;
    await run();
    expect(event()).toMatchObject({ status: 'CANCELLED', data_status: 'UNAVAILABLE' });
    Object.assign(event(), { status: 'RELEASED', data_status: 'UNAVAILABLE' });
    await run();
    expect(event()).toMatchObject({ status: 'RELEASED', data_status: 'UNAVAILABLE' });
    expect(store.updateAttempts).toBe(0);
  });

  it.each([
    ['SCHEDULED', 'AVAILABLE'],
    ['SCHEDULED', 'PARTIAL'],
    ['SCHEDULED', 'UNAVAILABLE'],
    ['RELEASED', 'PARTIAL'],
  ] as const)('does not write to a %s/%s event that has a snapshot', async (status, data_status) => {
    await run(); // 初回値を保存する(正常に RELEASED・AVAILABLE になる)
    Object.assign(event(), { status, data_status });
    store.updateAttempts = 0;
    const r = await run();
    expect(r.result.plan.map((p) => p.action)).not.toContain('REPAIR');
    expect(store.updateAttempts).toBe(0);
    expect(event()).toMatchObject({ status, data_status });
    expect(store.snapshots).toHaveLength(1);
  });

  it('a stuck row older than lookbackDays (default 45) is not repaired automatically; a longer lookbackDays repairs it', async () => {
    store.failUpdates = 1;
    await run();
    expect(event()).toMatchObject({ status: 'SCHEDULED', data_status: 'PENDING' });
    const later = new Date(AFTER.getTime() + 60 * 86_400_000); // 公表の 60 日後
    store.updateAttempts = 0;
    await run({ now: later });
    expect(store.updateAttempts).toBe(0); // 既定の 45 日の外: 人手の対応が要る
    expect(event()).toMatchObject({ status: 'SCHEDULED', data_status: 'PENDING' });
    const counters = new JobCounters();
    await ingestOfficialValues(
      { store, fetcher, sources, tables: [TABLE], now: () => later, lookbackDays: 120 },
      counters,
    );
    expect(event()).toMatchObject({ status: 'RELEASED', data_status: 'AVAILABLE' });
    expect(store.snapshots).toHaveLength(1);
    expect(store.revisions).toEqual([]);
  });

  it('dry-run reports REPAIR but writes nothing', async () => {
    store.failUpdates = 1;
    await run();
    store.updateAttempts = 0;
    const dry = await run({ dryRun: true });
    expect(dry.result.plan.map((p) => p.action)).toContain('REPAIR');
    expect(store.updateAttempts).toBe(0);
    expect(event().status).toBe('SCHEDULED');
  });
});

// ---------------------------------------------------------------- jp-cpi-values

describe('QA-1: jp-cpi-values recovers an event whose state update failed after the first value was saved', () => {
  const SCHEDULE: JpCpiScheduleEntry[] = [
    { referencePeriod: '2026-10', releaseDate: '2026-11-20', sources: ['x'], checkedAt: '2026-11-10' },
  ];
  const META = {
    GET_META_INFO: {
      METADATA_INF: {
        CLASS_INF: {
          CLASS_OBJ: [
            { '@id': 'tab', CLASS: [{ '@code': '3', '@name': '前年同月比' }] },
            { '@id': 'cat01', CLASS: [{ '@code': '0001', '@name': '0001 総合' }] },
            { '@id': 'area', CLASS: [{ '@code': '00000', '@name': '全国' }] },
            { '@id': 'time', CLASS: [{ '@code': '2026001010', '@name': '2026年10月' }] },
          ],
        },
      },
    },
  };
  let value = '2.3';
  const fetcher = {
    getJson: (url: string) =>
      Promise.resolve(
        url.includes('getMetaInfo')
          ? META
          : {
              GET_STATS_DATA: {
                RESULT: { STATUS: 0 },
                STATISTICAL_DATA: {
                  TABLE_INF: { UPDATED_DATE: '2026-11-20' },
                  DATA_INF: {
                    VALUE: [
                      {
                        '@tab': '3',
                        '@cat01': '0001',
                        '@area': '00000',
                        '@time': '2026001010',
                        '@unit': '%',
                        $: value,
                      },
                    ],
                  },
                },
              },
            },
      ),
  };
  let store: FlakyStore;
  const run = async (dryRun = false) => {
    const counters = new JobCounters();
    const attempt = ingestJpCpiValues(
      { store, fetcher, appId: 'APP', schedule: SCHEDULE, now: () => new Date('2026-11-21T00:00:00Z'), dryRun },
      counters,
    );
    return attempt.then(
      (result) => ({ result, counters, error: null as Error | null }),
      (error: Error) => ({ result: null, counters, error }),
    );
  };

  beforeEach(() => {
    value = '2.3';
    store = new FlakyStore();
    store.indicators = [
      { id: 'ind-jp', code: 'JP_CPI', importance: 'HIGH', favorable_direction: 'HIGHER_IS_POSITIVE' },
    ];
    store.events = [
      {
        id: 'ev-jp',
        indicator_id: 'ind-jp',
        provider: 'estat_cpi_schedule',
        provider_event_id: 'estat_cpi_schedule:2026-10',
        importance: 'HIGH',
        release_datetime: '2026-11-19T23:30:00.000Z',
        release_datetime_precision: 'EXACT',
        status: 'SCHEDULED',
        data_status: 'PENDING',
      },
    ];
  });

  it('reproduces the stuck state, then a re-run repairs the event; the snapshot and revisions are untouched', async () => {
    store.failUpdates = 1;
    const first = await run();
    expect(first.error?.message).toBe('connection reset'); // 状態更新の失敗
    expect(store.snapshots).toHaveLength(1);
    expect(store.events[0]).toMatchObject({ status: 'SCHEDULED', data_status: 'PENDING' });

    const second = await run();
    expect(second.error).toBeNull();
    expect(store.events[0]).toMatchObject({ status: 'RELEASED', data_status: 'AVAILABLE' }); // 修正前: SCHEDULED のまま
    expect(second.result!.plan.map((p) => p.action)).toContain('REPAIR');
    expect(store.snapshots).toHaveLength(1);
    expect(store.snapshots[0]).toMatchObject({ actual: 2.3 });
    expect(store.revisions).toEqual([]);
  });

  it('still records a revision after the repair, and dry-run writes nothing', async () => {
    store.failUpdates = 1;
    await run();
    store.updateAttempts = 0;
    const dry = await run(true);
    expect(dry.result!.plan.map((p) => p.action)).toContain('REPAIR');
    expect(store.updateAttempts).toBe(0);
    expect(store.events[0]!.status).toBe('SCHEDULED');
    value = '2.4';
    const real = await run();
    expect(store.events[0]).toMatchObject({ status: 'RELEASED', data_status: 'AVAILABLE' });
    expect(real.result!.revisions).toBe(1);
    expect(store.snapshots[0]!.actual).toBe(2.3);
    expect(store.revisions).toEqual([expect.objectContaining({ old_value: 2.3, new_value: 2.4 })]);
  });
});

// ---------------------------------------------------------------- economic calendar

class FakeOfficial implements OfficialValueResolver {
  values = new Map<string, number>();
  resolve(mapping: IndicatorMapping, period: string, asOfDate: string) {
    const value = this.values.get(`${mapping.code}|${period}`);
    return Promise.resolve(value === undefined ? null : { value, sourceRef: `FRED:TEST@${asOfDate}` });
  }
}
const FETCHED_AT = '2026-10-15T09:00:00.000Z';
const NOW = () => new Date(FETCHED_AT);
const teReleases = async (): Promise<NormalizedCalendarRelease[]> =>
  parseTradingEconomicsCalendar(await jsonFixture('tradingeconomics-calendar.json'), FETCHED_AT);

describe('QA-1: the economic calendar pipeline recovers an event whose state update failed after publishing', () => {
  let store: FlakyStore;
  let official: FakeOfficial;
  const cpiEvent = () => store.events.find((e) => e.provider_event_id === '400001')!;
  const run = async (releases: NormalizedCalendarRelease[]) => {
    const counters = new JobCounters();
    await ingestCalendarReleases('tradingeconomics', releases, { store, official, now: NOW }, counters);
    return counters;
  };

  beforeEach(() => {
    store = new FlakyStore();
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

  it('a later run (snapshot exists, event still SCHEDULED) repairs the state; the snapshot and revisions stay', async () => {
    // 1回目: 新しい行は insertEvent で作られ、その後の updateEvent(RELEASED)を1回失敗させる
    store.failUpdates = 1;
    await run(await teReleases());
    // 実績つきの新しい行は status RELEASED・data_status PENDING で作られ、publishRelease が AVAILABLE にする。その更新が失敗すると
    // スナップショットは有るのに data_status が PENDING のまま残る
    const stuck = store.snapshots.filter(
      (s) => store.events.find((e) => e.id === s.event_id)?.data_status === 'PENDING',
    );
    expect(stuck.length).toBeGreaterThanOrEqual(1);
    const snapshotsBefore = store.snapshots.length;
    const revisionsBefore = [...store.revisions]; // NFP の前回値の公式改定(120→133)は1回目に入っている

    await run(await teReleases());
    expect(
      store.events.filter((e) => store.snapshots.some((s) => s.event_id === e.id) && e.data_status !== 'AVAILABLE'),
    ).toEqual([]); // 修正前: data_status が PENDING のまま残る
    expect(store.snapshots).toHaveLength(snapshotsBefore);
    expect(store.revisions).toEqual(revisionsBefore);
    expect(cpiEvent().data_status).toBe('AVAILABLE');
  });

  it('re-verification: a snapshot that was saved before the failed state update is repaired and the staged value is verified', async () => {
    official.values.delete('US_CPI|2026-09');
    await run(await teReleases());
    expect(store.staged.find((s) => s.event_id === cpiEvent().id)?.verification_status).toBe('AWAITING_OFFICIAL');

    official.values.set('US_CPI|2026-09', 3.7376847);
    store.failUpdates = 1; // スナップショットの保存の後の updateEvent が失敗
    const first = new JobCounters();
    await reverifyAwaitingOfficial({ store, official, now: NOW }, first);
    expect(first.errors).toBe(1);
    expect(store.snapshots.filter((s) => s.event_id === cpiEvent().id)).toHaveLength(1);
    expect(cpiEvent().data_status).toBe('PENDING');
    expect(store.staged.find((s) => s.event_id === cpiEvent().id)?.verification_status).toBe('AWAITING_OFFICIAL');

    const second = new JobCounters();
    await reverifyAwaitingOfficial({ store, official, now: NOW }, second);
    // 修正前: SNAPSHOT_ALREADY_EXISTS で PENDING_REVIEW になり、イベントは data_status PENDING のまま
    expect(cpiEvent()).toMatchObject({ status: 'RELEASED', data_status: 'AVAILABLE' });
    expect(store.staged.find((s) => s.event_id === cpiEvent().id)).toMatchObject({ verification_status: 'VERIFIED' });
    expect(store.snapshots.filter((s) => s.event_id === cpiEvent().id)).toHaveLength(1);
    expect(second.errors).toBe(0);
  });

  it('re-verification: a stuck snapshot whose value differs from the staged value still goes to human review', async () => {
    official.values.delete('US_CPI|2026-09');
    await run(await teReleases());
    const id = cpiEvent().id;
    official.values.set('US_CPI|2026-09', 3.7376847);
    store.snapshots.push({ ...store.snapshots[0]!, event_id: id, actual: 9.9 });
    await reverifyAwaitingOfficial({ store, official, now: NOW }, new JobCounters());
    expect(cpiEvent().data_status).toBe('PENDING');
    expect(store.staged.find((s) => s.event_id === id)).toMatchObject({ verification_status: 'PENDING_REVIEW' });
  });
});
