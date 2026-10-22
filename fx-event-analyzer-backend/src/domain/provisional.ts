/**
 * API が返す `is_provisional`(HQ指示 2026-10-22 Task 3 レビュー対応)。
 *
 * economic_events.is_provisional は「その予定の日時がまだ公式に確定していない」
 * フラグで、FOMC の日程表(ingestion/mappings/fomcSchedule.ts)を人が直して
 * ジョブを動かすまで DB では true のまま残る。会合が過ぎた後も
 * 「予定（暫定）」が出続けないよう、API はレスポンスを作る時点で
 * 「DB が true かつ発表日時が今より先」のときだけ true を返す。
 * GET /calendar(domain/calendar.ts)と GET /events/{id}(routes/events.ts)は
 * 必ずこの関数を通す(GET /home は is_provisional を返さない)。
 */
export function effectiveIsProvisional(
  isProvisional: boolean | null | undefined,
  releaseDatetime: string,
  now: Date,
): boolean {
  if (isProvisional !== true) return false;
  const releaseAt = Date.parse(releaseDatetime);
  // 日時が読めない行は安全側(暫定と出さない)。
  if (Number.isNaN(releaseAt)) return false;
  return releaseAt > now.getTime();
}
