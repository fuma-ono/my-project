import { useCallback, useEffect, useState } from 'react';

import { supabase } from '../lib/supabase';
import type { GroupDues } from '../types';

// サークル会計(97回目)。useGroupMembers.ts/useGroupEntries.tsと同じ
// 理由で、グループの設定画面向けに会費設定だけを取得する軽量なフック。
// 会費が設定されていないグループでは0件(dues=null)になる。
export function useGroupDues(groupId: string | null) {
  const [dues, setDues] = useState<GroupDues | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!groupId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data } = await supabase.from('group_dues').select('*').eq('group_id', groupId).maybeSingle();
    setDues((data as GroupDues | null) ?? null);
    setLoading(false);
  }, [groupId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { dues, loading, refresh };
}
