/**
 * official-values ジョブの本体(src/jobs/ingestOfficialValues.ts が runIngestionJob の中で呼ぶ)。
 * テストできるように、ジョブ(起動時に実行される)から分けてある。
 *
 * **run_type(scheduled / manual)は、取り込みの開始前に記録する**(HQ 指示 2026-11-19、C の指摘)。取り込みの途中で例外が出ても、
 * runIngestionJob は、そのときまでの counters(details)を ingestion_logs に書く。run_type が先に入っていれば、例外で終わった
 * 定時実行も、履歴の上で「定時実行」と分かり、**それまでに実際に行った取得の結果(details.release_fetch)に基づいて**、
 * 次回の連続判定に数えられる(取得を試みていなければ、リセット)。
 *
 * 継続障害の検知の対象(HQ 決定。広げない場合は、ここを変えない):
 *   - **現在の対象は、ABS(豪州)の「発表日の取得(releaseRequest)」だけ**。
 *   - ABS の系列の取得、ONS、Statistics Canada の取得は**対象外**(発表日の取得を持たない / 記録しない)。
 *   - ログに `release_fetch` の記録が無いことは、**正常に取得できた証拠ではない**(対象外の取得元・取得を試みなかった実行・
 *     旧形式のログのいずれでも、記録は無い)。
 *   - 対象外の取得元の継続障害は、従来どおり、一部失敗の警告(全件失敗なら定時実行の失敗)にとどまることがある。
 *   - 対象の拡大は、HQ の別判断。
 */
import type { OfficialScheduleTable } from './mappings/gbAuCaSchedule.js';
import { ingestOfficialValues } from './pipelines/officialValues.js';
import { applyReleaseFetchStreak } from './releaseFetchStreak.js';
import { applyFetchOutcome, type JobCounters } from './runner.js';
import type { IngestionStore } from './store.js';

export interface OfficialValuesRunResult {
  /** 一部の取得が失敗したときの警告の文(呼び出し側が出す)。 */
  fetchWarning: string | null;
  /** 履歴を読めなかったときの警告の文(定時実行のみ)。 */
  historyWarning: string | null;
}

export async function runOfficialValues(
  counters: JobCounters,
  deps: {
    store: IngestionStore;
    fetcher: Parameters<typeof ingestOfficialValues>[0]['fetcher'];
    tables: readonly OfficialScheduleTable[];
    scheduled: boolean;
    /** テストで差し替える(既定は実際の取り込み)。 */
    ingest?: typeof ingestOfficialValues;
  },
): Promise<OfficialValuesRunResult> {
  // 取り込みの開始前に記録する(途中で例外が出ても、履歴の上で実行種別が分かるように)
  counters.details.run_type = deps.scheduled ? 'scheduled' : 'manual';
  await (deps.ingest ?? ingestOfficialValues)(
    { store: deps.store, fetcher: deps.fetcher, tables: deps.tables },
    counters,
  );
  // 取得を試みて、全件失敗なら、定時実行だけ失敗(赤)。手動は従来どおり。取得対象なし(試行 0)は正常。一部失敗は、警告(緑のまま)
  const fetchWarning = applyFetchOutcome(counters, 'official-values', deps.scheduled);
  if (fetchWarning) counters.details.fetch_warning = fetchWarning;
  // 定時実行だけ: 同じ指標で、発表日の取得が K 回連続して失敗なら、実行を失敗にする。履歴を読めなくても、取り込みは続ける(警告)
  const historyWarning = deps.scheduled ? await applyReleaseFetchStreak(counters, deps.store) : null;
  return { fetchWarning, historyWarning };
}
