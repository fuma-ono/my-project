import { useCallback, useEffect, useState } from 'react';
import * as Crypto from 'expo-crypto';

import { useT } from '../i18n';
import { supabase } from '../lib/supabase';
import type { Entry, EntryType, Profile } from '../types';

export function useGroupData(groupId: string | null, userId: string | null) {
  const t = useT();
  const [members, setMembers] = useState<Profile[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);

  const loadAll = useCallback(async () => {
    if (!groupId) return;
    setLoading(true);
    const [membersRes, entriesRes] = await Promise.all([
      supabase.from('group_members').select('profiles(id, display_name, avatar_emoji)').eq('group_id', groupId),
      supabase.from('entries').select('*').eq('group_id', groupId).order('created_at', { ascending: false }),
    ]);
    if (membersRes.data) {
      const list = membersRes.data
        .map((row) => (row as unknown as { profiles: Profile | null }).profiles)
        .filter((p): p is Profile => !!p);
      setMembers(list);
    }
    if (entriesRes.data) setEntries(entriesRes.data as Entry[]);
    setLoading(false);
  }, [groupId]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // 誰かが記録・精算・メンバー追加をすると、グループ内の全員の画面に
  // リアルタイムで反映されるようにする(Web版プロトタイプの体験を踏襲)。
  useEffect(() => {
    if (!groupId) return;
    const channel = supabase
      .channel(`group-${groupId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'entries', filter: `group_id=eq.${groupId}` },
        () => loadAll()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'group_members', filter: `group_id=eq.${groupId}` },
        () => loadAll()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [groupId, loadAll]);

  const addEntry = useCallback(
    async (input: {
      fromUser: string;
      toUser: string;
      type: EntryType;
      amount: number | null;
      currency: string | null;
      description: string;
      photoUri?: string | null;
    }) => {
      if (!groupId || !userId) return { error: t.auth.unauthenticated };
      const id = Crypto.randomUUID();
      let photoPath: string | null = null;

      if (input.photoUri) {
        try {
          const response = await fetch(input.photoUri);
          const arrayBuffer = await response.arrayBuffer();
          const path = `${groupId}/${id}.jpg`;
          const { error: uploadError } = await supabase.storage
            .from('receipts')
            .upload(path, arrayBuffer, { contentType: 'image/jpeg', upsert: true });
          if (uploadError) return { error: t.groupData.photoUploadFailed(uploadError.message) };
          photoPath = path;
        } catch {
          return { error: t.groupData.photoProcessFailed };
        }
      }

      const { error } = await supabase.from('entries').insert({
        id,
        group_id: groupId,
        from_user: input.fromUser,
        to_user: input.toUser,
        type: input.type,
        amount: input.amount,
        currency: input.currency,
        description: input.description || null,
        photo_path: photoPath,
        settled: false,
        created_by: userId,
      });
      if (error) return { error: error.message };
      await loadAll();
      return { error: null };
    },
    [groupId, userId, loadAll, t]
  );

  const toggleSettled = useCallback(
    async (entryId: string, settled: boolean) => {
      const { error } = await supabase.from('entries').update({ settled }).eq('id', entryId);
      if (!error) await loadAll();
      return { error: error?.message ?? null };
    },
    [loadAll]
  );

  const deleteEntry = useCallback(
    async (entryId: string) => {
      const { error } = await supabase.from('entries').delete().eq('id', entryId);
      if (!error) await loadAll();
      return { error: error?.message ?? null };
    },
    [loadAll]
  );

  const settlePair = useCallback(
    async (type: EntryType, a: string, b: string, currency: string | null) => {
      const ids = entries
        .filter((e) => {
          if (e.settled || e.type !== type) return false;
          if (type === 'money') {
            return (e.currency || 'JPY') === (currency || 'JPY') && ((e.from_user === a && e.to_user === b) || (e.from_user === b && e.to_user === a));
          }
          return e.from_user === a && e.to_user === b;
        })
        .map((e) => e.id);
      if (ids.length === 0) return { error: null };
      const { error } = await supabase.from('entries').update({ settled: true }).in('id', ids);
      if (!error) await loadAll();
      return { error: error?.message ?? null };
    },
    [entries, loadAll]
  );

  // 「自動精算」用: 通貨を指定して、その通貨の未精算のお金の記録を
  // まとめて精算済みにする。自動精算プランは各人の純増減だけを見て
  // 最小の支払い回数に組み直したものなので、そのプラン通りに全員が
  // 支払い終えた時点では、元になった個々の記録も(誰から誰への分かは
  // バラバラでも)全額分の受け渡しが完了している = 全部精算済みにして
  // 問題ない、という考え方。
  const settleAllMoney = useCallback(
    async (currency: string) => {
      if (!groupId) return { error: t.auth.unauthenticated };
      const { error } = await supabase
        .from('entries')
        .update({ settled: true })
        .eq('group_id', groupId)
        .eq('type', 'money')
        .eq('currency', currency)
        .eq('settled', false);
      if (!error) await loadAll();
      return { error: error?.message ?? null };
    },
    [groupId, loadAll, t]
  );

  return { members, entries, loading, refresh: loadAll, addEntry, toggleSettled, deleteEntry, settlePair, settleAllMoney };
}
