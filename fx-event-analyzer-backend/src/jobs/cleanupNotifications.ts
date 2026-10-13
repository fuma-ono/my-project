import 'dotenv/config';
import { loadEnv } from '../config/env.js';
import { createSupabaseClient } from '../db/supabaseClient.js';
import { deleteAllExpiredInboxNotifications } from '../repositories/notificationInboxRepository.js';

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
 */
async function main(): Promise<void> {
  const env = loadEnv();
  const deleted = await deleteAllExpiredInboxNotifications(createSupabaseClient(env));
  console.log(JSON.stringify({ job: 'cleanup-notifications', deleted, at: new Date().toISOString() }));
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({ job: 'cleanup-notifications', error: String(error) }));
  process.exit(1);
});
