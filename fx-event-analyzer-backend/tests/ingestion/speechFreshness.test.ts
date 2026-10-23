import { describe, expect, it } from 'vitest';
import {
  buildDataQualityReport,
  judgeSpeechFetch,
  judgeSpeechFreshness,
  SPEECH_SOURCE_STALE_DAYS,
  SPEECH_SUCCESS_MAX_AGE_HOURS,
  type SpeechDbStatus,
  type SpeechRunSample,
} from '../../src/ingestion/quality/metrics.js';
import type { QualityReader } from '../../src/ingestion/quality/reader.js';
import { renderDataQualityMarkdown, renderSpeechFreshnessMarkdown } from '../../src/ingestion/quality/report.js';
import { buildQualityReportMarkdown, REPORT_END_LAG_MINUTES } from '../../src/ingestion/quality/run.js';

/** 要人発言の鮮度(HQ承認 2026-10-23、品質レポート第9章・/home speeches_status の共通判定) */

const NOW = new Date('2026-10-23T06:00:00Z');
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const ago = (ms: number): string => new Date(NOW.getTime() - ms).toISOString();

function run(overrides: Partial<SpeechRunSample> & { at?: string } = {}): SpeechRunSample {
  const { at, ...rest } = overrides;
  const started = at ?? ago(2 * HOUR);
  return {
    job: 'ingest:speeches',
    provider: 'frb_calendar',
    data_type: 'OTHER',
    started_at: started,
    completed_at: new Date(Date.parse(started) + 5_000).toISOString(),
    status: 'SUCCESS',
    fetched_count: 40,
    success_count: 6,
    error_count: 0,
    details: {
      skip_reasons: { OUTSIDE_WINDOW: 34 },
      source_latest_at: '2026-10-28T15:00:00.000Z',
      source_future_count: 3,
    },
    ...rest,
  };
}

const DB_UP_TO_DATE: SpeechDbStatus = { latestAt: '2026-10-28T15:00:00Z', futureScheduled: 3 };
const DB_EMPTY: SpeechDbStatus = { latestAt: null, futureScheduled: 0 };

describe('judgeSpeechFetch (取得の失敗。/home と第9章の共通部分)', () => {
  it('is failed with no runs at all', () => {
    expect(judgeSpeechFetch([], NOW)).toEqual({
      latest: null,
      previous: null,
      lastSuccessAt: null,
      failed: true,
      reasons: ['実行記録なし'],
    });
  });

  it('is healthy when the latest run succeeded recently with items', () => {
    const health = judgeSpeechFetch([run()], NOW);
    expect(health.failed).toBe(false);
    expect(health.lastSuccessAt).toBe(run().completed_at);
  });

  it('judges by the LATEST run: a SUCCESS followed by a FAILURE is failed', () => {
    const success = run({ at: ago(6 * HOUR) });
    const failure = run({ at: ago(1 * HOUR), status: 'FAILURE', fetched_count: 0, success_count: 0, error_count: 1 });
    // 並び順に依存しない
    for (const runs of [
      [success, failure],
      [failure, success],
    ]) {
      const health = judgeSpeechFetch(runs, NOW);
      expect(health.failed).toBe(true);
      expect(health.latest).toBe(failure);
      expect(health.previous).toBe(success);
      expect(health.lastSuccessAt).toBe(success.completed_at);
      expect(health.reasons).toEqual(['最新の実行が FAILURE', '最新の実行でエラー 1 件', '最新の実行の取得件数が 0']);
    }
  });

  it('is failed for PARTIAL, for errors, and for 0 fetched items', () => {
    expect(judgeSpeechFetch([run({ status: 'PARTIAL', error_count: 2 })], NOW).failed).toBe(true);
    expect(judgeSpeechFetch([run({ error_count: 1 })], NOW).reasons).toEqual(['最新の実行でエラー 1 件']);
    expect(judgeSpeechFetch([run({ fetched_count: 0 })], NOW).reasons).toEqual(['最新の実行の取得件数が 0']);
  });

  it(`is failed when the last SUCCESS completed ${SPEECH_SUCCESS_MAX_AGE_HOURS} hours ago or more`, () => {
    const at = (ms: number) => run({ at: ago(ms), completed_at: ago(ms) });
    expect(judgeSpeechFetch([at(SPEECH_SUCCESS_MAX_AGE_HOURS * HOUR - 60_000)], NOW).failed).toBe(false);
    expect(judgeSpeechFetch([at(SPEECH_SUCCESS_MAX_AGE_HOURS * HOUR)], NOW).reasons).toEqual([
      '最後の SUCCESS から 18 時間以上経過',
    ]);
  });

  it('is failed when there is no SUCCESS at all', () => {
    const health = judgeSpeechFetch([run({ status: 'FAILURE', error_count: 1, fetched_count: 0 })], NOW);
    expect(health.lastSuccessAt).toBeNull();
    expect(health.reasons).toContain('SUCCESS の実行記録なし');
  });
});

describe('judgeSpeechFreshness (第9章の判定と優先順位)', () => {
  it('NORMAL: fetched, the DB has the source latest, future speeches exist', () => {
    const f = judgeSpeechFreshness('frb_calendar', [run()], DB_UP_TO_DATE, NOW);
    expect(f.judgement).toBe('NORMAL');
    expect(f.judgementReasons).toEqual([]);
    expect(f.sourceLatestAt).toBe('2026-10-28T15:00:00.000Z');
    expect(f.sourceFutureCount).toBe(3);
  });

  it('FETCH_FAILED wins over everything else', () => {
    const f = judgeSpeechFreshness('frb_calendar', [run({ status: 'FAILURE', error_count: 1 })], DB_EMPTY, NOW);
    expect(f.judgement).toBe('FETCH_FAILED');
  });

  it('INGEST_GAP: the source latest (in the window) is newer than the DB latest, or the DB has none', () => {
    const behind = { latestAt: '2026-10-22T15:00:00Z', futureScheduled: 1 };
    expect(judgeSpeechFreshness('frb_calendar', [run()], behind, NOW).judgement).toBe('INGEST_GAP');
    expect(judgeSpeechFreshness('frb_calendar', [run()], DB_EMPTY, NOW).judgementReasons).toEqual([
      '取得元に取り込み期間内の予定があるが、DB にこの取得元の行が無い',
    ]);
    // 過去(期間内)の予定でも同じ
    const past = run({ details: { skip_reasons: {}, source_latest_at: ago(2 * DAY), source_future_count: 0 } });
    expect(
      judgeSpeechFreshness('frb_calendar', [past], { latestAt: ago(3 * DAY), futureScheduled: 0 }, NOW).judgement,
    ).toBe('INGEST_GAP');
  });

  it('does not report a gap for a source latest older than the 14-day window (OUTSIDE_WINDOW by spec)', () => {
    const old = run({
      details: { skip_reasons: { OUTSIDE_WINDOW: 40 }, source_latest_at: ago(15 * DAY), source_future_count: 0 },
    });
    // 15日前 ≥ 10日 → 更新なし(注意)。漏れ(異常)ではない
    expect(judgeSpeechFreshness('frb_calendar', [old], DB_EMPTY, NOW).judgement).toBe('SOURCE_NOT_UPDATED');
  });

  it(`SOURCE_NOT_UPDATED: the source latest is ${SPEECH_SOURCE_STALE_DAYS}+ days old and there is no future item`, () => {
    const withLatest = (latestMs: number, future: number) =>
      run({ details: { skip_reasons: {}, source_latest_at: ago(latestMs), source_future_count: future } });
    const db = (latestMs: number): SpeechDbStatus => ({ latestAt: ago(latestMs), futureScheduled: 0 });
    expect(judgeSpeechFreshness('frb_calendar', [withLatest(10 * DAY, 0)], db(10 * DAY), NOW).judgement).toBe(
      'SOURCE_NOT_UPDATED',
    );
    expect(
      judgeSpeechFreshness('frb_calendar', [withLatest(10 * DAY - HOUR, 0)], db(10 * DAY - HOUR), NOW).judgement,
    ).toBe('NORMAL');
    expect(judgeSpeechFreshness('frb_calendar', [withLatest(10 * DAY, 1)], db(10 * DAY), NOW).judgement).toBe('NORMAL');
  });

  it('TIME_NOT_EXACT_ONLY: every in-window item had no exact time (ECB) — no gap is reported for it', () => {
    const ecb = run({
      provider: 'ecb_press_rss',
      fetched_count: 15,
      success_count: 0,
      details: {
        skip_reasons: { OUTSIDE_WINDOW: 5, TIME_NOT_EXACT: 10 },
        source_latest_at: ago(HOUR),
        source_future_count: 0,
      },
    });
    const f = judgeSpeechFreshness('ecb_press_rss', [ecb], DB_EMPTY, NOW);
    expect(f.judgement).toBe('TIME_NOT_EXACT_ONLY');
    // 期間内の項目に時刻ありが1件でもあれば「時刻なしのみ」ではない → 漏れ
    const mixed = run({
      ...ecb,
      details: {
        skip_reasons: { OUTSIDE_WINDOW: 5, TIME_NOT_EXACT: 9 },
        source_latest_at: ago(HOUR),
        source_future_count: 0,
      },
    });
    expect(judgeSpeechFreshness('ecb_press_rss', [mixed], DB_EMPTY, NOW).judgement).toBe('INGEST_GAP');
  });

  it('a stale source (注意) is not hidden by time-not-exact (情報)', () => {
    const ecb = run({
      provider: 'ecb_press_rss',
      fetched_count: 15,
      success_count: 0,
      details: {
        skip_reasons: { OUTSIDE_WINDOW: 5, TIME_NOT_EXACT: 10 },
        source_latest_at: ago(11 * DAY),
        source_future_count: 0,
      },
    });
    expect(judgeSpeechFreshness('ecb_press_rss', [ecb], DB_EMPTY, NOW).judgement).toBe('SOURCE_NOT_UPDATED');
  });

  it('記録なし: a run without source_latest_at is not judged for gap / not-updated, but failures still apply', () => {
    const legacy = run({ details: { skip_reasons: { OUTSIDE_WINDOW: 34 } } });
    const f = judgeSpeechFreshness('frb_calendar', [legacy], DB_EMPTY, NOW);
    expect(f.sourceRecorded).toBe(false);
    expect(f.sourceLatestAt).toBeNull();
    expect(f.sourceFutureCount).toBeNull();
    expect(f.judgement).toBe('NORMAL');
    expect(
      judgeSpeechFreshness(
        'frb_calendar',
        [run({ ...legacy, at: ago(20 * HOUR), completed_at: ago(20 * HOUR) })],
        DB_EMPTY,
        NOW,
      ).judgement,
    ).toBe('FETCH_FAILED');
  });

  it('never mixes providers: each call only sees its own runs', () => {
    const frb = judgeSpeechFreshness('frb_calendar', [run()], DB_UP_TO_DATE, NOW);
    const ecb = judgeSpeechFreshness('ecb_press_rss', [], DB_EMPTY, NOW);
    expect([frb.judgement, ecb.judgement]).toEqual(['NORMAL', 'FETCH_FAILED']);
  });
});

describe('第9章 Markdown', () => {
  it('shows both providers with the judgement, the previous-run diff and 「—(記録なし)」', () => {
    const previous = run({ at: ago(14 * HOUR), fetched_count: 38 });
    const legacyEcb = run({
      provider: 'ecb_press_rss',
      fetched_count: 15,
      success_count: 0,
      details: { skip_reasons: { OUTSIDE_WINDOW: 5, TIME_NOT_EXACT: 10 } },
    });
    const markdown = renderSpeechFreshnessMarkdown([
      judgeSpeechFreshness('frb_calendar', [run(), previous], DB_UP_TO_DATE, NOW),
      judgeSpeechFreshness('ecb_press_rss', [legacyEcb], DB_EMPTY, NOW),
    ]);
    expect(markdown).toContain('## 9. 要人発言の鮮度');
    expect(markdown).toContain('| 項目 | frb_calendar | ecb_press_rss |');
    expect(markdown).toContain('| 判定 | 正常 | 時刻なしで未取り込み(情報) |');
    expect(markdown).toContain('| 取得件数 | 40(前回比 +2) | 15(前回の実行なし) |');
    expect(markdown).toContain('| 取得元の最新の予定(source_latest_at) | 2026-10-28 15:00Z | —(記録なし) |');
    expect(markdown).toContain('| 取得元の未来の予定(source_future_count) | 3 | —(記録なし) |');
    expect(markdown).toContain('| DB の最新(statement_datetime、状態問わず) | 2026-10-28 15:00Z | —(行なし) |');
  });

  it('shows 「—(実行記録なし)」 for a provider without any run', () => {
    const markdown = renderSpeechFreshnessMarkdown([judgeSpeechFreshness('ecb_press_rss', [], DB_EMPTY, NOW)]);
    expect(markdown).toContain('| 判定 | 取得の失敗(異常) |');
    expect(markdown).toContain('| 最新の実行(開始) | —(実行記録なし) |');
    expect(markdown).toContain('| 最後の SUCCESS | —(SUCCESSなし) |');
  });
});

describe('buildQualityReportMarkdown + 第9章', () => {
  const calls: string[] = [];
  const reader: QualityReader = {
    listPairs: () => Promise.resolve([]),
    listFxRows: () => Promise.resolve([]),
    firstCandleAt: () => Promise.resolve(null),
    countEconomicEvents: () => Promise.resolve(0),
    listCreditUsage: () => Promise.resolve(null),
    listReleases: () => Promise.resolve([]),
    listLogs: () => Promise.resolve([]),
    listSnapshots: () => Promise.resolve([]),
    listStaged: () => Promise.resolve([]),
    listSpeechRuns: (provider) => {
      calls.push(provider);
      return Promise.resolve(provider === 'frb_calendar' ? [run()] : []);
    },
    speechDbStatus: (provider) => Promise.resolve(provider === 'frb_calendar' ? DB_UP_TO_DATE : DB_EMPTY),
  };

  it('appends chapter 9 after the unchanged chapters 1–8, reading each provider separately', async () => {
    const markdown = await buildQualityReportMarkdown(reader, { days: 1, now: NOW });
    const nowMinute = Math.floor(NOW.getTime() / 60_000) * 60_000;
    const before = renderDataQualityMarkdown(
      buildDataQualityReport({
        now: NOW,
        period: { from: nowMinute - DAY, to: nowMinute - REPORT_END_LAG_MINUTES * 60_000 },
        days: 1,
        pairs: [],
        releases: [],
        logs: [],
        snapshots: [],
        staged: [],
        economicEventCount: 0,
        creditUsage: null,
      }),
    );
    expect(markdown.startsWith(before)).toBe(true);
    expect(markdown.slice(before.length)).toBe(
      `\n${renderSpeechFreshnessMarkdown([
        judgeSpeechFreshness('frb_calendar', [run()], DB_UP_TO_DATE, NOW),
        judgeSpeechFreshness('ecb_press_rss', [], DB_EMPTY, NOW),
      ])}`,
    );
    expect(calls).toEqual(['frb_calendar', 'ecb_press_rss']);
  });
});
