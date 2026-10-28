/**
 * 予定に「結果の値」が出るか(HQ指示 2026-10-27「予定データは実績値が未取得であることを区別できるように」、
 * 設計 fx-dev-records 2026-10-27-calendar-gap/schedule-only-design.md 2章、実装 2026-10-28)。
 *
 * - VALUE: 結果の値が出る指標(CPI・雇用統計など)。発表時刻を過ぎて data_status が PENDING なら「結果待ち」
 *   (値はまだ取り込まれていない。値を推測で埋めることはしない)。FOMC の会合も VALUE(金利の値の取り込みが
 *   できるまでは、発表後も「結果待ち」のまま)
 * - NONE: 結果の値が出ない予定(FOMC議事要旨)。発表時刻を過ぎたら「公表済み」(結果の欄は出さない)。
 *   通知の文面は「公表の N 分前」(「発表」と書かない)
 *
 * 指標ごとの設定はコードで持つ(コードレビューの対象。DB は変えない)。
 */
export type ResultType = 'VALUE' | 'NONE';

/** 結果の値が出ない指標(economic_indicators.code)。 */
export const RESULT_TYPE_NONE_INDICATORS: ReadonlySet<string> = new Set(['US_FOMC_MINUTES']);

export function resultTypeForIndicator(code: string | null | undefined): ResultType {
  return code && RESULT_TYPE_NONE_INDICATORS.has(code) ? 'NONE' : 'VALUE';
}
