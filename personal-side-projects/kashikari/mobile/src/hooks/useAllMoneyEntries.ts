import { useCallback, useEffect, useState } from 'react';

import { supabase } from '../lib/supabase';
import type { Entry } from '../types';

// 会計レポート(96回目)用。グループ横断で「自分が関わるお金の記録」だけを
// 取得する軽量なフック。group_idを絞らずに問い合わせるが、entriesの
// RLS(「グループのメンバーだけが見える」)がテーブル側で常に効くため、
// 参加していないグループのデータが混ざる心配はない。
export function useAllMoneyEntries(userId: string | null) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!userId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data } = await supabase
      .from('entries')
      .select('*')
      .eq('type', 'money')
      .or(`from_user.eq.${userId},to_user.eq.${userId}`);
    if (data) setEntries(data as Entry[]);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { entries, loading, refresh };
}
