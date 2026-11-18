/**
 * QA-1: 初回値(RELEASE スナップショット)を保存した後、イベントの状態更新(RELEASED・AVAILABLE)が失敗すると、
 * スナップショットは有るのにイベントが SCHEDULED・PENDING のまま残る(スナップショットは DB のトリガーで更新・削除できない)。
 * 次の実行では「スナップショットが有る」ので改定の確認だけに進み、状態が直らず、アプリでは値が出ない状態が続いた。
 *
 * この判定が true の行は、スナップショットも改定の履歴も触らずに、イベントの状態だけを RELEASED・AVAILABLE にする。
 * 直すのは次の2つの形だけ(それ以外 — 取りやめ CANCELLED、BLS の値なし UNAVAILABLE、すでに RELEASED・AVAILABLE — は触らない):
 *   - status SCHEDULED(状態更新が一度も入らなかった)
 *   - status RELEASED だが data_status PENDING
 */
import type { StoredEvent } from '../store.js';

export function needsReleasedStateRepair(
  event: Pick<StoredEvent, 'status' | 'data_status'>,
  snapshot: unknown | null,
): boolean {
  if (!snapshot) return false;
  return event.status === 'SCHEDULED' || (event.status === 'RELEASED' && event.data_status === 'PENDING');
}
