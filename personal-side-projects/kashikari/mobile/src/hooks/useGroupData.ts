import { useCallback, useEffect, useState } from 'react';
import * as Crypto from 'expo-crypto';

import { useT } from '../i18n';
import { logEvent } from '../lib/analytics';
import { entryFromKey, entryToKey } from '../lib/balances';
import { notifyGroup } from '../lib/pushNotifications';
import { supabase } from '../lib/supabase';
import { splitAmount } from '../lib/split';
import type { Entry, EntryType, GroupInvite, Profile } from '../types';
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
  const [invites, setInvites] = useState<GroupInvite[]>([]);
  const [loading, setLoading] = useState(true);

  const loadAll = useCallback(async () => {
    if (!groupId) return;
    setLoading(true);
    const [membersRes, entriesRes, invitesRes] = await Promise.all([
      supabase.from('group_members').select('profiles(id, display_name, avatar_emoji)').eq('group_id', groupId),
      supabase.from('entries').select('*').eq('group_id', groupId).order('created_at', { ascending: false }),
      supabase.from('group_invites').select('*').eq('group_id', groupId).order('created_at', { ascending: true }),
    ]);
    if (membersRes.data) {
      const list = membersRes.data
        .map((row) => (row as unknown as { profiles: Profile | null }).profiles)
        .filter((p): p is Profile => !!p);
      setMembers(list);
    }
    if (entriesRes.data) setEntries(entriesRes.data as Entry[]);
    if (invitesRes.data) setInvites(invitesRes.data as GroupInvite[]);
    setLoading(false);
  }, [groupId]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // 「招待した相手が参加する前でも記録できる」対応。呼び出し側(AddEntrySheet)
  // からは実メンバーIDと招待中の相手のID(group_invites.id)を区別なく1つの
  // 文字列で受け取るため、実際にどちらのカラムに入れるべきかをここで
  // membersと突き合わせて判定する。
  const personColumns = useCallback(
    (id: string, prefix: 'from' | 'to') => {
      const isMember = members.some((m) => m.id === id);
      return isMember ? { [`${prefix}_user`]: id, [`${prefix}_invite`]: null } : { [`${prefix}_user`]: null, [`${prefix}_invite`]: id };
    },
    [members]
  );

  // 誰かが記録・精算・メンバー追加・招待をすると、グループ内の全員の画面に
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
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'group_invites', filter: `group_id=eq.${groupId}` },
        () => loadAll()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [groupId, loadAll]);

  // 友達を招待: 「招待中」一覧に名前で出すための1件を作る。実際の招待URL
  // 共有(Share.share)は呼び出し側(GroupScreen)が行う。
  const inviteMember = useCallback(
    async (invitedName: string) => {
      if (!groupId) return { error: t.auth.unauthenticated };
      const { error } = await supabase.rpc('create_group_invite', { _group_id: groupId, _invited_name: invitedName });
      if (error) return { error: error.message };
      logEvent('invite_sent', { userId, groupId });
      await loadAll();
      return { error: null };
    },
    [groupId, userId, loadAll, t]
  );

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
        ...personColumns(input.fromUser, 'from'),
        ...personColumns(input.toUser, 'to'),
        type: input.type,
        amount: input.amount,
        currency: input.currency,
        description: input.description || null,
        photo_path: photoPath,
        created_by: userId,
      });
      if (error) return { error: error.message };
      logEvent('entry_created', { userId, groupId });
      void notifyGroup({
        groupId,
        kind: 'entry_created',
        recipientIds: members.filter((m) => m.id !== userId).map((m) => m.id),
        amount: input.amount,
        currency: input.currency,
        description: input.description || null,
      });
      await loadAll();
      return { error: null };
    },
    [groupId, userId, loadAll, t, personColumns, members]
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
        ...personColumns(input.payer, 'from'),
        ...personColumns(id, 'to'),
        type: 'money' as const,
        amount: shares[input.participantIds.indexOf(id)],
        currency: input.currency,
        description: input.description || null,
        photo_path: photoPath,
        created_by: userId,
      }));

      const { error } = await supabase.from('entries').insert(rows);
      if (error) return { error: error.message };
      // 割り勘は1回の操作でrows.length件のentriesが作られるため、
      // 「貸し借り登録数」の集計と揃うよう作られた件数分だけ記録する。
      for (let i = 0; i < rows.length; i++) logEvent('entry_created', { userId, groupId });
      // 通知は1回の操作につき1回でよい(rows.length件分送る必要はない)。
      void notifyGroup({
        groupId,
        kind: 'entry_created',
        recipientIds: members.filter((m) => m.id !== userId).map((m) => m.id),
        amount: input.totalAmount,
        currency: input.currency,
        description: input.description || null,
      });
      await loadAll();
      return { error: null };
    },
    [groupId, userId, loadAll, t, personColumns, members]
  );

  // 台帳側の「精算済みにする/未精算に戻す」(1件単位の手動オーバーライド)。
  // 支払った→受け取ったの2段階を経由せず、confirmed⇄unpaidを直接行き来する。
  const toggleSettled = useCallback(
    async (entryId: string, status: 'unpaid' | 'confirmed') => {
      const patch =
        status === 'confirmed'
          ? { settle_status: 'confirmed', confirmed_at: new Date().toISOString() }
          : { settle_status: 'unpaid', paid_at: null, confirmed_at: null };
      const { error } = await supabase.from('entries').update(patch).eq('id', entryId);
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

  // 頼みごと専用: 「支払う/受け取る」という概念が無いため、従来通り
  // 一括で直接confirmedにする(お金の2段階確認とは別ルート)。
  const settlePair = useCallback(
    async (type: EntryType, a: string, b: string, currency: string | null) => {
      const ids = entries
        .filter((e) => {
          if (e.settle_status === 'confirmed' || e.type !== type) return false;
          if (type === 'money') {
            return (
              (e.currency || 'JPY') === (currency || 'JPY') &&
              ((entryFromKey(e) === a && entryToKey(e) === b) || (entryFromKey(e) === b && entryToKey(e) === a))
            );
          }
          return entryFromKey(e) === a && entryToKey(e) === b;
        })
        .map((e) => e.id);
      if (ids.length === 0) return { error: null };
      const { error } = await supabase
        .from('entries')
        .update({ settle_status: 'confirmed', confirmed_at: new Date().toISOString() })
        .in('id', ids);
      if (!error) await loadAll();
      return { error: error?.message ?? null };
    },
    [entries, loadAll]
  );

  // お金の「支払った」: 支払う側が押す。対象ペア×通貨のunpaidな記録を
  // まとめてpaidにする(受け取る側の確認待ちになる)。
  const markPaid = useCallback(
    async (a: string, b: string, currency: string | null) => {
      const ids = entries
        .filter(
          (e) =>
            e.type === 'money' &&
            e.settle_status === 'unpaid' &&
            (e.currency || 'JPY') === (currency || 'JPY') &&
            ((entryFromKey(e) === a && entryToKey(e) === b) || (entryFromKey(e) === b && entryToKey(e) === a))
        )
        .map((e) => e.id);
      if (ids.length === 0) return { error: null };
      const { error } = await supabase
        .from('entries')
        .update({ settle_status: 'paid', paid_at: new Date().toISOString() })
        .in('id', ids);
      if (!error) {
        logEvent('marked_paid', { userId, groupId });
        // 呼び出し元(GroupScreen)は常にmarkPaid(debtor, creditor, ...)の
        // 順で呼ぶ規約になっている(支払う側=debtor=自分が押す操作なので、
        // 通知したい相手は必ずb=creditor)。
        if (groupId) void notifyGroup({ groupId, kind: 'marked_paid', recipientIds: [b] });
        await loadAll();
      }
      return { error: error?.message ?? null };
    },
    [entries, loadAll, groupId, userId]
  );

  // お金の「受け取った」: 受け取る側が押す。対象ペア×通貨のpaidな記録を
  // まとめてconfirmedにする(双方確認済み=完了)。
  const confirmReceived = useCallback(
    async (a: string, b: string, currency: string | null) => {
      const ids = entries
        .filter(
          (e) =>
            e.type === 'money' &&
            e.settle_status === 'paid' &&
            (e.currency || 'JPY') === (currency || 'JPY') &&
            ((entryFromKey(e) === a && entryToKey(e) === b) || (entryFromKey(e) === b && entryToKey(e) === a))
        )
        .map((e) => e.id);
      if (ids.length === 0) return { error: null };
      const { error } = await supabase
        .from('entries')
        .update({ settle_status: 'confirmed', confirmed_at: new Date().toISOString() })
        .in('id', ids);
      if (!error) {
        logEvent('marked_confirmed', { userId, groupId });
        // 呼び出し元(GroupScreen)は常にconfirmReceived(debtor, creditor,
        // ...)の順で呼ぶ規約になっている(受け取る側=creditor=自分が
        // 押す操作なので、通知したい相手は必ずa=debtor)。
        if (groupId) void notifyGroup({ groupId, kind: 'marked_confirmed', recipientIds: [a] });
        await loadAll();
      }
      return { error: error?.message ?? null };
    },
    [entries, loadAll, groupId, userId]
  );

  // 「自動精算」用: 通貨を指定して、その通貨の未精算のお金の記録を
  // まとめて精算済みにする。自動精算プランは各人の純増減だけを見て
  // 最小の支払い回数に組み直したものなので、そのプラン通りに全員が
  // 支払い終えた時点では、元になった個々の記録も(誰から誰への分かは
  // バラバラでも)全額分の受け渡しが完了している = 全部精算済みにして
  // 問題ない、という考え方(支払った→受け取ったの2段階はスキップする
  // ショートカット)。
  const settleAllMoney = useCallback(
    async (currency: string) => {
      if (!groupId) return { error: t.auth.unauthenticated };
      const { error } = await supabase
        .from('entries')
        .update({ settle_status: 'confirmed', confirmed_at: new Date().toISOString() })
        .eq('group_id', groupId)
        .eq('type', 'money')
        .eq('currency', currency)
        .neq('settle_status', 'confirmed');
      if (!error) await loadAll();
      return { error: error?.message ?? null };
    },
    [groupId, loadAll, t]
  );

  return {
    members,
    entries,
    invites,
    loading,
    refresh: loadAll,
    addEntry,
    addSplitEntry,
    toggleSettled,
    deleteEntry,
    settlePair,
    settleAllMoney,
    markPaid,
    confirmReceived,
    inviteMember,
  };
}
