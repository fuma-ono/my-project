import type { SupabaseClient } from '@supabase/supabase-js';
import { resolvePlan } from '../authorization/plan.js';
import type { NotificationPreferences } from '../domain/notifications.js';
import { applyNotificationPlanLimits, type Plan } from '../domain/planLimits.js';
import { toSettingsResponse } from '../domain/userSettings.js';
import { getOrCreateUserSettings } from '../repositories/userSettingsRepository.js';

/**
 * The caller's saved SCR-016 通知設定 as NotificationPreferences, with the
 * plan's limits (§28.1) applied to importances / fx_pairs at evaluation
 * time — shared by /notifications/upcoming, the inbox and the server push
 * jobs (src/push/pushJobs.ts) so all of them notify exactly the same things.
 * `settingsUpdatedAt` bounds inbox materialization
 * (src/domain/notificationInbox.ts resolveInboxMaterializationWindow).
 */
export async function loadNotificationPreferences(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ prefs: NotificationPreferences; settingsUpdatedAt: string; plan: Plan | null; language: string }> {
  const row = await getOrCreateUserSettings(supabase, userId);
  const { notifications, display } = toSettingsResponse(row);
  const plan = notifications.push ? await resolvePlan(supabase, userId) : null;
  const limited = plan
    ? applyNotificationPlanLimits(plan, {
        importances: notifications.importances,
        fxPairSymbols: notifications.fx_pairs,
      })
    : { importances: notifications.importances, fxPairSymbols: notifications.fx_pairs };
  return {
    plan,
    language: display.language,
    prefs: {
      push: notifications.push,
      indicators: notifications.indicators,
      speeches: notifications.speeches,
      fxPairSymbols: limited.fxPairSymbols,
      importances: limited.importances,
      leadMinutes: notifications.lead_minutes,
      quietHours: {
        enabled: notifications.quiet_hours_enabled,
        start: notifications.quiet_start,
        end: notifications.quiet_end,
      },
      timeZone: display.timezone,
    },
    settingsUpdatedAt: row.updated_at,
  };
}
