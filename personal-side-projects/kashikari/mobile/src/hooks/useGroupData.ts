import { useCallback, useEffect, useState } from 'react';
import * as Crypto from 'expo-crypto';

import { useT } from '../i18n';
import { supabase } from '../lib/supabase';
import { splitAmount } from '../lib/split';
import type { Entry, EntryType, Profile } from '../types';
import type { Strings } from '../i18n/strings';

// addEntry・addSplitEntryの両方で使う、レシート画像アップロードの共通処理。
// 割り勘は複数のentries行を1枚の同じ画像で共有するため、パスをid単位で
// 呼び出し側から渡してもらう形にしている。
async function uploadReceipt(
  groupId: string,
  photoUri: string,
  t: Strings
): Promise<{ path: string | null; error: string | null }> {
  try {
    const response = await fetch(photoUri);
    const arrayBuffer = await response.arrayBuffer();
    const path = `${groupId}/${Crypto.randomUUID()}.jpg`;
    const { error: uploadError } = await supabase.storage
      .from('receipts')
      .upload(path, arrayBuffer, { contentType: 'image/jpeg', upsert: true });
    if (uploadError) return { path: null, error: t.groupData.photoUploadFailed(uploadError.message) };
    return { path, error: null };
  } catch {
    return { path: null, error: t.groupData.photoProcessFailed };
  }
}

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
      let photoPath: string | null = null;

      if (input.photoUri) {
        const res = await uploadReceipt(groupId, input.photoUri, t);
        if (res.error) return { error: res.error };
        photoPath = res.path;
      }

      const { error } = await supabase.from('entries').insert({
        id: Crypto.randomUUID(),
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

  // 割り勘: 支払った人以外の各参加者について、1件ずつmoneyのentriesを
  // 作る(支払った人自身の取り分はentriesにする必要がない=自分に借りは
  // 発生しないため)。スキーマは変更せず、既存のentriesの複数行として
  // 表現するだけなので、残高計算・自動精算・台帳表示は何も変更しなくても
  // そのまま正しく機能する。
  const addSplitEntry = useCallback(
    async (input: {
      payer: string;
      participantIds: string[]; // 支払った人自身を含めてよい(その場合その人の分は自動的に除かれる)
      totalAmount: number;
      currency: string;
      description: string;
      photoUri?: string | null;
    }) => {
      if (!groupId || !userId) return { error: t.auth.unauthenticated };
      const others = input.participantIds.filter((id) => id !== input.payer);
      if (others.length === 0) return { error: t.addEntry.splitNeedOthersError };

      let photoPath: string | null = null;
      if (input.photoUri) {
        const res = await uploadReceipt(groupId, input.photoUri, t);
        if (res.error) return { error: res.error };
        photoPath = res.path;
      }

      const shares = splitAmount(input.totalAmount, input.participantIds.length, input.currency);
      const rows = others.map((id) => ({
        id: Crypto.randomUUID(),
        group_id: groupId,
        from_user: input.payer,
        to_user: id,
        type: 'money' as const,
        amount: shares[input.participantIds.indexOf(id)],
        currency: input.currency,
        description: input.description || null,
        photo_path: photoPath,
        settled: false,
        created_by: userId,
      }));

      const { error } = await supabase.from('entries').insert(rows);
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

  return { members, entries, loading, refresh: loadAll, addEntry, addSplitEntry, toggleSettled, deleteEntry, settlePair, settleAllMoney };
}
