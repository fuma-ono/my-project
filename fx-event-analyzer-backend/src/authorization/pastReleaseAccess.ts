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
 * Child resources of an event (revisions, history, reactions, chart): 403
 * PLAN_LIMIT_EXCEEDED with required_plan "PRO" when the parent event is
 * locked for the user. Call before the main query. Returns whether the
 * (unlocked) event's `previous` must be hidden.
 */
export async function requireUnlockedEvent(
  supabase: SupabaseClient,
  userId: string,
  event: { id: string; indicator_id: string; status: string },
): Promise<{ previousLocked: boolean }> {
  return requireUnlockedEventForPlan(supabase, await resolvePlan(supabase, userId), event);
}

/** requireUnlockedEvent with the plan already resolved for this request
 * (requireEntitlementAndResolvePlan), so the plan is read only once. */
export async function requireUnlockedEventForPlan(
  supabase: SupabaseClient,
  plan: Plan,
  event: { id: string; indicator_id: string; status: string },
): Promise<{ previousLocked: boolean }> {
  const { lockedIds, previousLockedIds } = await resolvePastReleaseAccessForPlan(supabase, plan, [event]);
  if (lockedIds.has(event.id)) {
    throw ApiError.planLimitExceeded(lockedReleaseMessage(plan), PAST_RELEASE_REQUIRED_PLAN);
  }
  return { previousLocked: previousLockedIds.has(event.id) };
}
