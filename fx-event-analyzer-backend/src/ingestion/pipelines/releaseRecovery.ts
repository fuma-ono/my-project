/**
 * QA-1: 初回値(RELEASE スナップショット)を保存した後、イベントの状態更新(RELEASED・AVAILABLE)が失敗すると、
 * スナップショットは有るのにイベントが SCHEDULED・PENDING のまま残る(スナップショットは DB のトリガーで更新・削除できない)。
 * 次の実行では「スナップショットが有る」ので改定の確認だけに進み、状態が直らず、アプリでは値が出ない状態が続いた。
 *
 * この判定が true の行は、スナップショットも改定の履歴も触らずに、イベントの状態だけを RELEASED・AVAILABLE にする。
 * 直すのは次の2つの形だけ(C のレビュー 2026-11-18 の条件):
 *   - SCHEDULED / PENDING(状態更新が一度も入らなかった)
 *   - RELEASED / PENDING(カレンダー経路は、実績つきの新規行を RELEASED / PENDING で作り、publishRelease が AVAILABLE にするため)
 * それ以外は、スナップショットが有っても触らない。例: SCHEDULED / AVAILABLE・SCHEDULED / PARTIAL・SCHEDULED / UNAVAILABLE、
 * 取りやめ CANCELLED(どの data_status でも)、BLS の値なし RELEASED / UNAVAILABLE、すでに RELEASED / AVAILABLE・PARTIAL。
 *
 * 【自動で回復しない範囲 — 人手の対応が要る】
 * official-values(pipelines/officialValues.ts)は、公表から lookbackDays(既定 45 日)より前のイベントを見ない。そのため、
 * 状態更新の失敗から 45 日を超えて残った stuck 行は、再実行しても自動では回復しない。人が data_status などを確認して直す。
 * 期間は ingestOfficialValues の deps.lookbackDays で変えられる(例: 回復のために一度だけ 120 を渡す)。ただし lookbackDays を
 * 延ばすと、初回値を保存していない古い回の取り込み(firstValueWindow などの個別の期限で止まるものを除く)や改定の確認の
 * 対象も同じだけ広がる。jp-cpi-values・経済カレンダーは、それぞれの対象の回・取得の範囲に入る行だけを回復する。
 */
import type { StoredEvent } from '../store.js';

export function needsReleasedStateRepair(
  event: Pick<StoredEvent, 'status' | 'data_status'>,
  snapshot: unknown,
): boolean {
  if (!snapshot) return false;
  return (event.status === 'SCHEDULED' || event.status === 'RELEASED') && event.data_status === 'PENDING';
}
