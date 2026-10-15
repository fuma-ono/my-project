import 'dotenv/config';
import { loadEnv } from '../config/env.js';
import { createSupabaseClient } from '../db/supabaseClient.js';
import { NOTIFICATION_RETENTION_DAYS } from '../domain/notificationInbox.js';
import { deleteAllExpiredInboxNotifications } from '../repositories/notificationInboxRepository.js';
import { deleteScheduleChangesBefore } from '../repositories/scheduleChangesRepository.js';

/**
 * Daily expiry job for the in-app notification inbox (notification-inbox-spec.md
 * §6, api-design.md §24.9): deletes every user's notification_inbox rows with
 * expires_at <= now() via delete_expired_notification_inbox().
 *
 *   npm run jobs:cleanup-notifications          # from source (tsx)
 *   node dist/jobs/cleanupNotifications.js      # after `npm run build`
 *
 * Reads SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY from the environment (or
 * .env) like the server. Exit code 0 on success, 1 on failure — cron-friendly.
 * GET /notifications also deletes the caller's expired rows, so this only
 * keeps the table from growing for users who stop opening the app.
 *
 * Also drops event_schedule_changes older than the CALENDAR_UPDATE
 * retention (7 days) — GET /notifications never looks further back.
 */
async function main(): Promise<void> {
  const env = loadEnv();
  const supabase = createSupabaseClient(env);
  const deleted = await deleteAllExpiredInboxNotifications(supabase);
  const scheduleChangesBefore = new Date(Date.now() - NOTIFICATION_RETENTION_DAYS.CALENDAR_UPDATE * 86_400_000);
  const scheduleChangesDeleted = await deleteScheduleChangesBefore(supabase, scheduleChangesBefore.toISOString());
  console.log(
    JSON.stringify({
      job: 'cleanup-notifications',
      deleted,
      schedule_changes_deleted: scheduleChangesDeleted,
      at: new Date().toISOString(),
    }),
  );
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({ job: 'cleanup-notifications', error: String(error) }));
  process.exit(1);
});
