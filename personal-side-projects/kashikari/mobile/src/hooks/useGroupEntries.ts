import { useCallback, useEffect, useState } from 'react';

import { supabase } from '../lib/supabase';
import type { Entry } from '../types';

// CSV出力(94回目)用。useGroupMembers.tsと同じ理由で、useGroupData.ts
// (残高計算・記録の追加/精算操作まで含む大きなフック)をグループの
// 設定画面(App.tsx側で開く、GroupScreen.tsxとは別コンポーネント)の
// ためだけに丸ごと使うのは大げさなため、記録の一覧取得だけを行う
// 軽量なフックを別に用意する。
export function useGroupEntries(groupId: string | null) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!groupId) return;
    setLoading(true);
    const { data } = await supabase.from('entries').select('*').eq('group_id', groupId).order('created_at', { ascending: false });
    if (data) setEntries(data as Entry[]);
    setLoading(false);
  }, [groupId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { entries, loading, refresh };
}
