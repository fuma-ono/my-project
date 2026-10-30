import { z } from 'zod';
import { NOTIFICATION_INBOX_KINDS } from '../domain/notificationInbox.js';

/** GET /notifications/upcoming (api-design.md §24.6). Defaults and the
 * range rules (to > from, at most 14 days) are applied by
 * resolveUpcomingWindow (src/domain/notifications.ts). */
export const upcomingNotificationsQuerySchema = z.object({
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
});

/** GET /notifications (api-design.md §24.9): newest first by default. */
export const listInboxNotificationsQuerySchema = z.object({
  order: z.enum(['desc', 'asc']).default('desc'),
  kind: z.enum(NOTIFICATION_INBOX_KINDS).optional(),
});

/** POST /notifications/{id}/read (§24.10). z.guid() like speechParamsSchema. */
export const inboxNotificationParamsSchema = z.object({
  id: z.guid(),
});
