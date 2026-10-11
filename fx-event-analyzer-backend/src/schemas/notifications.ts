import { z } from 'zod';

/** GET /notifications/upcoming (api-design.md §24.6). Defaults and the
 * range rules (to > from, at most 14 days) are applied by
 * resolveUpcomingWindow (src/domain/notifications.ts). */
export const upcomingNotificationsQuerySchema = z.object({
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
});
