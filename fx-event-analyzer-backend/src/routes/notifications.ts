import type { FastifyInstance } from 'fastify';
import type { SupabaseClient } from '@supabase/supabase-js';
import { requireEntitlement, FEATURE_CODES } from '../authorization/entitlements.js';
import { resolvePlan } from '../authorization/plan.js';
import { ApiError } from '../errors/ApiError.js';
import { applyNotificationPlanLimits } from '../domain/planLimits.js';
import { toSettingsResponse } from '../domain/userSettings.js';
import {
  buildUpcomingNotifications,
  formatIsoSeconds,
  resolveUpcomingWindow,
  type NotificationPreferences,
} from '../domain/notifications.js';
import { resolveInboxMaterializationWindow, selectInboxDeliveries, toInboxItem } from '../domain/notificationInbox.js';
import { listNotificationCandidates } from '../repositories/notificationsRepository.js';
import {
  countUnreadInboxNotifications,
  deleteExpiredInboxNotificationsForUser,
  insertInboxNotifications,
  listInboxNotifications,
  markAllInboxNotificationsRead,
  markInboxNotificationRead,
} from '../repositories/notificationInboxRepository.js';
import { getOrCreateUserSettings } from '../repositories/userSettingsRepository.js';
import {
  inboxNotificationParamsSchema,
  listInboxNotificationsQuerySchema,
  upcomingNotificationsQuerySchema,
} from '../schemas/notifications.js';

/**
 * The caller's saved SCR-016 通知設定 as NotificationPreferences, with the
 * plan's limits (§28.1) applied to importances / fx_pairs at evaluation
 * time — shared by /notifications/upcoming and the inbox so both notify
 * exactly the same things. `settingsUpdatedAt` bounds inbox materialization
 * (src/domain/notificationInbox.ts resolveInboxMaterializationWindow).
 */
async function loadNotificationPreferences(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ prefs: NotificationPreferences; settingsUpdatedAt: string }> {
  const row = await getOrCreateUserSettings(supabase, userId);
  const { notifications, display } = toSettingsResponse(row);
  const limited = notifications.push
    ? applyNotificationPlanLimits(await resolvePlan(supabase, userId), {
        importances: notifications.importances,
        fxPairSymbols: notifications.fx_pairs,
      })
    : { importances: notifications.importances, fxPairSymbols: notifications.fx_pairs };
  return {
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

/**
 * GET /notifications/upcoming (api-design.md §24.6, HQ指示 2026-10-05).
 * iOS schedules on-device local notifications from this list, filtered by
 * the caller's saved SCR-016 通知設定 — there is no server-side push.
 * 通知しない時間帯 is evaluated in the saved display.timezone. The plan's
 * limits (§28.1) are applied to the saved importances / fx_pairs here, at
 * evaluation time, so settings saved while on PRO stop widening a FREE
 * user's list.
 *
 * GET /notifications, POST /notifications/{id}/read, POST
 * /notifications/read-all (api-design.md §24.9-§24.11,
 * notification-inbox-spec.md §6): the in-app notification inbox.
 */
export function registerNotificationRoutes(app: FastifyInstance): void {
  app.get('/notifications/upcoming', async (request) => {
    const userId = request.user!.id;
    await requireEntitlement(app.supabase, userId, FEATURE_CODES.VIEW_BASIC_EVENT);

    const query = upcomingNotificationsQuerySchema.parse(request.query);
    const window = resolveUpcomingWindow(query, new Date());
    const { prefs } = await loadNotificationPreferences(app.supabase, userId);

    if (!prefs.push) {
      return { lead_minutes: prefs.leadMinutes, items: [] };
    }

    const candidates = await listNotificationCandidates(
      app.supabase,
      window.from.toISOString(),
      window.to.toISOString(),
      { indicators: prefs.indicators, speeches: prefs.speeches },
    );

    return { lead_minutes: prefs.leadMinutes, items: buildUpcomingNotifications(prefs, candidates, window) };
  });

  // Materialize → delete the caller's expired rows → list (§24.9).
  app.get('/notifications', async (request) => {
    const userId = request.user!.id;
    await requireEntitlement(app.supabase, userId, FEATURE_CODES.VIEW_BASIC_EVENT);
    const query = listInboxNotificationsQuerySchema.parse(request.query);

    const now = new Date();
    const nowIso = now.toISOString();
    const { prefs, settingsUpdatedAt } = await loadNotificationPreferences(app.supabase, userId);

    if (prefs.push && (prefs.indicators || prefs.speeches)) {
      const window = resolveInboxMaterializationWindow(now, prefs.leadMinutes, new Date(settingsUpdatedAt));
      const candidates = await listNotificationCandidates(
        app.supabase,
        window.from.toISOString(),
        window.to.toISOString(),
        { indicators: prefs.indicators, speeches: prefs.speeches },
        { includePast: true },
      );
      await insertInboxNotifications(app.supabase, selectInboxDeliveries(userId, prefs, candidates, window, now));
    }

    await deleteExpiredInboxNotificationsForUser(app.supabase, userId, nowIso);

    const [rows, unreadCount] = await Promise.all([
      listInboxNotifications(app.supabase, userId, nowIso, { order: query.order, kind: query.kind }),
      countUnreadInboxNotifications(app.supabase, userId, nowIso),
    ]);
    return { items: rows.map(toInboxItem), unread_count: unreadCount };
  });

  // Registered before /:id/read for readability; the paths never overlap.
  app.post('/notifications/read-all', async (request) => {
    const userId = request.user!.id;
    const updated = await markAllInboxNotificationsRead(app.supabase, userId, new Date().toISOString());
    return { updated };
  });

  app.post('/notifications/:id/read', async (request) => {
    const userId = request.user!.id;
    const { id } = inboxNotificationParamsSchema.parse(request.params);
    const result = await markInboxNotificationRead(app.supabase, userId, id, new Date().toISOString());
    if (!result) {
      throw ApiError.notFound('Notification not found.');
    }
    return { id: result.id, read_at: formatIsoSeconds(new Date(result.read_at)) };
  });
}
