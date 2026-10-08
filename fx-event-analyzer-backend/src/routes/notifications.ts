import type { FastifyInstance } from 'fastify';
import { requireEntitlement, FEATURE_CODES } from '../authorization/entitlements.js';
import { resolvePlan } from '../authorization/plan.js';
import { applyNotificationPlanLimits } from '../domain/planLimits.js';
import { toSettingsResponse } from '../domain/userSettings.js';
import { buildUpcomingNotifications, resolveUpcomingWindow } from '../domain/notifications.js';
import { listNotificationCandidates } from '../repositories/notificationsRepository.js';
import { getOrCreateUserSettings } from '../repositories/userSettingsRepository.js';
import { upcomingNotificationsQuerySchema } from '../schemas/notifications.js';

/**
 * GET /notifications/upcoming (api-design.md §24.6, HQ指示 2026-10-05).
 * iOS schedules on-device local notifications from this list, filtered by
 * the caller's saved SCR-016 通知設定 — there is no server-side push.
 * 通知しない時間帯 is evaluated in the saved display.timezone. The plan's
 * limits (§28.1) are applied to the saved importances / fx_pairs here, at
 * evaluation time, so settings saved while on PRO stop widening a FREE
 * user's list.
 */
export function registerNotificationRoutes(app: FastifyInstance): void {
  app.get('/notifications/upcoming', async (request) => {
    const userId = request.user!.id;
    await requireEntitlement(app.supabase, userId, FEATURE_CODES.VIEW_BASIC_EVENT);

    const query = upcomingNotificationsQuerySchema.parse(request.query);
    const window = resolveUpcomingWindow(query, new Date());
    const { notifications, display } = toSettingsResponse(await getOrCreateUserSettings(app.supabase, userId));

    if (!notifications.push) {
      return { lead_minutes: notifications.lead_minutes, items: [] };
    }

    const limited = applyNotificationPlanLimits(await resolvePlan(app.supabase, userId), {
      importances: notifications.importances,
      fxPairSymbols: notifications.fx_pairs,
    });

    const candidates = await listNotificationCandidates(
      app.supabase,
      window.from.toISOString(),
      window.to.toISOString(),
      { indicators: notifications.indicators, speeches: notifications.speeches },
    );

    const items = buildUpcomingNotifications(
      {
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
      candidates,
      window,
    );

    return { lead_minutes: notifications.lead_minutes, items };
  });
}
