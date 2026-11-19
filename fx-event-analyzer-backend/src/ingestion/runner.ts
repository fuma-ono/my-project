/**
 * Job runner: wraps one fetch → normalize → validate → upsert run and
 * always records an ingestion_logs row (provider, job, started/finished,
 * counts, errors) — also when the job throws. Error messages are stored
 * as-is, so anything that may contain a URL must already be redacted
 * (HttpClient errors are).
 */
import type { IngestionLogRow, IngestionStore } from './store.js';

/** 1 つの指標の、1 回の実行での発表日の取得の結果。 */
export interface ReleaseFetchStat {
  attempted: number;
  ok: number;
  not_found: number;
  failed: number;
}

export class JobCounters {
  fetched = 0;
  success = 0;
  errors = 0;
  skipped = 0;
  review = 0;
  readonly errorMessages: string[] = [];
  readonly skipReasons: Record<string, number> = {};
  readonly details: Record<string, unknown> = {};
  /** 外部への取得の試行の数と、そのうち失敗した数(HQ指示 2026-11-19)。取得対象が無く、1回も試みなかった実行は 0。 */
  fetchAttempted = 0;
  /** 404(未公表・日付不一致)。失敗には数えない(正常な待ち)が、件数は記録する。 */
  fetchNotFound = 0;
  /** 404 以外の取得の失敗。判定(全件失敗=失敗・一部=警告)の対象はこちら。 */
  fetchFailed = 0;
  /**
   * 指標ごとの、発表日の取得(releaseRequest)の結果(HQ 判断 2026-11-19: 継続障害の判定の材料)。
   * attempted = 試行、ok = 成功、not_found = 404(失敗に数えない)、failed = 404 以外の失敗。ingestion_logs.details.release_fetch に残る。
   */
  readonly releaseFetch: Record<string, ReleaseFetchStat> = {};

  /** 発表日の取得を 1 回試みた結果を、指標ごとに記録する。 */
  releaseFetchResult(indicatorCode: string, kind: 'ok' | 'not_found' | 'failed'): void {
    const stat = (this.releaseFetch[indicatorCode] ??= { attempted: 0, ok: 0, not_found: 0, failed: 0 });
    stat.attempted += 1;
    stat[kind] += 1;
  }

  skip(reason: string): void {
    this.skipped += 1;
    this.skipReasons[reason] = (this.skipReasons[reason] ?? 0) + 1;
  }

  /** 外部への取得を1回試みた結果を記録する(ok = false なら 404 以外の失敗)。 */
  fetchResult(ok: boolean): void {
    this.fetchAttempted += 1;
    if (!ok) this.fetchFailed += 1;
  }

  error(message: string): void {
    this.errors += 1;
    if (this.errorMessages.length < 20) this.errorMessages.push(message);
  }

  /** Appends to a list in details (capped, for the log). */
  note(key: string, value: unknown): void {
    const list = (this.details[key] as unknown[] | undefined) ?? [];
    if (list.length < 50) list.push(value);
    this.details[key] = list;
  }
}

export interface JobSpec {
  provider: string;
  dataType: IngestionLogRow['data_type'];
  job: string;
}

export interface JobResult {
  status: IngestionLogRow['status'];
  counters: JobCounters;
}

export function resolveJobStatus(counters: JobCounters, crashed: boolean): IngestionLogRow['status'] {
  if (crashed) return counters.success > 0 ? 'PARTIAL' : 'FAILURE';
  if (counters.errors === 0) return 'SUCCESS';
  return counters.success > 0 ? 'PARTIAL' : 'FAILURE';
}

function message(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

export async function runIngestionJob(
  store: IngestionStore,
  spec: JobSpec,
  body: (counters: JobCounters) => Promise<void>,
  now: () => Date = () => new Date(),
): Promise<JobResult> {
  const counters = new JobCounters();
  const startedAt = now().toISOString();
  let crashed = false;
  try {
    await body(counters);
  } catch (error) {
    crashed = true;
    counters.error(message(error));
  }
  const status = resolveJobStatus(counters, crashed);
  await store.insertIngestionLog({
    provider: spec.provider,
    data_type: spec.dataType,
    job: spec.job,
    started_at: startedAt,
    completed_at: now().toISOString(),
    status,
    fetched_count: counters.fetched,
    success_count: counters.success,
    error_count: counters.errors,
    skipped_count: counters.skipped,
    review_count: counters.review,
    error_message: counters.errorMessages.length > 0 ? counters.errorMessages.join('\n') : null,
    details: {
      skip_reasons: counters.skipReasons,
      ...counters.details,
      // 発表日の取得を試みた実行だけ、指標ごとの結果を残す(継続障害の判定の履歴。定時実行の判定は releaseFetchStreak.ts)
      ...(Object.keys(counters.releaseFetch).length > 0 ? { release_fetch: counters.releaseFetch } : {}),
      // 取得を試みた実行だけ、試行数と失敗数を残す(取得対象なしの正常な実行と、全件失敗を、後から区別できるように)
      ...(counters.fetchAttempted > 0
        ? {
            fetch_attempted: counters.fetchAttempted,
            fetch_not_found: counters.fetchNotFound,
            fetch_failed: counters.fetchFailed,
          }
        : {}),
    },
  });
  return { status, counters };
}

export type FetchOutcome = 'NO_FETCH' | 'OK' | 'PARTIAL_FAILURE' | 'ALL_FAILED';

/**
 * 外部の取得の結果の判定(HQ指示 2026-11-19):
 *  - NO_FETCH: 取得を1回も試みなかった(窓の中に処理する発表が無い)。**正常な no-op。失敗にしない**
 *  - OK: すべて成功
 *  - PARTIAL_FAILURE: 一部の取得が失敗。実行は成功(緑)のまま、警告を出す(次の回が取り直す)
 *  - ALL_FAILED: 試みた取得がすべて失敗。実行を失敗(赤)にする
 */
export function judgeFetchOutcome(attempted: number, failed: number): FetchOutcome {
  if (attempted <= 0) return 'NO_FETCH';
  if (failed <= 0) return 'OK';
  return failed >= attempted ? 'ALL_FAILED' : 'PARTIAL_FAILURE';
}

/**
 * 実行の終わりに呼ぶ。全件失敗なら、failOnAllFailed(定時実行だけ true)のときに限り、エラーとして記録する(実行は FAILURE になり、終了コード 1)。一部失敗なら、GitHub の警告の
 * 注釈の文を返す(呼び出し側が出す)。それ以外は null。
 */
export function applyFetchOutcome(counters: JobCounters, label: string, failOnAllFailed = false): string | null {
  const outcome = judgeFetchOutcome(counters.fetchAttempted, counters.fetchFailed);
  if (outcome === 'ALL_FAILED') {
    // 全件失敗を実行の失敗(赤)にするのは、定時実行(failOnAllFailed = true)だけ。手動の実行は従来どおり(失敗にしない。件数は details に残る)
    if (failOnAllFailed) counters.error(`${label}: all ${counters.fetchAttempted} fetch(es) failed`);
    return null;
  }
  if (outcome === 'PARTIAL_FAILURE')
    return `${label}: ${counters.fetchFailed} of ${counters.fetchAttempted} fetches failed (the next run retries)`;
  return null;
}
