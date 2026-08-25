import { useCallback, useEffect, useState } from 'react';

import { useT } from '../i18n';
import { logEvent } from '../lib/analytics';
import { supabase } from '../lib/supabase';
import type { Group } from '../types';

export function useGroups(userId: string | null) {
  const t = useT();
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
    async (name: string, iconEmoji: string | null = null) => {
      const trimmed = name.trim();
      if (!trimmed) return { error: t.groupsHook.nameRequired, group: null };
      const { data, error } = await supabase.rpc('create_group', { _name: trimmed, _icon_emoji: iconEmoji });
      if (error) return { error: error.message, group: null };
      const group = data as Group;
      logEvent('group_created', { userId, groupId: group.id });
      await refresh();
      return { error: null, group };
    },
    [refresh, t, userId]
  );

  const joinGroup = useCallback(
    async (inviteCode: string) => {
      const trimmed = inviteCode.trim();
      if (!trimmed) return { error: t.groupsHook.codeRequired, group: null };
      const { data, error } = await supabase.rpc('join_group', { _invite_code: trimmed });
      if (error) return { error: error.message, group: null };
      const group = data as Group;
      logEvent('group_joined', { userId, groupId: group.id });
      await refresh();
      return { error: null, group };
    },
    [refresh, t, userId]
  );

  const leaveGroup = useCallback(
    async (groupId: string) => {
      const { error } = await supabase.rpc('leave_group', { _group_id: groupId });
      if (error) return { error: error.message };
      await refresh();
      return { error: null };
    },
    [refresh]
  );

  const updateGroupIcon = useCallback(
    async (groupId: string, iconEmoji: string) => {
      const { error } = await supabase.rpc('update_group_icon', { _group_id: groupId, _icon_emoji: iconEmoji });
      if (error) return { error: error.message };
      await refresh();
      return { error: null };
    },
    [refresh]
  );

  return { groups, loading, refresh, createGroup, joinGroup, leaveGroup, updateGroupIcon };
}
