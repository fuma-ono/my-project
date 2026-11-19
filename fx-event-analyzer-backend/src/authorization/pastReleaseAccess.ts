import type { SupabaseClient } from '@supabase/supabase-js';
import { ApiError } from '../errors/ApiError.js';
import type { Plan } from '../domain/planLimits.js';
import {
  lockedEventIds,
  lockedReleaseMessage,
  PAST_RELEASE_REQUIRED_PLAN,
  pastReleasesMaxFor,
} from '../domain/pastReleaseAccess.js';
import { listVisibleReleasedEventIds } from '../repositories/pastReleaseRepository.js';
import { assertEventIndicatorCode, isPolicyRateLockedForPlan } from './policyRateAccess.js';
import { resolvePlan } from './plan.js';

export interface PastReleaseLocks {
  /** Ids (among the given events) whose values are hidden for this user. */
  lockedIds: Set<string>;
  /**
   * Ids (among the given, unlocked events) whose `previous` is hidden: the
   * preceding RELEASED release of the same indicator is locked, and
   * `previous` is that release's actual (HQ指示 2026-10-22). Their revised
   * `previous` (event_revisions PREVIOUS) and explanation are hidden too.
   */
  previousLockedIds: Set<string>;
}

export interface PastReleaseAccess extends PastReleaseLocks {
  plan: Plan;
}

const NO_LOCKS = (): PastReleaseLocks => ({ lockedIds: new Set(), previousLockedIds: new Set() });

/**
 * 過去の発表のロック判定 (HQ判断 2026-10-22, src/domain/pastReleaseAccess.ts).
 * PRO (no cap) and pages without a RELEASED event never call the DB function.
 * The one place every route asks — list, home, detail, child resources and
 * comparison all use the same rule.
 */
export async function resolvePastReleaseAccessForPlan(
  supabase: SupabaseClient,
  plan: Plan,
  events: readonly { id: string; indicator_id: string; status: string }[],
): Promise<PastReleaseLocks> {
  const max = pastReleasesMaxFor(plan);
  if (max === null) return NO_LOCKS();
  const released = events.filter((event) => event.status === 'RELEASED');
  if (released.length === 0) return NO_LOCKS();
  const visible = await listVisibleReleasedEventIds(
    supabase,
    released.map((event) => event.indicator_id),
    max,
  );
  const previousLockedIds = new Set(released.filter((event) => visible.get(event.id) === true).map((e) => e.id));
  return { lockedIds: lockedEventIds(released, new Set(visible.keys())), previousLockedIds };
}

export async function resolvePastReleaseAccess(
  supabase: SupabaseClient,
  userId: string,
  events: readonly { id: string; indicator_id: string; status: string }[],
): Promise<PastReleaseAccess> {
  const plan = await resolvePlan(supabase, userId);
  return { plan, ...(await resolvePastReleaseAccessForPlan(supabase, plan, events)) };
}

/**
 * 子リソースのロックを判定される発表。**`indicator_code` は必須**(HQ 指示 2026-11-19、C のレビュー)。
 * 以前は省略できたので、将来の呼び出しが `indicator_code` を渡し忘れても、FOMC の政策金利のロックが**黙って素通り**した。
 * 必須にして、渡し忘れをコンパイルエラーにする(`getEventById` の結果(EventRow)は、すべて持っている)。
 */
export interface UnlockableEvent {
  id: string;
  indicator_id: string;
  status: string;
  indicator_code: string;
}

/**
 * Child resources of an event (revisions, history, reactions, chart): 403
 * PLAN_LIMIT_EXCEEDED with required_plan "PRO" when the parent event is
 * locked for the user. Call before the main query. Returns whether the
 * (unlocked) event's `previous` must be hidden.
 */
export async function requireUnlockedEvent(
  supabase: SupabaseClient,
  userId: string,
  event: UnlockableEvent,
): Promise<{ previousLocked: boolean }> {
  return requireUnlockedEventForPlan(supabase, await resolvePlan(supabase, userId), event);
}

/** requireUnlockedEvent with the plan already resolved for this request
 * (requireEntitlementAndResolvePlan), so the plan is read only once. */
export async function requireUnlockedEventForPlan(
  supabase: SupabaseClient,
  plan: Plan,
  event: UnlockableEvent,
): Promise<{ previousLocked: boolean }> {
  // 型を迂回した呼び出し(any・JS)でも、判定を素通りさせない: indicator_code が無ければ、FOMC かどうかを判定できないので、
  // ロックを黙って省略せず、エラーにする(プログラムの誤り。500)。PRO でも同じ(判定の前に確かめる)。
  assertEventIndicatorCode(event.indicator_code);
  const { lockedIds, previousLockedIds } = await resolvePastReleaseAccessForPlan(supabase, plan, [event]);
  if (lockedIds.has(event.id)) {
    throw ApiError.planLimitExceeded(lockedReleaseMessage(plan), PAST_RELEASE_REQUIRED_PLAN);
  }
  // HQ 指示 2026-11-19: FOMC の会合は RELEASED にならないので、上のロックの対象外。過去の会合の政策金利を FREE には直近 3 回だけ見せる規則を、
  // 子リソース(revisions・reaction・reaction/chart・history)にも当てはめる(政策金利の本体と同じ判定: policyRateAccess.ts)。
  // US_FOMC 以外の指標は影響を受けない(isPolicyRateLockedForPlan が、DB を読まずに false)。同じ PLAN_LIMIT_EXCEEDED(required_plan PRO)で返す。
  if (
    await isPolicyRateLockedForPlan(supabase, plan, {
      id: event.id,
      indicator_id: event.indicator_id,
      indicator_code: event.indicator_code,
    })
  ) {
    throw ApiError.planLimitExceeded(lockedReleaseMessage(plan), PAST_RELEASE_REQUIRED_PLAN);
  }
  return { previousLocked: previousLockedIds.has(event.id) };
}
