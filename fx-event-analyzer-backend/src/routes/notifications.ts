import type { FastifyInstance } from 'fastify';
import { requireEntitlement, FEATURE_CODES } from '../authorization/entitlements.js';
import { toSettingsResponse } from '../domain/userSettings.js';
import { buildUpcomingNotifications, resolveUpcomingWindow } from '../domain/notifications.js';
import { listNotificationCandidates } from '../repositories/notificationsRepository.js';
import { getOrCreateUserSettings } from '../repositories/userSettingsRepository.js';
import { upcomingNotificationsQuerySchema } from '../schemas/notifications.js';

/**
 * GET /notifications/upcoming (api-design.md §24.6, HQ指示 2026-10-05).
 * iOS schedules on-device local notifications from this list, filtered by
 * the caller's saved SCR-016 通知設定 — there is no server-side push.
 */
export function registerNotificationRoutes(app: FastifyInstance): void {
  app.get('/notifications/upcoming', async (request) => {
    const userId = request.user!.id;
    await requireEntitlement(app.supabase, userId, FEATURE_CODES.VIEW_BASIC_EVENT);

    const query = upcomingNotificationsQuerySchema.parse(request.query);
    const window = resolveUpcomingWindow(query, new Date());
    const { notifications } = toSettingsResponse(await getOrCreateUserSettings(app.supabase, userId));

    if (!notifications.push) {
      return { lead_minutes: notifications.lead_minutes, items: [] };
    }

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
        fxPairSymbols: notifications.fx_pairs,
        importances: notifications.importances,
        leadMinutes: notifications.lead_minutes,
      },
      candidates,
      window,
    );

    return { lead_minutes: notifications.lead_minutes, items };
  });
}
