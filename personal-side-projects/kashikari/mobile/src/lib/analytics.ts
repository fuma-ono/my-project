import { supabase } from './supabase';

// 成長施策(招待→参加→精算)の効果を追うための、ごく最小限のイベント
// ログ。集計方法はsupabase/schema.sqlのコメントを参照。
//
// 「検証施策」で「利用状況」ダッシュボードに合わせてイベント名を整理
// した(invite_link_generated→invite_sent、group_joined→invite_joined、
// entry_marked_paid→marked_paid、entry_marked_received→marked_confirmed)。
// event_typeはDB側では単なるtext列(enum制約なし)のため、この変更は
// 今後記録される行にのみ適用され、既存データを移行するものではない。
//
// 94回目: PremiumScreenの「興味がある」ボタンを実際の購入ボタンに
// 置き換えたのに合わせ、premium_interest(興味表明)→premium_purchased
// (購入完了)に変更。同じ理由で既存データの移行は不要。
export type AnalyticsEvent =
  | 'group_created'
  | 'invite_sent'
  | 'invite_link_clicked'
  | 'invite_joined'
  | 'entry_created'
  | 'reminder_sent'
  | 'marked_paid'
  | 'marked_confirmed'
  | 'settlement_completed'
  | 'premium_view'
  | 'premium_purchased';

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

// 「利用状況」ダッシュボード用。event_typeごとの件数だけを返す
// get_usage_stats() RPC(個々の行は見えない集計専用の窓口)を呼び、
// 扱いやすい { イベント名: 件数 } の形にする。指定したevent_typeが
// 1件も無ければ0を返す(呼び出し側でundefinedを気にしなくてよいように)。
export async function getUsageStats(): Promise<Record<AnalyticsEvent, number>> {
  const zeroed = {
    group_created: 0,
    invite_sent: 0,
    invite_link_clicked: 0,
    invite_joined: 0,
    entry_created: 0,
    reminder_sent: 0,
    marked_paid: 0,
    marked_confirmed: 0,
    settlement_completed: 0,
    premium_view: 0,
    premium_purchased: 0,
  } as Record<AnalyticsEvent, number>;

  const { data, error } = await supabase.rpc('get_usage_stats');
  if (error || !data) return zeroed;

  for (const row of data as { event_type: string; event_count: number | string }[]) {
    if (row.event_type in zeroed) {
      zeroed[row.event_type as AnalyticsEvent] = Number(row.event_count);
    }
  }
  return zeroed;
}
