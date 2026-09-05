import { useCallback, useEffect, useState } from 'react';

import { supabase } from '../lib/supabase';
import type { Profile } from '../types';
import { prefetchSignedUrls } from './useSignedUrl';

// 「グループの設定でメンバーを削除できるように」という指摘への対応
// (89回目)。useGroupData.tsは残高・記録なども含む大きなフックで、
// グループ詳細画面(GroupScreen.tsx)専用に使っているため、グループの
// 設定画面(GroupSettingsScreen.tsx、App.tsx側で開く)向けに、メンバー
// 一覧だけを取得する軽量なフックを別に用意する。
export function useGroupMembers(groupId: string | null) {
  const [members, setMembers] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!groupId) return;
    setLoading(true);
    const { data } = await supabase
      .from('group_members')
      .select('profiles(id, display_name, avatar_emoji, avatar_photo_path)')
      .eq('group_id', groupId);
    if (data) {
      const list = data
        .map((row) => (row as unknown as { profiles: Profile | null }).profiles)
        .filter((p): p is Profile => !!p);
      setMembers(list);
      prefetchSignedUrls(
        'avatars',
        list.map((p) => p.avatar_photo_path)
      );
    }
    setLoading(false);
  }, [groupId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { members, loading, refresh };
}
