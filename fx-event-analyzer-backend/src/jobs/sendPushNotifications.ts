import 'dotenv/config';
import { loadEnv } from '../config/env.js';
import { createSupabaseClient } from '../db/supabaseClient.js';
import { createApnsSenderFromEnv } from '../push/apnsSender.js';
import { sendDuePushNotifications } from '../push/pushJobs.js';
import { createPushStore } from '../repositories/pushRepository.js';

/**
 * 送る時刻になったプッシュ通知を APNs に送る — HQ指示 2026-11-10、push-notifications-spec.md §5。
 *
 *   npm run jobs:send-push
 *
 * APNS_KEY_ID・APNS_TEAM_ID・APNS_PRIVATE_KEY(・APNS_BUNDLE_ID)がそろっていなければ、何も取り出さず・何も送らずに
 * APNS_NOT_CONFIGURED を出して Exit 0(認証情報が無いのは異常ではない)。定期実行には登録していない(HQ の承認の後)。
 */
async function main(): Promise<void> {
  const env = loadEnv();
  const sender = createApnsSenderFromEnv();
  try {
    const result = await sendDuePushNotifications({ store: createPushStore(createSupabaseClient(env)), sender });
    console.log(JSON.stringify({ job: 'jobs:send-push', ...result, at: new Date().toISOString() }));
    const realErrors = result.errors.filter((e) => e !== 'APNS_NOT_CONFIGURED');
    process.exitCode = realErrors.length > 0 ? 1 : 0;
  } finally {
    sender?.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
