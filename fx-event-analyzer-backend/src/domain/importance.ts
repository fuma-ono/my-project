/**
 * Indicator/event/speech importance is three-level in the DB (LOW/MEDIUM/
 * HIGH, db-design.md §3.4).
 *
 * The ★1〜★5 threshold (旧 user_settings.notify_min_importance) was replaced
 * by an explicit set of levels (notify_importances) in SCR-016 通知設定 v2
 * (HQ指示 2026-10-05). The provisional ★ mapping below (HQ確定 2026-10-02:
 * LOW → ★1, MEDIUM → ★3, HIGH → ★5) is kept because it is what
 * 20261005000002_notification_settings_v2.sql used to backfill existing
 * users, and in case a ★ display comes back.
 */
export type Importance = 'LOW' | 'MEDIUM' | 'HIGH';

/** Canonical display/response order (SCR-016: 高 → 中 → 低). */
export const IMPORTANCES_DESC: readonly Importance[] = ['HIGH', 'MEDIUM', 'LOW'];

export const IMPORTANCE_STARS: Readonly<Record<Importance, number>> = {
  LOW: 1,
  MEDIUM: 3,
  HIGH: 5,
};

/** Whether an event of `importance` meets the user's ★ threshold. */
export function meetsNotificationThreshold(importance: Importance, minStars: number): boolean {
  return IMPORTANCE_STARS[importance] >= minStars;
}

/** De-duplicates and orders a set of levels HIGH, MEDIUM, LOW. */
export function sortImportancesDesc(levels: readonly Importance[]): Importance[] {
  return IMPORTANCES_DESC.filter((level) => levels.includes(level));
}
