/**
 * HQ決定(2026-11-10「公式経済指標の実績値取得・保存処理」): 公式機関の初回公表値を、公表日・対象期間・数値・単位・出典が
 * そろったときだけ RELEASED として保存する。そろわなければ DATA_PENDING(SCHEDULED・PENDING)のまま。初回値は上書きせず、
 * 改定は event_revisions に別の履歴として足す。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type { OfficialScheduleTable } from '../../src/ingestion/mappings/gbAuCaSchedule.js';
import { HttpError } from '../../src/ingestion/http.js';
import { ingestOfficialValues, OFFICIAL_VALUE_SOURCES } from '../../src/ingestion/pipelines/officialValues.js';
import { applyFetchOutcome, JobCounters, judgeFetchOutcome, runIngestionJob } from '../../src/ingestion/runner.js';
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
  /** HTTP 404(未公表・日付不一致)を返す URL。 */
  notFound = new Set<string>();
  calls: string[] = [];
  getJson(url: string): Promise<unknown> {
    this.calls.push(url);
    if (this.notFound.has(url)) return Promise.reject(new HttpError('HTTP 404', 404, false));
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

  // HQ指示(2026-11-13): dry-run は公式の API は読むが、DB には何も書かない。plan で、何をするはずかを返す
  describe('dry run', () => {
    const dry = (now = AFTER) => {
      const counters = new JobCounters();
      return ingestOfficialValues(
        { store, fetcher, sources, tables: [TABLE], now: () => now, dryRun: true },
        counters,
      ).then((result) => ({ result, counters }));
    };

    it('returns what it would publish, and writes nothing (no snapshot, no event change, no revision)', async () => {
      fetcher.responses.set(ONS_CPI_URL, onsCpi([['2026 OCT', '3.7', '2026-11-18']], '2026-11-18'));
      const eventsBefore = JSON.stringify(store.events);
      const { result } = await dry();
      expect(result.published).toBe(1);
      expect(result.plan).toContainEqual({
        provider_event_id: 'ons_release_calendar:GB_CPI:2026-10',
        indicator: 'GB_CPI',
        action: 'PUBLISH',
        period: '2026-10',
        value: 3.7,
      });
      expect(store.snapshots).toEqual([]);
      expect(store.revisions).toEqual([]);
      expect(JSON.stringify(store.events)).toBe(eventsBefore);
      expect(cpiEvent()).toMatchObject({ status: 'SCHEDULED', data_status: 'PENDING' });
    });

    it('the same data, run for real afterwards, publishes exactly what the dry run announced', async () => {
      fetcher.responses.set(ONS_CPI_URL, onsCpi([['2026 OCT', '3.7', '2026-11-18']], '2026-11-18'));
      const { result: planned } = await dry();
      const { result } = await run();
      const item = planned.plan.find((p) => p.action === 'PUBLISH')!;
      expect(store.snapshots[0]).toMatchObject({ actual: item.value, verification_source: `D7G7@${item.period}` });
      expect(result.published).toBe(planned.published);
    });

    it('a release that is not out yet is PENDING in the plan (and still nothing is written)', async () => {
      fetcher.responses.set(ONS_CPI_URL, onsCpi([['2026 SEP', '3.5', '2026-10-21']], '2026-10-21'));
      const { result } = await dry();
      expect(result.published).toBe(0);
      expect(result.plan.find((p) => p.indicator === 'GB_CPI')).toMatchObject({
        action: 'PENDING',
        reason: 'NOT_RELEASED_OR_DATE_MISMATCH',
      });
      expect(store.snapshots).toEqual([]);
    });

    it('a revision of a RELEASED value is announced as REVISE (counted as would-revise) but not recorded', async () => {
      fetcher.responses.set(ONS_CPI_URL, onsCpi([['2026 OCT', '3.7', '2026-11-18']], '2026-11-18'));
      await run();
      fetcher.responses.set(ONS_CPI_URL, onsCpi([['2026 OCT', '3.8', '2026-11-19']], '2026-11-18'));
      const { result } = await dry(new Date('2026-11-19T09:00:00Z'));
      expect(result.plan.find((p) => p.indicator === 'GB_CPI')).toMatchObject({ action: 'REVISE', value: 3.8 });
      expect(result.revisions).toBe(1); // 改定する「はずの」件数
      expect(store.revisions).toEqual([]); // 実際の記録は0件
      expect(store.snapshots).toHaveLength(1);
    });
  });

  it('release date mismatch (the API still shows the previous release): nothing saved — the previous value is never reused', async () => {
    fetcher.responses.set(ONS_CPI_URL, onsCpi([['2026 SEP', '3.5', '2026-10-21']], '2026-10-21'));
    const { result, counters } = await run();
    expect(result.published).toBe(0);
    expect(result.pending).toBeGreaterThanOrEqual(1);
    expect(store.snapshots).toEqual([]);
    expect(cpiEvent()).toMatchObject({ status: 'SCHEDULED', data_status: 'PENDING' });
    // GB_CPI と、同じ実行で見る GB_UNEMPLOYMENT_RATE(応答が空)の2件
    expect(counters.skipReasons.NOT_RELEASED_OR_DATE_MISMATCH).toBe(2);
  });

  it('period mismatch (released today, but for another month): nothing saved', async () => {
    fetcher.responses.set(ONS_CPI_URL, onsCpi([['2026 NOV', '3.9', '2026-11-18']], '2026-11-18'));
    const { counters } = await run();
    expect(store.snapshots).toEqual([]);
    expect(cpiEvent().status).toBe('SCHEDULED');
    expect(counters.skipReasons.PERIOD_MISMATCH).toBe(1);
  });

  it('UK labour market: without an official label period and unit in the API, nothing is published', async () => {
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
    expect(counters.skipReasons.NOT_RELEASED_OR_DATE_MISMATCH).toBe(1); // 単位・ラベルの無い応答
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

describe('fetch outcome (HQ指示 2026-11-19): no-op ≠ partial failure ≠ all failed', () => {
  const sources = OFFICIAL_VALUE_SOURCES.filter(
    (s) => s.indicatorCode === 'GB_CPI' || s.indicatorCode === 'GB_UNEMPLOYMENT_RATE',
  );

  function setup() {
    const store = new MemoryIngestionStore();
    const fetcher = new FakeFetcher();
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
    return { store, fetcher };
  }

  /** ジョブと同じ形(runIngestionJob の中で、取り込みの後に applyFetchOutcome)。 */
  async function runJob(now: Date, fetcher: FakeFetcher, store: MemoryIngestionStore, scheduled = true) {
    let warning: string | null = null;
    const result = await runIngestionJob(
      store,
      { provider: 'official_values', dataType: 'ECONOMIC_EVENT', job: 'ingest:official-values' },
      async (counters) => {
        await ingestOfficialValues({ store, fetcher, sources, tables: [TABLE], now: () => now }, counters);
        warning = applyFetchOutcome(counters, 'official-values', scheduled);
      },
    );
    return { result, warning: warning as string | null, log: store.logs.at(-1)! };
  }

  it('judgeFetchOutcome: 0 attempts = NO_FETCH, none failed = OK, some = PARTIAL_FAILURE, all = ALL_FAILED', () => {
    expect(judgeFetchOutcome(0, 0)).toBe('NO_FETCH');
    expect(judgeFetchOutcome(9, 0)).toBe('OK');
    expect(judgeFetchOutcome(9, 1)).toBe('PARTIAL_FAILURE');
    expect(judgeFetchOutcome(9, 8)).toBe('PARTIAL_FAILURE');
    expect(judgeFetchOutcome(9, 9)).toBe('ALL_FAILED');
    expect(judgeFetchOutcome(1, 1)).toBe('ALL_FAILED');
  });

  it('nothing due (before the release): no fetch, SUCCESS, exit 0 — a normal no-op is never a failure', async () => {
    const { store, fetcher } = setup();
    const { result, warning, log } = await runJob(new Date('2026-11-17T06:00:00Z'), fetcher, store);
    expect(fetcher.calls).toEqual([]);
    expect(result.status).toBe('SUCCESS');
    expect(warning).toBeNull();
    expect(log.details).not.toHaveProperty('fetch_attempted');
  });

  it('every attempted fetch failed: FAILURE (exit 1), the counts are in the log, and nothing is written', async () => {
    const { store, fetcher } = setup();
    for (const s of sources) fetcher.failing.add(s.request.url);
    const { result, log } = await runJob(AFTER, fetcher, store);
    expect(result.status).toBe('FAILURE');
    expect(result.counters.errorMessages.join()).toContain('all 2 fetch(es) failed');
    expect(log.details).toMatchObject({ fetch_attempted: 2, fetch_failed: 2 });
    expect((log.details as { skip_reasons: Record<string, number> }).skip_reasons.FETCH_FAILED).toBe(2);
    expect(store.snapshots).toEqual([]);
  });

  describe('exit code on all-failed depends on the run type (scheduled = 1; manual and dry-run keep the previous behaviour; HQ 判断 2026-11-19)', () => {
    const allFailing = (fetcher: FakeFetcher) => {
      for (const s of sources) fetcher.failing.add(s.request.url);
    };
    const exitOf = (status: string) => (status === 'SUCCESS' ? 0 : 1); // ジョブ: process.exitCode = status === 'SUCCESS' ? 0 : 1

    it('scheduled (--scheduled): every fetch failed → FAILURE, exit code 1; nothing is written', async () => {
      const { store, fetcher } = setup();
      allFailing(fetcher);
      const { result } = await runJob(AFTER, fetcher, store, true);
      expect(exitOf(result.status)).toBe(1);
      expect(store.snapshots).toEqual([]);
    });

    it('manual write (no flag): every fetch failed → the previous behaviour — SUCCESS, exit code 0; the counts stay in the log', async () => {
      const { store, fetcher } = setup();
      allFailing(fetcher);
      const { result, log } = await runJob(AFTER, fetcher, store, false);
      expect(result.status).toBe('SUCCESS');
      expect(exitOf(result.status)).toBe(0);
      expect(result.counters.errors).toBe(0);
      expect(log.details).toMatchObject({ fetch_attempted: 2, fetch_failed: 2 });
      expect(store.snapshots).toEqual([]);
    });

    it('manual dry-run: every fetch failed → the previous behaviour — no error, exit code 0 (the job does not even judge the outcome)', async () => {
      const { store, fetcher } = setup();
      allFailing(fetcher);
      const counters = new JobCounters();
      await ingestOfficialValues(
        { store, fetcher, sources, tables: [TABLE], now: () => AFTER, dryRun: true },
        counters,
      );
      expect(counters.errors).toBe(0);
      expect(counters.errors > 0 ? 1 : 0).toBe(0);
      expect(store.snapshots).toEqual([]);
      expect(store.logs).toEqual([]); // dry-run は ingestion_logs にも書かない
    });

    it('the flag only affects the exit code: a normal fetch saves exactly the same content in scheduled and manual runs', async () => {
      const saved = async (scheduled: boolean) => {
        const { store, fetcher } = setup();
        fetcher.responses.set(ONS_CPI_URL, onsCpi([['2026 OCT', '3.7', '2026-11-18']], '2026-11-18'));
        const { result } = await runJob(AFTER, fetcher, store, scheduled);
        expect(result.status).toBe('SUCCESS');
        return JSON.stringify([store.snapshots, store.revisions, store.events]);
      };
      expect(await saved(true)).toBe(await saved(false));
      expect((JSON.parse(await saved(true)) as unknown[][])[0]).toHaveLength(1);
    });

    it('partial failure is the same warning in both run types (green, exit code 0)', async () => {
      for (const scheduled of [true, false]) {
        const { store, fetcher } = setup();
        fetcher.failing.add(sources.find((s) => s.indicatorCode === 'GB_CPI')!.request.url);
        const { result, warning } = await runJob(AFTER, fetcher, store, scheduled);
        expect(result.status).toBe('SUCCESS');
        expect(warning).toContain('1 of 2 fetches failed');
      }
    });

    it('the job passes the flag only for --scheduled and never for --dry-run; the scheduled workflow step is the only one that sets it', () => {
      const job = readFileSync(join(__dirname, '../../src/jobs/ingestOfficialValues.ts'), 'utf8');
      expect(job).toContain(
        "const scheduled = process.argv.includes('--scheduled') && !process.argv.includes('--dry-run');",
      );
      expect(job).toContain('scheduled,'); // 共通の本体 runOfficialValues に渡す
      const body = readFileSync(join(__dirname, '../../src/ingestion/officialValuesRun.ts'), 'utf8');
      expect(body).toContain("applyFetchOutcome(counters, 'official-values', deps.scheduled)");
    });
  });

  it('some fetches failed: stays SUCCESS (green) with a warning and the counts in the log; the next run retries', async () => {
    const { store, fetcher } = setup();
    fetcher.failing.add(sources.find((s) => s.indicatorCode === 'GB_CPI')!.request.url);
    const { result, warning, log } = await runJob(AFTER, fetcher, store);
    expect(result.status).toBe('SUCCESS');
    expect(warning).toContain('1 of 2 fetches failed');
    expect(log.details).toMatchObject({ fetch_attempted: 2, fetch_failed: 1 });
  });

  it('all fetches succeed (even with nothing to publish yet): SUCCESS and no warning', async () => {
    const { store, fetcher } = setup();
    const { result, warning, log } = await runJob(AFTER, fetcher, store);
    expect(result.status).toBe('SUCCESS');
    expect(warning).toBeNull();
    expect(log.details).toMatchObject({ fetch_attempted: 2, fetch_failed: 0 });
  });

  describe('404 (not published / date mismatch) is its own category (HQ指示 2026-11-19 A2)', () => {
    const absTable: OfficialScheduleTable = {
      provider: 'abs_release_calendar',
      entries: [
        {
          indicatorCode: 'AU_CPI',
          key: '2026-10',
          referencePeriod: '2026-10',
          releaseDate: '2026-11-18',
          time: '11:30',
          timeZone: 'Australia/Sydney',
          sources: ['x'],
          checkedAt: '2026-11-10',
        },
      ],
    };
    const absSources = OFFICIAL_VALUE_SOURCES.filter((s) => s.indicatorCode === 'AU_CPI');

    async function runAbs(fetcher: FakeFetcher, scheduled = true) {
      const store = new MemoryIngestionStore();
      store.indicators = [
        { id: 'ind-au', code: 'AU_CPI', importance: 'HIGH', favorable_direction: 'HIGHER_IS_POSITIVE' },
      ];
      store.events = [
        {
          id: 'ev-au',
          indicator_id: 'ind-au',
          provider: 'abs_release_calendar',
          provider_event_id: 'abs_release_calendar:AU_CPI:2026-10',
          importance: 'HIGH',
          release_datetime: '2026-11-18T00:30:00.000Z',
          release_datetime_precision: 'EXACT',
          status: 'SCHEDULED',
          data_status: 'PENDING',
        },
      ];
      let warning: string | null = null;
      const result = await runIngestionJob(
        store,
        { provider: 'official_values', dataType: 'ECONOMIC_EVENT', job: 'ingest:official-values' },
        async (counters) => {
          await ingestOfficialValues(
            { store, fetcher, sources: absSources, tables: [absTable], now: () => new Date('2026-11-18T09:00:00Z') },
            counters,
          );
          warning = applyFetchOutcome(counters, 'official-values', scheduled);
        },
      );
      return { result, warning: warning as string | null, log: store.logs.at(-1)! };
    }

    it('every attempted fetch is a 404: a normal exit (SUCCESS, no warning); the 404 count is recorded', async () => {
      const fetcher = new FakeFetcher();
      const releaseUrl = absSources[0]!.releaseRequest!(absTable.entries[0]!)!.url;
      fetcher.notFound.add(releaseUrl);
      const { result, warning, log } = await runAbs(fetcher);
      expect(result.status).toBe('SUCCESS');
      expect(warning).toBeNull();
      expect(log.details).toMatchObject({ fetch_attempted: 2, fetch_not_found: 1, fetch_failed: 0 });
    });

    it('a 404 is not an "other failure": other failures are what turn it into a warning / failure', async () => {
      const fetcher = new FakeFetcher();
      fetcher.failing.add(absSources[0]!.request.url);
      const { result, log } = await runAbs(fetcher);
      expect(log.details).toMatchObject({ fetch_attempted: 1, fetch_not_found: 0, fetch_failed: 1 });
      expect(result.status).toBe('FAILURE'); // 取得対象の全件がその他の失敗
    });

    it('call order and the denominator: the release fetch only happens after the series fetch succeeded, so a failing release fetch is a warning, never all-failed', async () => {
      const fetcher = new FakeFetcher();
      const releaseUrl = absSources[0]!.releaseRequest!(absTable.entries[0]!)!.url;
      fetcher.failing.add(releaseUrl); // 404 ではない失敗(HTTP 503 相当)
      const { result, warning, log } = await runAbs(fetcher);
      // 系列の取得(成功)→ 発表日の取得(失敗)の順。試行 2・失敗 1 なので、全件失敗(赤)ではなく一部失敗(警告)
      expect(fetcher.calls[0]).toBe(absSources[0]!.request.url);
      expect(fetcher.calls[1]).toBe(releaseUrl);
      expect(log.details).toMatchObject({ fetch_attempted: 2, fetch_not_found: 0, fetch_failed: 1 });
      expect(result.status).toBe('SUCCESS');
      expect(warning).toContain('1 of 2 fetches failed');
    });

    it('the series fetch failing means the release fetch is never attempted (so a 404 cannot hide a series failure)', async () => {
      const fetcher = new FakeFetcher();
      fetcher.failing.add(absSources[0]!.request.url);
      await runAbs(fetcher);
      expect(fetcher.calls).toEqual([absSources[0]!.request.url]);
    });

    it('judgement uses only the other failures: successes + 404s + one other failure = warning', () => {
      const counters = new JobCounters();
      counters.fetchAttempted = 5;
      counters.fetchNotFound = 3;
      counters.fetchFailed = 1;
      expect(applyFetchOutcome(counters, 'x')).toContain('1 of 5 fetches failed');
      expect(counters.errors).toBe(0);
      const all404 = new JobCounters();
      all404.fetchAttempted = 3;
      all404.fetchNotFound = 3;
      expect(applyFetchOutcome(all404, 'x')).toBeNull();
      expect(all404.errors).toBe(0);
    });
  });
});
