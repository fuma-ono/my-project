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

export interface PastReleaseAccess {
  plan: Plan;
  /** Ids (among the given events) whose values are hidden for this user. */
  lockedIds: Set<string>;
}

/**
 * 過去の発表のロック判定 (HQ判断 2026-10-22, src/domain/pastReleaseAccess.ts).
 * PRO (no cap) and pages without a RELEASED event never call the DB function.
 */
export async function resolvePastReleaseAccessForPlan(
  supabase: SupabaseClient,
  plan: Plan,
  events: readonly { id: string; indicator_id: string; status: string }[],
): Promise<Set<string>> {
  const max = pastReleasesMaxFor(plan);
  if (max === null) return new Set();
  const released = events.filter((event) => event.status === 'RELEASED');
  if (released.length === 0) return new Set();
  const visible = await listVisibleReleasedEventIds(
    supabase,
    released.map((event) => event.indicator_id),
    max,
  );
  return lockedEventIds(released, visible);
}

export async function resolvePastReleaseAccess(
  supabase: SupabaseClient,
  userId: string,
  events: readonly { id: string; indicator_id: string; status: string }[],
): Promise<PastReleaseAccess> {
  const plan = await resolvePlan(supabase, userId);
  return { plan, lockedIds: await resolvePastReleaseAccessForPlan(supabase, plan, events) };
}

/**
 * Child resources of an event (revisions, history, reactions, chart): 403
 * PLAN_LIMIT_EXCEEDED with required_plan "PRO" when the parent event is
 * locked for the user. Call before the main query.
 */
export async function requireUnlockedEvent(
  supabase: SupabaseClient,
  userId: string,
  event: { id: string; indicator_id: string; status: string },
): Promise<void> {
  await requireUnlockedEventForPlan(supabase, await resolvePlan(supabase, userId), event);
}

/** requireUnlockedEvent with the plan already resolved for this request
 * (requireEntitlementAndResolvePlan), so the plan is read only once. */
export async function requireUnlockedEventForPlan(
  supabase: SupabaseClient,
  plan: Plan,
  event: { id: string; indicator_id: string; status: string },
): Promise<void> {
  const lockedIds = await resolvePastReleaseAccessForPlan(supabase, plan, [event]);
  if (lockedIds.has(event.id)) {
    throw ApiError.planLimitExceeded(lockedReleaseMessage(plan), PAST_RELEASE_REQUIRED_PLAN);
  }
}
