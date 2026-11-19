/** HQ指示(2026-11-11「JP_CPI: ESTAT_APP_ID を利用する取得処理」): e-Stat の値 → 初回の公表値。 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { redactUrl } from '../../src/ingestion/http.js';
import { ingestJpCpiValues, JP_CPI_SOURCE_NAME } from '../../src/ingestion/pipelines/jpCpiValues.js';
import { JobCounters, resolveJobStatus } from '../../src/ingestion/runner.js';
import type { IngestionStore, NewReleaseSnapshot, NewRevision } from '../../src/ingestion/store.js';
import type { JpCpiScheduleEntry } from '../../src/ingestion/mappings/jpCpiSchedule.js';

const APP_ID = 'TEST-APP-ID-SECRET';
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

const statsData = (value: string | null, updated = '2026-11-20') => ({
  GET_STATS_DATA: {
    RESULT: { STATUS: 0 },
    STATISTICAL_DATA: {
      TABLE_INF: { UPDATED_DATE: updated },
      DATA_INF: {
        VALUE:
          value === null
            ? []
            : [{ '@tab': '3', '@cat01': '0001', '@area': '00000', '@time': '2026001010', '@unit': '%', $: value }],
      },
    },
  },
});

function setup(opts: { status?: 'SCHEDULED' | 'RELEASED'; snapshotActual?: number | null } = {}) {
  const snapshots: NewReleaseSnapshot[] = [];
  const revisions: NewRevision[] = [];
  const updates: unknown[] = [];
  const store = {
    findIndicatorsByCode: () =>
      Promise.resolve(new Map([['JP_CPI', { id: 'ind', code: 'JP_CPI', favorable_direction: 'HIGHER_IS_POSITIVE' }]])),
    listEventsByProvider: () =>
      Promise.resolve([
        {
          id: 'ev',
          indicator_id: 'ind',
          provider_event_id: 'estat_cpi_schedule:2026-10',
          release_datetime: '2026-11-19T23:30:00Z',
          release_datetime_precision: 'EXACT',
          status: opts.status ?? 'SCHEDULED',
          data_status: 'PENDING',
          is_provisional: false,
        },
      ]),
    getReleaseSnapshot: () =>
      Promise.resolve(
        opts.snapshotActual === undefined
          ? null
          : { forecast: null, actual: opts.snapshotActual, previous: null, verification_source: 'x@2026-10' },
      ),
    latestRevisionValues: () => Promise.resolve({ ACTUAL: null, PREVIOUS: null }),
    insertReleaseSnapshot: (s: NewReleaseSnapshot) => {
      snapshots.push(s);
      return Promise.resolve();
    },
    insertRevision: (r: NewRevision) => {
      revisions.push(r);
      return Promise.resolve();
    },
    updateEvent: (id: string, patch: unknown) => {
      updates.push({ id, patch });
      return Promise.resolve();
    },
  } as unknown as IngestionStore;
  return { store, snapshots, revisions, updates };
}

function fetcher(data: unknown) {
  const urls: string[] = [];
  return {
    urls,
    getJson(url: string) {
      urls.push(url);
      return Promise.resolve(url.includes('getMetaInfo') ? META : data);
    },
  };
}

const at = (iso: string) => () => new Date(iso);

describe('ingestJpCpiValues', () => {
  it('publishes the national all-items YoY once it is on e-Stat (VERIFIED, source and URL without the appId)', async () => {
    const { store, snapshots, updates } = setup();
    const f = fetcher(statsData('2.3'));
    const counters = new JobCounters();
    const r = await ingestJpCpiValues(
      { store, fetcher: f, appId: APP_ID, schedule: SCHEDULE, now: at('2026-11-20T03:00:00Z') },
      counters,
    );
    expect(r.published).toBe(1);
    expect(snapshots[0]).toMatchObject({
      event_id: 'ev',
      actual: 2.3,
      forecast: null,
      previous: null,
      unit: '%',
      source: JP_CPI_SOURCE_NAME,
      source_url: 'https://www.e-stat.go.jp/dbview?sid=0004052037',
      verification_status: 'VERIFIED',
      verification_source: 'estat:0004052037:0001@2026-10',
    });
    expect(JSON.stringify(snapshots)).not.toContain(APP_ID);
    expect(updates).toEqual([{ id: 'ev', patch: { status: 'RELEASED', data_status: 'AVAILABLE' } }]);
    expect(f.urls[1]).toContain('cdTime=2026001010');
  });

  it('before the release time: nothing is asked or written', async () => {
    const { store, snapshots } = setup();
    const f = fetcher(statsData('2.3'));
    const r = await ingestJpCpiValues(
      { store, fetcher: f, appId: APP_ID, schedule: SCHEDULE, now: at('2026-11-19T23:00:00Z') },
      new JobCounters(),
    );
    expect(r.published).toBe(0);
    expect(f.urls).toEqual([]);
    expect(snapshots).toEqual([]);
  });

  it('not yet on e-Stat (no value, or the table was last updated before the release day): stays pending', async () => {
    for (const data of [statsData(null), statsData('2.3', '2026-10-30'), statsData('-')]) {
      const { store, snapshots } = setup();
      const counters = new JobCounters();
      const r = await ingestJpCpiValues(
        { store, fetcher: fetcher(data), appId: APP_ID, schedule: SCHEDULE, now: at('2026-11-21T00:00:00Z') },
        counters,
      );
      expect(r).toMatchObject({ published: 0, pending: 1 });
      expect(snapshots).toEqual([]);
      expect(counters.skipReasons).toMatchObject({ NOT_YET_AVAILABLE: 1 });
    }
  });

  it('more than 14 days after the release: not saved as the first release', async () => {
    const { store, snapshots } = setup();
    const counters = new JobCounters();
    await ingestJpCpiValues(
      { store, fetcher: fetcher(statsData('2.3')), appId: APP_ID, schedule: SCHEDULE, now: at('2026-12-05T00:00:00Z') },
      counters,
    );
    expect(snapshots).toEqual([]);
    expect(counters.skipReasons).toMatchObject({ TOO_LATE_FOR_FIRST_RELEASE: 1 });
  });

  it('released: a changed value is a revision (first value kept); the same value is not recorded again', async () => {
    const changed = setup({ status: 'RELEASED', snapshotActual: 2.3 });
    await ingestJpCpiValues(
      {
        store: changed.store,
        fetcher: fetcher(statsData('2.4')),
        appId: APP_ID,
        schedule: SCHEDULE,
        now: at('2026-11-25T00:00:00Z'),
      },
      new JobCounters(),
    );
    expect(changed.revisions).toMatchObject([{ event_id: 'ev', field_name: 'ACTUAL', old_value: 2.3, new_value: 2.4 }]);
    expect(changed.snapshots).toEqual([]);
    const same = setup({ status: 'RELEASED', snapshotActual: 2.3 });
    await ingestJpCpiValues(
      {
        store: same.store,
        fetcher: fetcher(statsData('2.3')),
        appId: APP_ID,
        schedule: SCHEDULE,
        now: at('2026-11-25T00:00:00Z'),
      },
      new JobCounters(),
    );
    expect(same.revisions).toEqual([]);
  });

  it('dry-run returns the plan and writes nothing', async () => {
    const { store, snapshots, updates } = setup();
    const r = await ingestJpCpiValues(
      {
        store,
        fetcher: fetcher(statsData('2.3')),
        appId: APP_ID,
        schedule: SCHEDULE,
        now: at('2026-11-20T03:00:00Z'),
        dryRun: true,
      },
      new JobCounters(),
    );
    expect(r.plan).toEqual([
      {
        event_id: 'ev',
        reference_period: '2026-10',
        release_date: '2026-11-20',
        action: 'PUBLISH',
        value: 2.3,
        table_updated: '2026-11-20',
      },
    ]);
    expect(snapshots).toEqual([]);
    expect(updates).toEqual([]);
  });

  // 実行の種別と終了コード(HQ 判断 2026-11-19: JP CPI は選択肢 2)。ジョブ(src/jobs/ingestJpCpiValues.ts)と同じ判定:
  //   dry-run  : counters.errors > 0 → 終了コード 1
  //   書き込み : runIngestionJob の status が SUCCESS 以外 → 終了コード 1
  const dryRunExit = (c: JobCounters) => (c.errors > 0 ? 1 : 0);
  const writeExit = (c: JobCounters) => (resolveJobStatus(c, false) === 'SUCCESS' ? 0 : 1);
  const failingFetcher = {
    getJson: (url: string) => Promise.reject(new Error(`estat: request failed (${url})`)),
  };
  const run = async (opts: {
    dryRun?: boolean;
    failOnFetchError?: boolean;
    fetcher?: { getJson: (u: string) => Promise<unknown> };
  }) => {
    const { store, snapshots } = setup();
    const counters = new JobCounters();
    await ingestJpCpiValues(
      {
        store,
        fetcher: opts.fetcher ?? failingFetcher,
        appId: APP_ID,
        schedule: SCHEDULE,
        now: at('2026-11-20T03:00:00Z'),
        ...(opts.dryRun ? { dryRun: true } : {}),
        ...(opts.failOnFetchError ? { failOnFetchError: true } : {}),
      },
      counters,
    );
    return { counters, snapshots };
  };

  describe('exit code on a fetch failure depends on the run type (scheduled = 1; manual dry-run / manual write = unchanged)', () => {
    it('1. scheduled run (--scheduled): a fetch failure is a failure — exit code 1; nothing is written; appId never shown', async () => {
      const { counters, snapshots } = await run({ failOnFetchError: true });
      expect(snapshots).toEqual([]);
      expect(JSON.stringify(counters.details)).not.toContain(APP_ID);
      expect(counters.errors).toBe(1);
      expect(writeExit(counters)).toBe(1);
      expect(counters.fetchAttempted).toBe(1);
      expect(counters.fetchFailed).toBe(1);
    });

    it('1b. scheduled run: a failure of the statistics data alone (metadata fetched) is also a failure; both fetches are counted', async () => {
      let calls = 0;
      const ok = fetcher(statsData('2.3'));
      const metaThenFail = {
        getJson: (url: string) =>
          ++calls === 1 ? ok.getJson(url) : Promise.reject(new Error('estat: request failed')),
      };
      const { counters, snapshots } = await run({ failOnFetchError: true, fetcher: metaThenFail });
      expect(snapshots).toEqual([]);
      expect(writeExit(counters)).toBe(1);
      expect(counters.fetchAttempted).toBe(2);
      expect(counters.fetchFailed).toBe(1);
    });

    it('2. manual dry-run: a fetch failure keeps the previous behaviour — exit code 0 (only the skip is recorded)', async () => {
      const { counters, snapshots } = await run({ dryRun: true });
      expect(snapshots).toEqual([]);
      expect(counters.skipReasons).toMatchObject({ FETCH_FAILED: 1 });
      expect(counters.errors).toBe(0);
      expect(dryRunExit(counters)).toBe(0);
    });

    it('3. manual write: a fetch failure keeps the previous behaviour — status SUCCESS, exit code 0; nothing is written', async () => {
      const { counters, snapshots } = await run({});
      expect(snapshots).toEqual([]);
      expect(counters.skipReasons).toMatchObject({ FETCH_FAILED: 1 });
      expect(counters.errors).toBe(0);
      expect(resolveJobStatus(counters, false)).toBe('SUCCESS');
      expect(writeExit(counters)).toBe(0);
      expect(JSON.stringify(counters.details)).not.toContain(APP_ID);
    });

    it('4. a successful fetch is unchanged by the flag: same published value, no error, exit code 0 (scheduled and manual alike)', async () => {
      const okFetcher = fetcher(statsData('2.3'));
      const manual = await run({ fetcher: okFetcher });
      const scheduled = await run({ fetcher: okFetcher, failOnFetchError: true });
      for (const r of [manual, scheduled]) {
        expect(r.counters.errors).toBe(0);
        expect(writeExit(r.counters)).toBe(0);
      }
      expect(scheduled.snapshots).toEqual(manual.snapshots);
      expect(manual.snapshots).toHaveLength(1);
    });

    it('other failures that are not a fetch failure (e.g. the metadata classes not found) still fail in manual runs, as before', async () => {
      const noClasses = {
        getJson: () => Promise.resolve({ GET_META_INFO: { METADATA_INF: { CLASS_INF: { CLASS_OBJ: [] } } } }),
      };
      const { counters } = await run({ fetcher: noClasses });
      expect(counters.errors).toBe(1);
      expect(writeExit(counters)).toBe(1);
    });
  });

  describe('the job wires the flag to --scheduled only (never to a manual run)', () => {
    const jobSource = readFileSync(join(__dirname, '../../src/jobs/ingestJpCpiValues.ts'), 'utf8');

    it('`scheduled` needs the --scheduled argument and is never true for a dry run; only the write path passes it', () => {
      expect(jobSource).toContain("const scheduled = process.argv.includes('--scheduled') && !dryRun;");
      expect(jobSource).toContain('failOnFetchError: scheduled');
      // dry-run の呼び出しは、failOnFetchError を渡さない(従来どおり)
      const dryCall = jobSource.slice(
        jobSource.indexOf('if (dryRun) {'),
        jobSource.indexOf('const result = await runIngestionJob'),
      );
      expect(dryCall).not.toContain('failOnFetchError');
    });
  });

  it('nothing due (before the release): no fetch, no error — a normal no-op', async () => {
    const { store } = setup();
    const counters = new JobCounters();
    const never = { getJson: () => Promise.reject(new Error('must not be called')) };
    await ingestJpCpiValues(
      { store, fetcher: never, appId: APP_ID, schedule: SCHEDULE, now: at('2026-11-19T12:00:00Z') },
      counters,
    );
    expect(counters.errors).toBe(0);
    expect(counters.fetchAttempted).toBe(0);
  });

  it('the HTTP client redacts appId in URLs it puts in error messages', () => {
    expect(
      redactUrl(`https://api.e-stat.go.jp/rest/3.0/app/json/getMetaInfo?appId=${APP_ID}&statsDataId=1`),
    ).not.toContain(APP_ID);
  });
});
