/**
 * SCR-006 指標詳細 (api-design.md §13.1 / §13.2): the indicator object's
 * `key_points` (注目される理由) is always an array in API responses —
 * `economic_indicators.key_points` NULL (未登録) is returned as `[]`, so the
 * client only has to handle "empty list". `name_en` stays nullable.
 */
export function normalizeKeyPoints(keyPoints: readonly string[] | null | undefined): string[] {
  return keyPoints ? [...keyPoints] : [];
}

/**
 * SCR-005 指標一覧 (api-design.md §13.1 / §13.2, v1.20): each indicator object
 * carries its next release (the earliest SCHEDULED Event at/after now) and,
 * as the fallback shown when there is none, its latest RELEASED Event.
 */
export interface IndicatorReleaseSummary {
  next_release_datetime: string | null;
  next_event_id: string | null;
  latest_release_datetime: string | null;
}

export interface ReleaseEventRow {
  id: string;
  indicator_id: string;
  release_datetime: string;
}

export const EMPTY_RELEASE_SUMMARY: IndicatorReleaseSummary = Object.freeze({
  next_release_datetime: null,
  next_event_id: null,
  latest_release_datetime: null,
});

/**
 * Folds the page's SCHEDULED (future) and RELEASED Events into one summary
 * per indicator. Order-independent: the earliest scheduled Event at/after
 * `now` (ties broken by id) and the latest released Event win, so the
 * repository's ORDER BY is an optimisation, not a correctness requirement.
 */
export function buildReleaseSummaries(
  indicatorIds: readonly string[],
  scheduledEvents: readonly ReleaseEventRow[],
  releasedEvents: readonly ReleaseEventRow[],
  now: Date,
): Map<string, IndicatorReleaseSummary> {
  const nowMs = now.getTime();
  const next = new Map<string, ReleaseEventRow>();
  for (const event of scheduledEvents) {
    const time = Date.parse(event.release_datetime);
    if (!Number.isFinite(time) || time < nowMs) continue;
    const current = next.get(event.indicator_id);
    if (!current) {
      next.set(event.indicator_id, event);
      continue;
    }
    const currentTime = Date.parse(current.release_datetime);
    if (time < currentTime || (time === currentTime && event.id < current.id)) {
      next.set(event.indicator_id, event);
    }
  }

  const latest = new Map<string, ReleaseEventRow>();
  for (const event of releasedEvents) {
    const time = Date.parse(event.release_datetime);
    if (!Number.isFinite(time)) continue;
    const current = latest.get(event.indicator_id);
    if (!current || time > Date.parse(current.release_datetime)) {
      latest.set(event.indicator_id, event);
    }
  }

  const summaries = new Map<string, IndicatorReleaseSummary>();
  for (const indicatorId of indicatorIds) {
    const nextEvent = next.get(indicatorId);
    summaries.set(indicatorId, {
      next_release_datetime: nextEvent?.release_datetime ?? null,
      next_event_id: nextEvent?.id ?? null,
      latest_release_datetime: latest.get(indicatorId)?.release_datetime ?? null,
    });
  }
  return summaries;
}

/**
 * `sort=next_release`: ascending next_release_datetime, indicators with no
 * next release last, then name (then id, so the order is total).
 */
export function compareByNextRelease(
  a: { id: string; name: string; next_release_datetime: string | null },
  b: { id: string; name: string; next_release_datetime: string | null },
): number {
  const aTime = a.next_release_datetime === null ? null : Date.parse(a.next_release_datetime);
  const bTime = b.next_release_datetime === null ? null : Date.parse(b.next_release_datetime);
  if (aTime !== bTime) {
    if (aTime === null) return 1;
    if (bTime === null) return -1;
    return aTime - bTime;
  }
  if (a.name !== b.name) return a.name < b.name ? -1 : 1;
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  return 0;
}
