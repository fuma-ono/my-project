import { useCallback, useEffect, useState } from 'react';

import { supabase } from '../lib/supabase';
import type { Group } from '../types';

export function useGroups(userId: string | null) {
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    // RLSにより、自分が参加しているグループしか返ってこない。
    const { data, error } = await supabase.from('groups').select('*').order('created_at', { ascending: false });
    if (!error && data) setGroups(data);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const createGroup = useCallback(
    async (name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return { error: 'グループ名を入力してください', group: null };
      const { data, error } = await supabase.rpc('create_group', { _name: trimmed });
      if (error) return { error: error.message, group: null };
      await refresh();
      return { error: null, group: data as Group };
    },
    [refresh]
  );

  const joinGroup = useCallback(
    async (inviteCode: string) => {
      const trimmed = inviteCode.trim();
      if (!trimmed) return { error: '招待コードを入力してください', group: null };
      const { data, error } = await supabase.rpc('join_group', { _invite_code: trimmed });
      if (error) return { error: error.message, group: null };
      await refresh();
      return { error: null, group: data as Group };
    },
    [refresh]
  );

  return { groups, loading, refresh, createGroup, joinGroup };
}
