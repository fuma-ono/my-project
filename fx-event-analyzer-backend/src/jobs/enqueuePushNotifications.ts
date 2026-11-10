import 'dotenv/config';
import { loadEnv } from '../config/env.js';
import { createSupabaseClient } from '../db/supabaseClient.js';
import { enqueuePushNotifications } from '../push/pushJobs.js';
import { createPushStore } from '../repositories/pushRepository.js';

/**
 * プッシュ通知の予定を作る(push_notifications に PENDING の行)— HQ指示 2026-11-10、push-notifications-spec.md §4。
 *
 *   npm run jobs:enqueue-push
 *
 * 何度動かしても同じ予定は1件だけ(DB の unique)。APNs には触れない。定期実行には登録していない(HQ の承認の後)。Exit 0 / 1。
 */
async function main(): Promise<void> {
  const env = loadEnv();
  const result = await enqueuePushNotifications({ store: createPushStore(createSupabaseClient(env)) });
  console.log(JSON.stringify({ job: 'jobs:enqueue-push', ...result, at: new Date().toISOString() }));
  process.exitCode = result.errors.length > 0 ? 1 : 0;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
