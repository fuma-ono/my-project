import 'dotenv/config';
import { loadEnv } from '../config/env.js';
import { createSupabaseClient } from '../db/supabaseClient.js';
import { cleanupPushNotifications, createPushStore, getPushQueueStats } from '../repositories/pushRepository.js';

/**
 * プッシュ通知のキューの運用(HQ指示 2026-11-10「障害復旧・信頼性強化」④、push-notifications-spec.md §5.4):
 *   1. 期限を過ぎた PENDING を SKIPPED EXPIRED にする(APNs が未設定でも)
 *   2. 古い行を消す(終わった行は 30 日、FAILED は 90 日残す。送信の記録は一緒に消える)
 *   3. 集計を出す(滞留・止まった送信・状態ごとの件数・送信の記録の結果ごとの件数・成功率。直近24時間)
 *
 *   npm run jobs:push-maintenance
 *
 * 定期実行には登録していない(HQ の承認の後)。Exit 0 / 1。
 */
async function main(): Promise<void> {
  const env = loadEnv();
  const supabase = createSupabaseClient(env);
  const expired = await createPushStore(supabase).expireOverdue();
  const deleted = await cleanupPushNotifications(supabase);
  const stats = await getPushQueueStats(supabase, new Date(Date.now() - 86_400_000).toISOString());
  console.log(JSON.stringify({ job: 'jobs:push-maintenance', expired, deleted, stats, at: new Date().toISOString() }));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
