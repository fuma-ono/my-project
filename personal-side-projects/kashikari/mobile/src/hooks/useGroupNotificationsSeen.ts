import { useCallback, useEffect, useState } from 'react';

import { supabase } from '../lib/supabase';

// 「グループ内の通知は、そのグループのみを表示するようにした方がいい」
// という指摘への対応(87回目)。useAuth.tsのmarkNotificationsSeenは
// profiles.notifications_seen_at(全グループ共通、ホーム画面のベル用)
// 1つだけを更新する仕組みだったが、それをグループ詳細画面のベルにも
// そのまま使うと、1つのグループの通知を見ただけで他のグループの未読も
// 一緒に消えてしまう(単一の既読時刻をグループ横断で共有しているため)。
// これを避けるため、グループごとの既読時刻(group_members.
// notifications_seen_at)を別途ここで管理する。
export function useGroupNotificationsSeen(userId: string | null) {
  // group_id -> 既読時刻(ISO文字列)のマップ。
  const [seenAtByGroup, setSeenAtByGroup] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    if (!userId) return;
    const { data } = await supabase.from('group_members').select('group_id, notifications_seen_at').eq('user_id', userId);
    if (data) {
      const map: Record<string, string> = {};
      for (const row of data as { group_id: string; notifications_seen_at: string }[]) {
        map[row.group_id] = row.notifications_seen_at;
      }
      setSeenAtByGroup(map);
    }
  }, [userId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // markNotificationsSeen(useAuth.ts)と同じく、楽観的に即座にベルの
  // 表示へ反映する(サーバーの応答を待たない)。
  const markGroupSeen = useCallback(async (groupId: string) => {
    const now = new Date().toISOString();
    setSeenAtByGroup((prev) => ({ ...prev, [groupId]: now }));
    await supabase.rpc('mark_group_notifications_seen', { _group_id: groupId });
  }, []);

  // まだ一度もrefreshできていない(このグループの行が読み込まれる前)
  // 場合は「今」を既定にし、未読が実際より多く出るのを避ける
  // (group_membersのnotifications_seen_atのデフォルト値と同じ考え方)。
  const seenAtFor = useCallback((groupId: string) => seenAtByGroup[groupId] ?? new Date().toISOString(), [seenAtByGroup]);

  return { seenAtFor, markGroupSeen };
}
