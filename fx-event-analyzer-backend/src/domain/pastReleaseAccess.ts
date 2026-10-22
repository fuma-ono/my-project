import { PLAN_LIMITS, planLimitsFor, type Plan } from './planLimits.js';

/**
 * 無料プランの「過去の発表」制限 (HQ判断 2026-10-22, api-design.md §28.1).
 *
 * FREE: 指標ごとに、発表済み(status = 'RELEASED')の直近
 * `past_releases_max` 回(release_datetime の新しい順、同時刻は id の昇順)
 * だけ値を見られる。それより古い発表は「ロック」— 値を隠し、
 * `locked: true, required_plan: "PRO"` を付けて返す。
 * PRO: ロックしない。SCHEDULED などの未発表イベントはどのプランでもロックしない。
 *
 * どの発表が見られるかの本番の計算は DB 関数 `visible_released_event_ids`
 * (migration 20261022000001) が行う。`selectVisibleReleasedIds` は同じ規則の
 * 純粋関数版(単体テスト・説明用)。
 */

export const PAST_RELEASE_REQUIRED_PLAN = 'PRO' as const;

/** ロックした発表で null にする値の項目(一覧・ホーム・詳細の snapshot)。 */
export const RELEASE_VALUE_FIELDS = ['forecast', 'actual', 'previous', 'surprise', 'surprise_direction'] as const;

export interface PastReleaseAccessFields {
  locked: boolean;
  required_plan: typeof PAST_RELEASE_REQUIRED_PLAN | null;
}

export const UNLOCKED: Readonly<PastReleaseAccessFields> = { locked: false, required_plan: null };
export const LOCKED: Readonly<PastReleaseAccessFields> = { locked: true, required_plan: PAST_RELEASE_REQUIRED_PLAN };

/** The plan's cap on visible past releases per indicator; null = no cap. */
export function pastReleasesMaxFor(plan: Plan): number | null {
  return planLimitsFor(plan).past_releases_max;
}

/** Top-level `past_release_limit` of GET /indicators/{id}/events and GET /home. */
export interface PastReleaseLimit {
  /** true when this plan hides older releases. */
  applied: boolean;
  max_for_plan: number | null;
  pro_max: number | null;
}

export function pastReleaseLimitFor(plan: Plan): PastReleaseLimit {
  const max = pastReleasesMaxFor(plan);
  return { applied: max !== null, max_for_plan: max, pro_max: PLAN_LIMITS.PRO.past_releases_max };
}

export interface ReleaseCandidate {
  id: string;
  indicator_id: string;
  status: string;
  release_datetime: string;
}

/** Ordering of `visible_released_event_ids`: release_datetime desc, then id asc. */
function compareNewestFirst(a: ReleaseCandidate, b: ReleaseCandidate): number {
  const byTime = Date.parse(b.release_datetime) - Date.parse(a.release_datetime);
  if (byTime !== 0) return byTime;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Pure equivalent of the SQL function: per indicator, the `limit` newest RELEASED ids. */
export function selectVisibleReleasedIds(events: readonly ReleaseCandidate[], limit: number): Set<string> {
  const byIndicator = new Map<string, ReleaseCandidate[]>();
  for (const event of events) {
    if (event.status !== 'RELEASED') continue;
    const list = byIndicator.get(event.indicator_id) ?? [];
    list.push(event);
    byIndicator.set(event.indicator_id, list);
  }
  const visible = new Set<string>();
  for (const list of byIndicator.values()) {
    for (const event of [...list].sort(compareNewestFirst).slice(0, Math.max(limit, 0))) {
      visible.add(event.id);
    }
  }
  return visible;
}

/**
 * Locked ids among `events`, given the visible RELEASED ids.
 * `visibleIds = null` means the plan has no cap (PRO) → nothing is locked.
 * Only RELEASED events can be locked.
 */
export function lockedEventIds(
  events: readonly { id: string; status: string }[],
  visibleIds: ReadonlySet<string> | null,
): Set<string> {
  const locked = new Set<string>();
  if (visibleIds === null) return locked;
  for (const event of events) {
    if (event.status === 'RELEASED' && !visibleIds.has(event.id)) locked.add(event.id);
  }
  return locked;
}

export function accessFields(locked: boolean): PastReleaseAccessFields {
  return locked ? { ...LOCKED } : { ...UNLOCKED };
}

/**
 * Adds `locked` / `required_plan` to `item`; when locked, every field in
 * `valueFields` that is present on `item` is set to null. Everything else
 * (dates, status, data_status, indicator info, source …) is kept.
 */
export function redactRelease<T extends object>(
  item: T,
  locked: boolean,
  valueFields: readonly string[] = RELEASE_VALUE_FIELDS,
): T & PastReleaseAccessFields {
  if (!locked) return { ...item, ...UNLOCKED };
  return { ...nullFields(item, valueFields), ...LOCKED };
}

/** A copy of `item` with each of `fields` that is present set to null. */
export function nullFields<T extends object>(item: T, fields: readonly string[]): T {
  const copy = { ...item } as Record<string, unknown>;
  for (const field of fields) {
    if (field in copy) copy[field] = null;
  }
  return copy as T;
}

/** Message of the 403 PLAN_LIMIT_EXCEEDED for a locked event's child resources. */
export function lockedReleaseMessage(plan: Plan): string {
  const max = pastReleasesMaxFor(plan);
  return `This past release is not available on the ${plan} plan (only the ${max ?? 'all'} most recent releases per indicator). Upgrade to ${PAST_RELEASE_REQUIRED_PLAN} to unlock it.`;
}
