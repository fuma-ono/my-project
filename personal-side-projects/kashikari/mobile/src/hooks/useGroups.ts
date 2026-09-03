import { useCallback, useEffect, useState } from 'react';

import { useT } from '../i18n';
import { logEvent } from '../lib/analytics';
import { uploadIconPhoto } from '../lib/iconPhoto';
import { notifyGroup } from '../lib/pushNotifications';
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
      logEvent('invite_joined', { userId, groupId: group.id });
      await refresh();
      return { error: null, group };
    },
    [refresh, t, userId]
  );

  const leaveGroup = useCallback(
    async (groupId: string) => {
      // 「グループを抜けたら相手に通知は行くのか?」という指摘への対応。
      // これまでは何も通知していなかった(退出したことに他のメンバーが
      // 気づけない)。send-push Edge Function側は「呼び出したユーザー
      // 自身がそのグループのメンバーであること」をRLS経由で検証するため、
      // leave_groupで自分を抜けさせた後では検証に失敗し送れなくなる。
      // 必ず抜ける前に、残りのメンバーIDを集めてから通知を送る。
      // 通知(Edge Function呼び出し)がleave_groupのRPCと同時並行で走ると、
      // 先にleave_groupの方が完了した場合にメンバーシップ検証で弾かれて
      // しまう恐れがあるため、ここは(他の呼び出し箇所と違い)結果を待つ。
      const { data: members } = await supabase.from('group_members').select('user_id').eq('group_id', groupId);
      const recipientIds = (members ?? []).map((m) => m.user_id as string).filter((id) => id !== userId);
      if (recipientIds.length > 0) await notifyGroup({ groupId, kind: 'left_group', recipientIds });

      const { error } = await supabase.rpc('leave_group', { _group_id: groupId });
      if (error) return { error: error.message };
      await refresh();
      return { error: null };
    },
    [refresh, userId]
  );

  const updateGroupIcon = useCallback(
    async (groupId: string, iconEmoji: string) => {
      // 写真とは排他のため、絵文字を選んだらicon_photo_pathをRPC側で
      // 明示的にクリアする(_icon_photo_pathを渡さない=デフォルトのnull)。
      const { error } = await supabase.rpc('update_group_icon', { _group_id: groupId, _icon_emoji: iconEmoji });
      if (error) return { error: error.message };
      await refresh();
      return { error: null };
    },
    [refresh]
  );

  // 「グループ内の設定ボタンを押したら、グループの設定(アイコンや
  // グループ名など)を変更できるようにした方がいい」という指摘への
  // 対応(86回目)。updateGroupIconと同じパターン。
  const updateGroupName = useCallback(
    async (groupId: string, name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return { error: t.groupsHook.nameRequired };
      const { error } = await supabase.rpc('update_group_name', { _group_id: groupId, _name: trimmed });
      if (error) return { error: error.message };
      await refresh();
      return { error: null };
    },
    [refresh, t]
  );

  // 「グループのアイコンも写真を選べるように」への対応。
  const updateGroupIconPhoto = useCallback(
    async (groupId: string, photoUri: string) => {
      const uploadRes = await uploadIconPhoto('groups', groupId, photoUri, t);
      if (uploadRes.error) return { error: uploadRes.error };
      const { error } = await supabase.rpc('update_group_icon', {
        _group_id: groupId,
        _icon_emoji: null,
        _icon_photo_path: uploadRes.path,
      });
      if (error) return { error: error.message };
      await refresh();
      return { error: null };
    },
    [refresh, t]
  );

  return { groups, loading, refresh, createGroup, joinGroup, leaveGroup, updateGroupIcon, updateGroupIconPhoto, updateGroupName };
}
