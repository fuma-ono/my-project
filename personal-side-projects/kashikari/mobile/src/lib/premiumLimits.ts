// 「履歴の無制限保存」をPremium特典にするための、無料ユーザー側の
// 制限値(94回目)。記録データ自体は消えない(サーバー側は常に全期間を
// 保持する)。あくまで履歴タブでの表示範囲だけを絞る、という「見た目上の
// 制限」なので、Supabase側のスキーマ変更・RLS変更は不要。
export const FREE_HISTORY_MONTHS = 3;

export function freeHistoryCutoffIso(now: Date = new Date()): string {
  const cutoff = new Date(now);
  cutoff.setMonth(cutoff.getMonth() - FREE_HISTORY_MONTHS);
  return cutoff.toISOString();
}

// dateIsoが無料プランで見られる範囲(直近FREE_HISTORY_MONTHSヶ月)に
// 収まっているかどうか。
export function isWithinFreeHistoryWindow(dateIso: string, now: Date = new Date()): boolean {
  return dateIso >= freeHistoryCutoffIso(now);
}
