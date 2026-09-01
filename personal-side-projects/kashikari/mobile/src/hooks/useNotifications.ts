import { useCallback, useEffect, useState } from 'react';

import { supabase } from '../lib/supabase';
import type { NotificationLogItem } from '../types';

// 通知ページ(通知ベルから開く)用。send-pushが書き込むnotification_log
// を自分宛の分だけ読む(RLSで自分の行しか見えない)。新しい通知が届いた
// ら画面を開き直さなくても反映されるよう、他の一覧系フック
// (useGroupData等)と同じくRealtimeでも購読する。
export function useNotifications(userId: string | null) {
  const [items, setItems] = useState<NotificationLogItem[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    const { data } = await supabase
      .from('notification_log')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);
    if (data) setItems(data as NotificationLogItem[]);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`notification-log-${userId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notification_log', filter: `user_id=eq.${userId}` },
        () => refresh()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, refresh]);

  return { items, loading, refresh };
}
