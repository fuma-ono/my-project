import { supabase } from './supabase';

// 成長施策(招待→参加→精算)の効果を追うための、ごく最小限のイベント
// ログ。集計方法はsupabase/schema.sqlのコメントを参照。
export type AnalyticsEvent =
  | 'group_created'
  | 'invite_link_generated'
  | 'invite_link_clicked'
  | 'group_joined'
  | 'settlement_completed';

// 計測はあくまで補助情報であり、失敗してもアプリ本来の操作を絶対に
// 止めてはいけないため、fire-and-forgetにする(呼び出し側でawaitしない)。
export function logEvent(event: AnalyticsEvent, opts: { userId?: string | null; groupId?: string | null } = {}) {
  (async () => {
    try {
      await supabase.from('analytics_events').insert({
        event_type: event,
        user_id: opts.userId ?? null,
        group_id: opts.groupId ?? null,
      });
    } catch {
      // 計測失敗は握りつぶす
    }
  })();
}
