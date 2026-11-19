/**
 * official-values の「発表日の取得(releaseRequest)」の継続障害の判定(HQ 判断 2026-11-19、案 C)。
 *
 * 単発の一時的な失敗は警告のまま(取り込みは次の定時実行が取り直す)。**同じ指標で、定時実行が連続して失敗した**ときだけ、
 * 実行を失敗(終了コード 1)にする。
 *   - 閾値: K = 3 回連続(CONSECUTIVE_RELEASE_FAILURE_THRESHOLD)。判定の単位: 指標ごと。対象: 定時実行(--scheduled)だけ。
 *     手動実行・dry-run は対象外(履歴にも数えない)。
 *   - 連続失敗の 1 回分 = その実行で、その指標の発表日の取得を**実際に試み**、**404 以外の失敗があり**、かつ**成功が 0 件**だった実行。
 *   - 連続が途切れる(リセット): 成功が 1 件でもある実行 / 404 だけの実行(失敗なし) / 取得を試みなかった実行
 *     (履歴に、その指標の記録が無い実行を含む)。404 は失敗に数えない。
 *
 * 【監視の対象(HQ 決定。勝手に広げない)】現在の継続障害の検知は、**ABS(豪州)の発表日の取得(releaseRequest)だけ**が対象。
 *   ABS の系列の取得、ONS、Statistics Canada は対象外(発表日の取得を持たない)。**release_fetch の記録が無いことは、正常に取得
 *   できた証拠ではない**(対象外の取得元・取得を試みなかった実行・旧形式のログでも、記録は無い)。対象外の取得元の継続障害は、
 *   従来どおり、一部失敗の警告にとどまることがある。対象の拡大は HQ の別判断。
 *
 *   - 履歴(ingestion_logs。details.release_fetch・details.run_type)は、IngestionStore のオプショナルなメソッド
 *     listRecentIngestionLogs で読む。**読めなかったとき(未実装・エラー)は、取り込みを続け、警告だけを返す**(判定をしない)。
 */
import type { IngestionStore } from './store.js';
import type { JobCounters, ReleaseFetchStat } from './runner.js';

/** 連続の閾値 K(HQ 確定 2026-11-19)。今回を含めて、K 回連続で失敗なら、実行を失敗にする。 */
export const CONSECUTIVE_RELEASE_FAILURE_THRESHOLD = 3;
/** 履歴として読む件数の上限(手動実行が挟まっても、直近の定時実行 K − 1 件が含まれる余裕)。 */
export const RELEASE_FETCH_HISTORY_LIMIT = 30;
export const OFFICIAL_VALUES_JOB = 'ingest:official-values';

/** 連続失敗の 1 回分か(取得を試み、404 以外の失敗があり、成功が 0 件)。 */
export function isFailingRun(stat: ReleaseFetchStat | undefined): boolean {
  return stat !== undefined && stat.attempted > 0 && stat.failed > 0 && stat.ok === 0;
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** ログの details.release_fetch を読む(形が合わない要素は 0 件として扱う = 失敗に数えない)。 */
export function readReleaseFetch(
  details: Record<string, unknown>,
  indicatorCode: string,
): ReleaseFetchStat | undefined {
  const all = details.release_fetch;
  if (typeof all !== 'object' || all === null) return undefined;
  const raw = (all as Record<string, unknown>)[indicatorCode];
  if (typeof raw !== 'object' || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  return { attempted: num(r.attempted), ok: num(r.ok), not_found: num(r.not_found), failed: num(r.failed) };
}

/**
 * 今回の実行(current)を含めた、その指標の連続失敗の回数。history = 新しい順の ingestion_logs。
 * 履歴は、定時実行(details.run_type === 'scheduled')だけを数える(手動実行・種別なしの古い記録は、数えず、連続も途切れさせない)。
 * 今回が失敗の回でなければ 0。
 */
/**
 * 履歴を新しい順(started_at の降順)に並べる。ストアが逆順(古い順)で返しても、判定が変わらないようにする。
 * started_at が読めない行は、並べ替えず、渡された順のまま(安定ソート)。
 */
export function newestFirst<T extends { started_at?: string }>(history: readonly T[]): T[] {
  return [...history].sort((a, b) => {
    const ta = Date.parse(a.started_at ?? '');
    const tb = Date.parse(b.started_at ?? '');
    return Number.isNaN(ta) || Number.isNaN(tb) ? 0 : tb - ta;
  });
}

export function consecutiveFailures(
  indicatorCode: string,
  current: ReleaseFetchStat | undefined,
  history: readonly { started_at?: string; details: Record<string, unknown> }[],
): number {
  if (!isFailingRun(current)) return 0;
  let streak = 1;
  for (const row of newestFirst(history)) {
    if (row.details.run_type !== 'scheduled') continue;
    if (!isFailingRun(readReleaseFetch(row.details, indicatorCode))) break;
    streak += 1;
  }
  return streak;
}

/**
 * 定時実行の終わりに呼ぶ。今回、失敗の回だった指標がある場合だけ履歴を読み、K 回連続した指標ごとに、実行を失敗にする。
 * 戻り値: 履歴を読めなかったときの警告の文(呼び出し側が出す)。それ以外は null。
 */
export async function applyReleaseFetchStreak(
  counters: JobCounters,
  store: Pick<IngestionStore, 'listRecentIngestionLogs'>,
  threshold: number = CONSECUTIVE_RELEASE_FAILURE_THRESHOLD,
): Promise<string | null> {
  const candidates = Object.entries(counters.releaseFetch).filter(([, stat]) => isFailingRun(stat));
  if (candidates.length === 0) return null; // 失敗の回が無ければ、履歴を読まない
  let history: readonly { started_at?: string; details: Record<string, unknown> }[];
  try {
    if (!store.listRecentIngestionLogs) throw new Error('listRecentIngestionLogs is not implemented by this store');
    history = await store.listRecentIngestionLogs(OFFICIAL_VALUES_JOB, RELEASE_FETCH_HISTORY_LIMIT);
  } catch (error) {
    // 履歴を読めなくても、取り込みは続ける(判定だけをしない)。警告を記録する
    const message = `official-values: could not read the run history for the consecutive-failure check (${error instanceof Error ? error.message : String(error)})`;
    counters.details.release_fetch_history_warning = message;
    return message;
  }
  const streaks: Record<string, number> = {};
  for (const [code, stat] of candidates) {
    const n = consecutiveFailures(code, stat, history);
    streaks[code] = n;
    if (n >= threshold)
      counters.error(
        `official-values: ${code}: the release fetch failed in ${n} consecutive scheduled runs (threshold ${threshold})`,
      );
  }
  counters.details.release_fetch_streak = streaks;
  return null;
}
