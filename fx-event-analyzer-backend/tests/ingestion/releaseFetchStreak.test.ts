/**
 * official-values の発表日の取得(releaseRequest)の、継続障害の判定(HQ 判断 2026-11-19、案 C)のテスト。
 *   K = 3 回連続・指標ごと・定時実行だけ。手動実行・dry-run は対象外。404 は失敗に数えない。
 * ジョブ(src/jobs/ingestOfficialValues.ts)と同じ手順を、メモリの store で再現して、実行を何回か重ねる。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HttpError } from '../../src/ingestion/http.js';
import type { OfficialScheduleTable } from '../../src/ingestion/mappings/gbAuCaSchedule.js';
import { ingestOfficialValues, OFFICIAL_VALUE_SOURCES } from '../../src/ingestion/pipelines/officialValues.js';
import {
  applyReleaseFetchStreak,
  CONSECUTIVE_RELEASE_FAILURE_THRESHOLD,
  consecutiveFailures,
  isFailingRun,
  newestFirst,
  readReleaseFetch,
} from '../../src/ingestion/releaseFetchStreak.js';
import { runOfficialValues } from '../../src/ingestion/officialValuesRun.js';
import { JobCounters, runIngestionJob } from '../../src/ingestion/runner.js';
import { createIngestionRepository } from '../../src/repositories/ingestionRepository.js';
import { fakeSupabaseClient } from '../helpers/fakeSupabaseClient.js';
import { MemoryIngestionStore } from '../helpers/memoryIngestionStore.js';

const K = CONSECUTIVE_RELEASE_FAILURE_THRESHOLD;
const CPI = 'AU_CPI';
const UNEMP = 'AU_UNEMPLOYMENT_RATE';
const sources = OFFICIAL_VALUE_SOURCES.filter((s) => s.indicatorCode === CPI || s.indicatorCode === UNEMP);
const entry = (indicatorCode: string) => ({
  indicatorCode,
  key: '2026-10',
  referencePeriod: '2026-10',
  releaseDate: '2026-11-18',
  time: '11:30',
  timeZone: 'Australia/Sydney',
  sources: ['x'],
  checkedAt: '2026-11-10',
});
const table: OfficialScheduleTable = { provider: 'abs_release_calendar', entries: [entry(CPI), entry(UNEMP)] };
const source = (code: string) => sources.find((s) => s.indicatorCode === code)!;
const releaseUrl = (code: string) => source(code).releaseRequest!(entry(code))!.url;
const DUE = new Date('2026-11-18T09:00:00Z'); // 公表の後(取得を試みる)
const NOT_DUE = new Date('2026-11-17T12:00:00Z'); // 公表の前(取得を試みない)

class Fetcher {
  failing = new Set<string>();
  notFound = new Set<string>();
  calls: string[] = [];
  getJson(url: string): Promise<unknown> {
    this.calls.push(url);
    if (this.notFound.has(url)) return Promise.reject(new HttpError('HTTP 404', 404, false));
    if (this.failing.has(url)) return Promise.reject(new Error('HTTP 503'));
    return Promise.resolve({});
  }
}

function makeStore() {
  const store = new MemoryIngestionStore();
  store.indicators = [
    { id: 'ind-cpi', code: CPI, importance: 'HIGH', favorable_direction: 'HIGHER_IS_POSITIVE' },
    { id: 'ind-un', code: UNEMP, importance: 'MEDIUM', favorable_direction: 'LOWER_IS_POSITIVE' },
  ];
  store.events = [CPI, UNEMP].map((code, i) => ({
    id: `ev-${i}`,
    indicator_id: i === 0 ? 'ind-cpi' : 'ind-un',
    provider: 'abs_release_calendar',
    provider_event_id: `abs_release_calendar:${code}:2026-10`,
    importance: 'HIGH',
    release_datetime: '2026-11-18T00:30:00.000Z',
    release_datetime_precision: 'EXACT',
    status: 'SCHEDULED',
    data_status: 'PENDING',
  }));
  return store;
}

type Mode = 'scheduled' | 'manual' | 'dry-run';
let clock = 0;
const nextStart = () => new Date(Date.UTC(2026, 10, 18, 0, 0, 0) + ++clock * 3_600_000);

/** ジョブ(ingestOfficialValues.ts)と同じ手順。dry-run はログを書かず、新しい判定を呼ばない。 */
async function jobRun(
  store: MemoryIngestionStore,
  fetcher: Fetcher,
  mode: Mode,
  opts: { due?: Date; ingest?: typeof ingestOfficialValues } = {},
): Promise<{ status: string; exit: number; counters: JobCounters; historyWarning: string | null }> {
  const pipelineNow = opts.due ?? DUE;
  if (mode === 'dry-run') {
    const counters = new JobCounters();
    await ingestOfficialValues(
      { store, fetcher, sources, tables: [table], now: () => pipelineNow, dryRun: true },
      counters,
    );
    return { status: 'DRY_RUN', exit: counters.errors > 0 ? 1 : 0, counters, historyWarning: null };
  }
  const scheduled = mode === 'scheduled';
  let historyWarning: string | null = null;
  const result = await runIngestionJob(
    store,
    { provider: 'official_values', dataType: 'ECONOMIC_EVENT', job: 'ingest:official-values' },
    async (counters) => {
      // ジョブの本体(src/ingestion/officialValuesRun.ts)そのもの。取り込みだけを、テスト用の設定(指標・時刻)で差し替える
      const ran = await runOfficialValues(counters, {
        store,
        fetcher,
        tables: [table],
        scheduled,
        ingest: opts.ingest ?? ((deps, c) => ingestOfficialValues({ ...deps, sources, now: () => pipelineNow }, c)),
      });
      historyWarning = ran.historyWarning;
    },
    nextStart,
  );
  return {
    status: result.status,
    exit: result.status === 'SUCCESS' ? 0 : 1,
    counters: result.counters,
    historyWarning,
  };
}

describe('pure helpers', () => {
  it('isFailingRun: attempted, a non-404 failure, and zero successes', () => {
    expect(isFailingRun(undefined)).toBe(false);
    expect(isFailingRun({ attempted: 0, ok: 0, not_found: 0, failed: 0 })).toBe(false);
    expect(isFailingRun({ attempted: 1, ok: 0, not_found: 0, failed: 1 })).toBe(true);
    expect(isFailingRun({ attempted: 2, ok: 0, not_found: 1, failed: 1 })).toBe(true); // 404 が混ざっても、404 以外の失敗があり成功 0
    expect(isFailingRun({ attempted: 2, ok: 1, not_found: 0, failed: 1 })).toBe(false); // 成功が 1 件でもあれば、失敗の回ではない
    expect(isFailingRun({ attempted: 1, ok: 0, not_found: 1, failed: 0 })).toBe(false); // 404 だけ
  });

  it('readReleaseFetch tolerates a missing or malformed history record (never counted as a failure)', () => {
    expect(readReleaseFetch({}, CPI)).toBeUndefined();
    expect(readReleaseFetch({ release_fetch: 'x' }, CPI)).toBeUndefined();
    expect(readReleaseFetch({ release_fetch: { [CPI]: 5 } }, CPI)).toBeUndefined();
    expect(isFailingRun(readReleaseFetch({ release_fetch: { [CPI]: { attempted: 'a', failed: 'b' } } }, CPI))).toBe(
      false,
    );
  });

  it('consecutiveFailures counts only scheduled history rows and stops at the first non-failing one (manual / untyped rows are skipped)', () => {
    const fail = { release_fetch: { [CPI]: { attempted: 1, ok: 0, not_found: 0, failed: 1 } } };
    const ok = { release_fetch: { [CPI]: { attempted: 1, ok: 1, not_found: 0, failed: 0 } } };
    const cur = { attempted: 1, ok: 0, not_found: 0, failed: 1 };
    expect(consecutiveFailures(CPI, cur, [])).toBe(1);
    expect(consecutiveFailures(CPI, cur, [{ details: { run_type: 'scheduled', ...fail } }])).toBe(2);
    expect(
      consecutiveFailures(CPI, cur, [
        { details: { run_type: 'manual', ...ok } },
        { details: { run_type: 'scheduled', ...fail } },
      ]),
    ).toBe(2);
    expect(
      consecutiveFailures(CPI, cur, [{ details: { ...ok } }, { details: { run_type: 'scheduled', ...fail } }]),
    ).toBe(2); // 種別なしは無視
    expect(
      consecutiveFailures(CPI, cur, [
        { details: { run_type: 'scheduled', ...ok } },
        { details: { run_type: 'scheduled', ...fail } },
      ]),
    ).toBe(1);
    expect(
      consecutiveFailures(CPI, { attempted: 1, ok: 1, not_found: 0, failed: 0 }, [
        { details: { run_type: 'scheduled', ...fail } },
      ]),
    ).toBe(0);
  });

  it('the threshold is K = 3 (HQ 確定)', () => {
    expect(K).toBe(3);
  });
});

describe('consecutive release-fetch failures (scheduled runs, per indicator)', () => {
  const failRelease = (f: Fetcher, code = CPI) => f.failing.add(releaseUrl(code));
  const fresh = () => ({ store: makeStore(), fetcher: new Fetcher() });

  it('K-1 consecutive failures do not fail the run (a warning-level partial failure only)', async () => {
    const { store, fetcher } = fresh();
    failRelease(fetcher);
    for (let i = 1; i < K; i++) {
      const r = await jobRun(store, fetcher, 'scheduled');
      expect(r.status, `run ${i}`).toBe('SUCCESS');
      expect(r.exit).toBe(0);
    }
  });

  it('K consecutive failures fail the run (exit code 1) and name the indicator, the count and the threshold', async () => {
    const { store, fetcher } = fresh();
    failRelease(fetcher);
    let last = await jobRun(store, fetcher, 'scheduled');
    for (let i = 2; i <= K; i++) last = await jobRun(store, fetcher, 'scheduled');
    expect(last.status).not.toBe('SUCCESS');
    expect(last.exit).toBe(1);
    expect(last.counters.errorMessages.join()).toContain(
      `${CPI}: the release fetch failed in ${K} consecutive scheduled runs (threshold ${K})`,
    );
    expect(last.counters.details.release_fetch_streak).toEqual({ [CPI]: K });
    expect(store.snapshots).toEqual([]); // 何も書かない
  });

  it('the failing run keeps failing while the outage continues (K+1)', async () => {
    const { store, fetcher } = fresh();
    failRelease(fetcher);
    for (let i = 0; i < K; i++) await jobRun(store, fetcher, 'scheduled');
    expect((await jobRun(store, fetcher, 'scheduled')).exit).toBe(1);
  });

  it('a success resets the count (fail, fail, success, fail → no failure; then it takes K again)', async () => {
    const { store, fetcher } = fresh();
    failRelease(fetcher);
    await jobRun(store, fetcher, 'scheduled');
    await jobRun(store, fetcher, 'scheduled');
    fetcher.failing.clear(); // 成功(取得できる)
    expect((await jobRun(store, fetcher, 'scheduled')).exit).toBe(0);
    failRelease(fetcher);
    for (let i = 1; i < K; i++) expect((await jobRun(store, fetcher, 'scheduled')).exit, `after reset ${i}`).toBe(0);
    expect((await jobRun(store, fetcher, 'scheduled')).exit).toBe(1);
  });

  it('a 404-only run resets the count (404 is not a failure and is not a failing run)', async () => {
    const { store, fetcher } = fresh();
    failRelease(fetcher);
    await jobRun(store, fetcher, 'scheduled');
    await jobRun(store, fetcher, 'scheduled');
    fetcher.failing.clear();
    fetcher.notFound.add(releaseUrl(CPI));
    const r404 = await jobRun(store, fetcher, 'scheduled');
    expect(r404.exit).toBe(0);
    expect(r404.counters.releaseFetch[CPI]).toMatchObject({ not_found: 1, failed: 0 });
    fetcher.notFound.clear();
    failRelease(fetcher);
    expect((await jobRun(store, fetcher, 'scheduled')).exit).toBe(0); // 連続は 1 から数え直し
  });

  it('a run with no release fetch attempt resets the count', async () => {
    const { store, fetcher } = fresh();
    failRelease(fetcher);
    await jobRun(store, fetcher, 'scheduled');
    await jobRun(store, fetcher, 'scheduled');
    const idle = await jobRun(store, fetcher, 'scheduled', { due: NOT_DUE }); // 公表の前: 取得を試みない
    expect(idle.counters.fetchAttempted).toBe(0);
    expect(idle.exit).toBe(0);
    expect((await jobRun(store, fetcher, 'scheduled')).exit).toBe(0); // 1 回目からやり直し
    expect((await jobRun(store, fetcher, 'scheduled')).exit).toBe(0);
    expect((await jobRun(store, fetcher, 'scheduled')).exit).toBe(1);
  });

  it('histories are separate per indicator: only the indicator that failed K times in a row fails the run', async () => {
    const { store, fetcher } = fresh();
    failRelease(fetcher, CPI);
    await jobRun(store, fetcher, 'scheduled');
    await jobRun(store, fetcher, 'scheduled');
    // 3 回目: CPI は失敗が続き、UNEMP は(今回初めて)失敗
    failRelease(fetcher, UNEMP);
    const r = await jobRun(store, fetcher, 'scheduled');
    expect(r.exit).toBe(1);
    const messages = r.counters.errorMessages.join();
    expect(messages).toContain(CPI);
    expect(messages).not.toContain(`${UNEMP}: the release fetch failed`);
    expect(r.counters.details.release_fetch_streak).toEqual({ [CPI]: K, [UNEMP]: 1 });
  });

  it('a failure of indicator A is not reset by a success of indicator B (and vice versa)', async () => {
    const { store, fetcher } = fresh();
    failRelease(fetcher, CPI); // CPI は失敗し続け、UNEMP は毎回成功
    for (let i = 1; i < K; i++) expect((await jobRun(store, fetcher, 'scheduled')).exit).toBe(0);
    const r = await jobRun(store, fetcher, 'scheduled');
    expect(r.exit).toBe(1);
    expect(r.counters.releaseFetch[UNEMP]).toMatchObject({ ok: 1, failed: 0 });
  });

  it('manual runs are outside the judgement: neither counted nor resetting, and never failed by it', async () => {
    const { store, fetcher } = fresh();
    failRelease(fetcher);
    for (let i = 0; i < K + 2; i++) {
      const m = await jobRun(store, fetcher, 'manual');
      expect(m.exit, `manual ${i}`).toBe(0);
      expect(m.counters.details.release_fetch_streak).toBeUndefined();
    }
    // 定時 2 回(K-1)の間に、成功する手動実行が挟まっても、連続は途切れず、数えもしない
    const { store: s2, fetcher: f2 } = fresh();
    failRelease(f2);
    await jobRun(s2, f2, 'scheduled');
    f2.failing.clear();
    await jobRun(s2, f2, 'manual'); // 手動の成功は、連続をリセットしない
    failRelease(f2);
    await jobRun(s2, f2, 'scheduled');
    expect((await jobRun(s2, f2, 'scheduled')).exit).toBe(1); // 定時だけ数えて 3 回目
  });

  it('manual runs record run_type = manual and the per-indicator results in the log', async () => {
    const { store, fetcher } = fresh();
    failRelease(fetcher);
    await jobRun(store, fetcher, 'manual');
    expect(store.logs.at(-1)!.details).toMatchObject({
      run_type: 'manual',
      release_fetch: { [CPI]: { attempted: 1, ok: 0, not_found: 0, failed: 1 }, [UNEMP]: { attempted: 1, ok: 1 } },
    });
  });

  it('dry-run never applies the new judgement and writes no log', async () => {
    const { store, fetcher } = fresh();
    failRelease(fetcher);
    for (let i = 0; i < K + 1; i++) {
      const r = await jobRun(store, fetcher, 'dry-run');
      expect(r.exit).toBe(0);
      expect(r.counters.errors).toBe(0);
    }
    expect(store.logs).toEqual([]);
  });

  it('a history read error does not stop the ingestion: the run continues, a warning is returned and recorded', async () => {
    const { store, fetcher } = fresh();
    failRelease(fetcher);
    store.listRecentIngestionLogs = () => Promise.reject(new Error('boom'));
    const r = await jobRun(store, fetcher, 'scheduled');
    expect(r.status).toBe('SUCCESS');
    expect(r.exit).toBe(0);
    expect(r.historyWarning).toContain('could not read the run history');
    expect(r.historyWarning).toContain('boom');
    expect(r.counters.details.release_fetch_history_warning).toBe(r.historyWarning);
    expect(r.counters.fetchAttempted).toBeGreaterThan(0); // 取り込みは行われた
  });

  it('a store that does not implement the optional history method also continues with a warning (existing implementations keep working)', async () => {
    const { store, fetcher } = fresh();
    failRelease(fetcher);
    (store as { listRecentIngestionLogs?: unknown }).listRecentIngestionLogs = undefined;
    const r = await jobRun(store, fetcher, 'scheduled');
    expect(r.exit).toBe(0);
    expect(r.historyWarning).toContain('not implemented');
  });

  it('the history is not read at all when no indicator had a failing run (no extra DB read on normal runs)', async () => {
    const { store, fetcher } = fresh();
    let reads = 0;
    store.listRecentIngestionLogs = () => {
      reads += 1;
      return Promise.resolve([]);
    };
    await jobRun(store, fetcher, 'scheduled');
    expect(reads).toBe(0);
  });
});

describe('what is saved on a normal fetch does not change', () => {
  it('scheduled, manual and dry-run-free runs save exactly the same events / snapshots / revisions', async () => {
    const run = async (mode: Mode) => {
      const store = makeStore();
      const fetcher = new Fetcher();
      const r = await jobRun(store, fetcher, mode);
      expect(r.exit).toBe(0);
      return JSON.stringify([store.snapshots, store.revisions, store.events]);
    };
    expect(await run('scheduled')).toBe(await run('manual'));
  });

  it('the pipeline writes the same without the new bookkeeping: counters only gain release_fetch (nothing else in the saved data)', async () => {
    const store = makeStore();
    const counters = new JobCounters();
    await ingestOfficialValues({ store, fetcher: new Fetcher(), sources, tables: [table], now: () => DUE }, counters);
    expect(store.snapshots).toEqual([]);
    expect(counters.releaseFetch[CPI]).toEqual({ attempted: 1, ok: 1, not_found: 0, failed: 0 });
  });
});

describe('run_type is recorded before the ingestion starts (so a run that dies half-way is still known as scheduled / manual)', () => {
  const failRelease = (f: Fetcher, code = CPI) => f.failing.add(releaseUrl(code));
  const fresh = () => ({ store: makeStore(), fetcher: new Fetcher() });
  const boom = (): never => {
    throw new Error('crash');
  };
  /** 実際の取り込みを動かしたあとで例外にする(取得の結果は counters に残る)。 */
  const crashAfter: typeof ingestOfficialValues = async (deps, counters) => {
    await ingestOfficialValues({ ...deps, sources, now: () => DUE }, counters);
    return boom();
  };
  /** 取り込みの開始前に、例外にする。 */
  const crashBefore: typeof ingestOfficialValues = () => Promise.resolve(boom());
  /** 系列の取得だけ行って(発表日の取得は試みず)、例外にする。 */
  const crashAfterSeriesOnly: typeof ingestOfficialValues = async (deps, counters) => {
    await deps.fetcher.getJson(source(CPI).request.url);
    counters.fetchAttempted += 1;
    return boom();
  };
  const emptyResult = () => Promise.resolve({ published: 0, revisions: 0, pending: 0, plan: [] });

  it('run_type is already set when the ingestion starts', async () => {
    const { store, fetcher } = fresh();
    let seen: unknown;
    await jobRun(store, fetcher, 'scheduled', {
      ingest: (_deps, c) => {
        seen = c.details.run_type;
        return emptyResult();
      },
    });
    expect(seen).toBe('scheduled');
    await jobRun(store, fetcher, 'manual', {
      ingest: (_deps, c) => {
        seen = c.details.run_type;
        return emptyResult();
      },
    });
    expect(seen).toBe('manual');
  });

  it('1. a scheduled run that dies before the ingestion starts is still logged as scheduled, with no release_fetch (no attempt → resets the count)', async () => {
    const { store, fetcher } = fresh();
    failRelease(fetcher);
    await jobRun(store, fetcher, 'scheduled');
    await jobRun(store, fetcher, 'scheduled');
    const crashed = await jobRun(store, fetcher, 'scheduled', { ingest: crashBefore });
    expect(crashed.exit).toBe(1); // 例外は、実行の失敗
    expect(store.logs.at(-1)!.details).toMatchObject({ run_type: 'scheduled' });
    expect(store.logs.at(-1)!.details).not.toHaveProperty('release_fetch');
    // 取得を試みていない実行 → 連続はリセット。次の失敗は 1 回目から
    expect((await jobRun(store, fetcher, 'scheduled')).exit).toBe(0);
    expect((await jobRun(store, fetcher, 'scheduled')).exit).toBe(0);
    expect((await jobRun(store, fetcher, 'scheduled')).exit).toBe(1);
  });

  it('2. a scheduled run that dies after the series fetch but before any release fetch counts as "no attempt" (resets)', async () => {
    const { store, fetcher } = fresh();
    failRelease(fetcher);
    await jobRun(store, fetcher, 'scheduled');
    await jobRun(store, fetcher, 'scheduled');
    const crashed = await jobRun(store, fetcher, 'scheduled', { ingest: crashAfterSeriesOnly });
    expect(crashed.exit).toBe(1);
    expect(store.logs.at(-1)!.details).toMatchObject({ run_type: 'scheduled' });
    expect(store.logs.at(-1)!.details).not.toHaveProperty('release_fetch');
    expect((await jobRun(store, fetcher, 'scheduled')).exit).toBe(0); // 1 回目からやり直し
  });

  it('3a. a scheduled run that dies after a FAILED release fetch is recorded from the real results and counts as a failing run', async () => {
    const { store, fetcher } = fresh();
    failRelease(fetcher);
    await jobRun(store, fetcher, 'scheduled');
    await jobRun(store, fetcher, 'scheduled');
    const crashed = await jobRun(store, fetcher, 'scheduled', { ingest: crashAfter });
    expect(crashed.exit).toBe(1);
    expect(store.logs.at(-1)!.details).toMatchObject({
      run_type: 'scheduled',
      release_fetch: { [CPI]: { attempted: 1, ok: 0, not_found: 0, failed: 1 } },
    });
    // 例外の回も「取得を試み、404 以外の失敗があり、成功 0」なので、連続に数える: 次の失敗の回は 4 回目
    const next = await jobRun(store, fetcher, 'scheduled');
    expect(next.exit).toBe(1);
    expect(next.counters.details.release_fetch_streak).toEqual({ [CPI]: 4 });
  });

  it('3b. a scheduled run that dies after a SUCCESSFUL release fetch resets the count (the real result is a success)', async () => {
    const { store, fetcher } = fresh();
    failRelease(fetcher);
    await jobRun(store, fetcher, 'scheduled');
    await jobRun(store, fetcher, 'scheduled');
    fetcher.failing.clear(); // この回は取得できて、そのあとで例外
    await jobRun(store, fetcher, 'scheduled', { ingest: crashAfter });
    expect(store.logs.at(-1)!.details).toMatchObject({ release_fetch: { [CPI]: { ok: 1, failed: 0 } } });
    failRelease(fetcher);
    expect((await jobRun(store, fetcher, 'scheduled')).exit).toBe(0); // 連続は 1 から
  });

  it('3c. a scheduled run that dies after only 404s resets the count', async () => {
    const { store, fetcher } = fresh();
    failRelease(fetcher);
    await jobRun(store, fetcher, 'scheduled');
    await jobRun(store, fetcher, 'scheduled');
    fetcher.failing.clear();
    fetcher.notFound.add(releaseUrl(CPI));
    await jobRun(store, fetcher, 'scheduled', { ingest: crashAfter });
    fetcher.notFound.clear();
    failRelease(fetcher);
    expect((await jobRun(store, fetcher, 'scheduled')).exit).toBe(0);
  });

  it('4. a manual run that dies half-way neither counts nor breaks the scheduled streak (it is logged as manual)', async () => {
    const { store, fetcher } = fresh();
    failRelease(fetcher);
    await jobRun(store, fetcher, 'scheduled');
    await jobRun(store, fetcher, 'manual', { ingest: crashAfter });
    expect(store.logs.at(-1)!.details).toMatchObject({ run_type: 'manual' });
    await jobRun(store, fetcher, 'manual', { ingest: crashBefore });
    await jobRun(store, fetcher, 'scheduled');
    expect((await jobRun(store, fetcher, 'scheduled')).exit).toBe(1); // 定時だけで 3 回
  });

  it('a crashed scheduled run does not apply the streak judgement itself (the run already fails); only later runs read it from the log', async () => {
    const { store, fetcher } = fresh();
    failRelease(fetcher);
    await jobRun(store, fetcher, 'scheduled');
    await jobRun(store, fetcher, 'scheduled');
    const crashed = await jobRun(store, fetcher, 'scheduled', { ingest: crashAfter });
    expect(crashed.counters.errorMessages.join()).toContain('crash');
    expect(crashed.counters.errorMessages.join()).not.toContain('consecutive scheduled runs');
  });
});

describe('history order and old-format logs', () => {
  const fail = { attempted: 1, ok: 0, not_found: 0, failed: 1 };
  const okStat = { attempted: 1, ok: 1, not_found: 0, failed: 0 };
  const log = (started_at: string, details: Record<string, unknown>) => ({
    started_at,
    status: 'SUCCESS' as const,
    details,
  });
  const failingNow = () => {
    const c = new JobCounters();
    c.releaseFetchResult(CPI, 'failed');
    return c;
  };

  it('newestFirst sorts by started_at descending, and keeps the given order when started_at is missing', () => {
    const rows = [
      { started_at: '2026-11-18T01:00:00Z' },
      { started_at: '2026-11-18T03:00:00Z' },
      { started_at: '2026-11-18T02:00:00Z' },
    ];
    expect(newestFirst(rows).map((r) => r.started_at)).toEqual([
      '2026-11-18T03:00:00Z',
      '2026-11-18T02:00:00Z',
      '2026-11-18T01:00:00Z',
    ]);
    const noTime = [{ id: 1 }, { id: 2 }] as { started_at?: string; id: number }[];
    expect(newestFirst(noTime)).toEqual(noTime);
  });

  it('a history handed over oldest-first gives the same answer as newest-first', async () => {
    const newestOk = [
      log('2026-11-18T01:00:00Z', { run_type: 'scheduled', release_fetch: { [CPI]: fail } }),
      log('2026-11-18T02:00:00Z', { run_type: 'scheduled', release_fetch: { [CPI]: fail } }),
      log('2026-11-18T03:00:00Z', { run_type: 'scheduled', release_fetch: { [CPI]: okStat } }), // 最新は成功
    ];
    for (const order of [newestOk, [...newestOk].reverse()]) {
      const counters = failingNow();
      await applyReleaseFetchStreak(counters, { listRecentIngestionLogs: () => Promise.resolve(order) });
      expect(counters.errors).toBe(0);
      expect(counters.details.release_fetch_streak).toEqual({ [CPI]: 1 });
    }
    // 最新の 2 件が失敗なら、順序に関係なく K 回連続
    const newestFailing = [
      log('2026-11-18T01:00:00Z', { run_type: 'scheduled', release_fetch: { [CPI]: okStat } }),
      log('2026-11-18T02:00:00Z', { run_type: 'scheduled', release_fetch: { [CPI]: fail } }),
      log('2026-11-18T03:00:00Z', { run_type: 'scheduled', release_fetch: { [CPI]: fail } }),
    ];
    for (const order of [newestFailing, [...newestFailing].reverse()]) {
      const counters = failingNow();
      await applyReleaseFetchStreak(counters, { listRecentIngestionLogs: () => Promise.resolve(order) });
      expect(counters.errors).toBe(1);
    }
  });

  it('through the REAL repository (listRecentIngestionLogs): newest first, limited, only this job; old-format logs are skipped without error and never count as failures', async () => {
    const row = (job: string, started_at: string, details: unknown) => ({
      job,
      started_at,
      status: 'SUCCESS',
      details,
    });
    const client = fakeSupabaseClient({
      ingestion_logs: [
        row('ingest:official-values', '2026-11-10T00:00:00Z', null), // 旧形式(details なし)
        row('ingest:official-values', '2026-11-11T00:00:00Z', { skip_reasons: {} }), // 旧形式
        row('ingest:official-values', '2026-11-12T00:00:00Z', { fetch_attempted: 2, fetch_failed: 2 }), // 旧形式(release_fetch なし)
        row('ingest:fx-prices', '2026-11-13T00:00:00Z', { run_type: 'scheduled', release_fetch: { [CPI]: fail } }), // 別のジョブ
        row('ingest:official-values', '2026-11-14T00:00:00Z', { run_type: 'manual', release_fetch: { [CPI]: fail } }), // 手動
      ],
    });
    const repo = createIngestionRepository(client);
    const rows = await repo.listRecentIngestionLogs!('ingest:official-values', 10);
    expect(rows.map((r) => r.started_at)).toEqual([
      '2026-11-14T00:00:00.000Z',
      '2026-11-12T00:00:00.000Z',
      '2026-11-11T00:00:00.000Z',
      '2026-11-10T00:00:00.000Z',
    ]);
    expect(rows.at(-1)!.details).toEqual({}); // null は {} に
    expect((await repo.listRecentIngestionLogs!('ingest:official-values', 2)).length).toBe(2);
    const counters = failingNow();
    expect(await applyReleaseFetchStreak(counters, repo)).toBeNull();
    expect(counters.errors).toBe(0); // 旧形式・手動・別ジョブは、数えない
    expect(counters.details.release_fetch_streak).toEqual({ [CPI]: 1 });
  });

  it('through the real repository: two scheduled failing logs + a failing current run = K → fails', async () => {
    const row = (started_at: string) => ({
      job: 'ingest:official-values',
      started_at,
      status: 'SUCCESS',
      details: { run_type: 'scheduled', release_fetch: { [CPI]: fail } },
    });
    const client = fakeSupabaseClient({ ingestion_logs: [row('2026-11-17T00:00:00Z'), row('2026-11-17T06:00:00Z')] });
    const counters = failingNow();
    await applyReleaseFetchStreak(counters, createIngestionRepository(client));
    expect(counters.errors).toBe(1);
  });
});

describe('monitoring scope is documented where the logic lives (HQ 決定: ABS の発表日の取得だけ。広げない)', () => {
  const read = (rel: string) => readFileSync(join(__dirname, '../../src', rel), 'utf8');

  it('the streak module, the job body and the job all state the scope and that a missing release_fetch is not evidence of success', () => {
    for (const file of [
      'ingestion/releaseFetchStreak.ts',
      'ingestion/officialValuesRun.ts',
      'jobs/ingestOfficialValues.ts',
    ]) {
      const text = read(file);
      expect(text, file).toContain('ABS');
      expect(text, file).toContain('対象外');
      expect(text, file).toMatch(/対象の拡大は\s*HQ|HQ の別判断/);
    }
    expect(read('ingestion/releaseFetchStreak.ts')).toMatch(/正常に取得\s*\*?\s*できた証拠ではない/);
    expect(read('ingestion/officialValuesRun.ts')).toContain('正常に取得できた証拠ではない');
  });

  it('only ABS has a release fetch (releaseRequest): the monitored scope is exactly that — ONS and StatCan sources have none', () => {
    const withRelease = OFFICIAL_VALUE_SOURCES.filter((src) => src.releaseRequest !== undefined);
    expect(withRelease.length).toBeGreaterThan(0);
    for (const src of withRelease) expect(src.scheduleProvider, src.indicatorCode).toBe('abs_release_calendar');
    for (const src of OFFICIAL_VALUE_SOURCES.filter((x) => x.scheduleProvider !== 'abs_release_calendar'))
      expect(src.releaseRequest, src.indicatorCode).toBeUndefined();
  });
});

describe('the job wiring', () => {
  const job = readFileSync(join(__dirname, '../../src/jobs/ingestOfficialValues.ts'), 'utf8');

  it('the job runs the shared body with the scheduled flag; run_type and the streak judgement live in that body; the dry-run branch never reaches it', () => {
    const body = readFileSync(join(__dirname, '../../src/ingestion/officialValuesRun.ts'), 'utf8');
    expect(body).toContain("counters.details.run_type = deps.scheduled ? 'scheduled' : 'manual';");
    expect(body.indexOf('counters.details.run_type')).toBeLessThan(
      body.indexOf('await (deps.ingest ?? ingestOfficialValues)'),
    );
    expect(body).toContain('deps.scheduled ? await applyReleaseFetchStreak(counters, deps.store) : null');
    expect(job).toContain('runOfficialValues(counters, {');
    const dryBranch = job.slice(
      job.indexOf("if (process.argv.includes('--dry-run')) {"),
      job.indexOf('const result = await runIngestionJob'),
    );
    expect(dryBranch).not.toContain('applyReleaseFetchStreak');
  });

  it('the optional IngestionStore method is optional, and the repository implements it', () => {
    const storeSource = readFileSync(join(__dirname, '../../src/ingestion/store.ts'), 'utf8');
    expect(storeSource).toContain('listRecentIngestionLogs?(job: string, limit: number)');
    const repo = readFileSync(join(__dirname, '../../src/repositories/ingestionRepository.ts'), 'utf8');
    expect(repo).toContain('async listRecentIngestionLogs(job: string, limit: number)');
  });
});
