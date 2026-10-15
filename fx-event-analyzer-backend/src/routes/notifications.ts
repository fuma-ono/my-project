import type { FastifyInstance } from 'fastify';
import type { SupabaseClient } from '@supabase/supabase-js';
import { requireEntitlement, FEATURE_CODES } from '../authorization/entitlements.js';
import { resolvePlan } from '../authorization/plan.js';
import { ApiError } from '../errors/ApiError.js';
import { applyNotificationPlanLimits, planLimitsFor, type Plan } from '../domain/planLimits.js';
import { toSettingsResponse } from '../domain/userSettings.js';
import {
  buildUpcomingNotifications,
  formatIsoSeconds,
  resolveUpcomingWindow,
  type NotificationPreferences,
} from '../domain/notifications.js';
import { resolveInboxMaterializationWindow, selectInboxDeliveries, toInboxItem } from '../domain/notificationInbox.js';
import {
  candidateKey,
  resolveCalendarUpdateWindow,
  selectCalendarUpdateDeliveries,
} from '../domain/calendarUpdates.js';
import {
  listNotificationCandidates,
  listNotificationCandidatesByIds,
} from '../repositories/notificationsRepository.js';
import { evaluateRateAlertsForUser } from '../repositories/rateAlertsRepository.js';
import { listScheduleChanges } from '../repositories/scheduleChangesRepository.js';
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
): Promise<{ prefs: NotificationPreferences; settingsUpdatedAt: string; plan: Plan | null }> {
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
 * CALENDAR_UPDATE (src/domain/calendarUpdates.ts): the last 7 days of
 * event_schedule_changes (not before the settings were saved) whose event
 * the caller would be notified about.
 */
async function materializeCalendarUpdates(
  supabase: SupabaseClient,
  userId: string,
  prefs: NotificationPreferences,
  settingsUpdatedAt: string,
  now: Date,
): Promise<void> {
  const window = resolveCalendarUpdateWindow(now, new Date(settingsUpdatedAt));
  const changes = await listScheduleChanges(supabase, window.from.toISOString(), window.to.toISOString(), {
    indicators: prefs.indicators,
    speeches: prefs.speeches,
  });
  if (changes.length === 0) return;
  const candidates = await listNotificationCandidatesByIds(supabase, {
    indicators: changes.filter((change) => change.kind === 'INDICATOR').map((change) => change.target_id),
    speeches: changes.filter((change) => change.kind === 'SPEECH').map((change) => change.target_id),
  });
  const byKey = new Map(candidates.map((candidate) => [candidateKey(candidate.kind, candidate.id), candidate]));
  await insertInboxNotifications(supabase, selectCalendarUpdateDeliveries(userId, prefs, changes, byKey, window, now));
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
 * notification-inbox-spec.md §6): the in-app notification inbox. GET also
 * fires the caller's crossed rate alerts (RATE_ALERT, §7) and records
 * calendar changes (CALENDAR_UPDATE, §8).
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
    const { prefs, settingsUpdatedAt, plan } = await loadNotificationPreferences(app.supabase, userId);

    // push = false records nothing new — no INDICATOR / SPEECH /
    // CALENDAR_UPDATE rows, and rate alerts are not evaluated (they stay
    // active until push is turned back on).
    if (prefs.push && plan) {
      await evaluateRateAlertsForUser(app.supabase, userId, planLimitsFor(plan).rate_alerts_max, now);
    }

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
      await materializeCalendarUpdates(app.supabase, userId, prefs, settingsUpdatedAt, now);
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
