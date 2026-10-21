import type { SupabaseClient } from '@supabase/supabase-js';
import { planFromFeatures, type Plan } from '../domain/planLimits.js';
import { listActiveFeatureCodes } from './entitlements.js';

/** FREE / PRO for usage limits (api-design.md §28.1): PRO = an active
 * VIEW_ADVANCED_STATS entitlement (synced by POST /subscription/verify),
 * FREE = every other authenticated user. */
export async function resolvePlan(supabase: SupabaseClient, userId: string): Promise<Plan> {
  return planFromFeatures(await listActiveFeatureCodes(supabase, userId));
}
