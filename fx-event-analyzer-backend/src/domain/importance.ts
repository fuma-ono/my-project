/**
 * Indicator/event importance is three-level in the DB (LOW/MEDIUM/HIGH,
 * db-design.md §3.4), while the notification threshold the user picks is
 * ★1〜★5 (user_settings.notify_min_importance, §3.14).
 *
 * 暫定マッピング (HQ確定 2026-10-02): LOW → ★1, MEDIUM → ★3, HIGH → ★5.
 * To be re-confirmed when push delivery is implemented; if importance
 * itself becomes five-level later, only this table needs to change.
 */
export type Importance = 'LOW' | 'MEDIUM' | 'HIGH';

export const IMPORTANCE_STARS: Readonly<Record<Importance, number>> = {
  LOW: 1,
  MEDIUM: 3,
  HIGH: 5,
};

/** Whether an event of `importance` meets the user's ★ threshold. */
export function meetsNotificationThreshold(importance: Importance, minStars: number): boolean {
  return IMPORTANCE_STARS[importance] >= minStars;
}
