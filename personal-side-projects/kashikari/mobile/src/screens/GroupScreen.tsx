import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { Alert, Pressable, RefreshControl, SectionList, Share, StyleSheet, Text, View } from 'react-native';

import AddEntrySheet from '../components/AddEntrySheet';
import AutoSettlePlan from '../components/AutoSettlePlan';
import Avatar from '../components/Avatar';
import AvatarPicker from '../components/AvatarPicker';
import BalanceCard from '../components/BalanceCard';
import BottomTabBar, { type GroupTab } from '../components/BottomTabBar';
import EntryRow from '../components/EntryRow';
import Fab from '../components/Fab';
import GroupIconPicker from '../components/GroupIconPicker';
import HistoryEntryRow from '../components/HistoryEntryRow';
import InviteModal from '../components/InviteModal';
import Mark from '../components/Mark';
import NetSummary from '../components/NetSummary';
import SettlementProgress from '../components/SettlementProgress';
import UnpaidMembersModal from '../components/UnpaidMembersModal';
import { useGroupData } from '../hooks/useGroupData';
import { useT } from '../i18n';
import { logEvent } from '../lib/analytics';
import { computeBalances, computeMyNet, computeSimplifiedSettlement } from '../lib/balances';
import { groupEntriesByDate } from '../lib/dateGroups';
import { buildInviteUrl } from '../lib/invite';
import { colors, fonts } from '../theme';
import type { BalanceRow, Group, SimplifiedTransaction } from '../types';

type Tab = GroupTab;

type Props = {
  group: Group;
  meId: string | null;
  justCreated?: boolean; // グループ作成直後に開かれた場合、招待導線を1回だけ出す
  onBack: () => void;
  onLeave: (groupId: string) => Promise<{ error: string | null }>;
  onChangeAvatar: (emoji: string) => Promise<{ error: string | null }>;
  onChangeGroupIcon: (emoji: string) => Promise<{ error: string | null }>;
  onOpenSettings: () => void;
};

export default function GroupScreen({ group, meId, justCreated, onBack, onLeave, onChangeAvatar, onChangeGroupIcon, onOpenSettings }: Props) {
  const t = useT();
  const {
    members,
    entries,
    invites,
    loading,
    refresh,
    addEntry,
    addSplitEntry,
    toggleSettled,
    deleteEntry,
    settlePair,
    settleAllMoney,
    markPaid,
    confirmReceived,
    inviteMember,
  } = useGroupData(group.id, meId);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [avatarPickerOpen, setAvatarPickerOpen] = useState(false);
  const [groupIconPickerOpen, setGroupIconPickerOpen] = useState(false);
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('balance');
  const [showSettled, setShowSettled] = useState(false);
  const [unpaidModalOpen, setUnpaidModalOpen] = useState(false);

  const nameOf = (id: string) => members.find((m) => m.id === id)?.display_name ?? t.group.unknownMember;
  const emojiOf = (id: string) => members.find((m) => m.id === id)?.avatar_emoji ?? null;
  const me = members.find((m) => m.id === meId);
  const balances = useMemo(() => computeBalances(entries, meId), [entries, meId]);
  const netTotals = useMemo(() => computeMyNet(entries, meId), [entries, meId]);

  // 自動精算プラン: 通貨ごとに「まとめると何回の支払いで済むか」を計算し、
  // それが素朴なペアごとの内訳(balances)の件数より実際に少ない通貨だけ
  // カードを出す(2人だけのグループ等、まとめても件数が変わらない場合は
  // 表示しても意味がないため)。
  const autoSettlePlans = useMemo(() => {
    const simplified = computeSimplifiedSettlement(entries);
    const byCurrency = new Map<string, SimplifiedTransaction[]>();
    for (const tx of simplified) {
      const list = byCurrency.get(tx.currency) ?? [];
      list.push(tx);
      byCurrency.set(tx.currency, list);
    }
    const pairwiseCountByCurrency = new Map<string, number>();
    for (const row of balances) {
      if (row.type !== 'money' || !row.currency) continue;
      pairwiseCountByCurrency.set(row.currency, (pairwiseCountByCurrency.get(row.currency) ?? 0) + 1);
    }
    return [...byCurrency.entries()]
      .filter(([currency, txs]) => txs.length < (pairwiseCountByCurrency.get(currency) ?? Infinity))
      .map(([currency, transactions]) => ({ currency, transactions }));
  }, [entries, balances]);

  // 「受け取る」「支払う」を混ぜて出すと認知負荷が高い、という指摘を
  // 受けて、内訳を自分視点のセクションに分ける。自分が関係しない行
  // (グループ内の他の2人同士)は「受け取る/支払う」のどちらにも属さない
  // ため、別セクションにまとめる。
  const { balanceSections, receivingRows } = useMemo(() => {
    const receiving: BalanceRow[] = [];
    const paying: BalanceRow[] = [];
    const other: BalanceRow[] = [];
    for (const row of balances) {
      if (row.mine && row.creditor === meId) receiving.push(row);
      else if (row.mine && row.debtor === meId) paying.push(row);
      else other.push(row);
    }
    return {
      balanceSections: [
        { title: t.group.receivingSection, data: receiving },
        { title: t.group.payingSection, data: paying },
        { title: t.group.otherSection, data: other },
      ].filter((s) => s.data.length > 0),
      receivingRows: receiving,
    };
  }, [balances, meId, t]);

  // 精算進捗: まだ完了(confirmed)していない内訳のうち、既に「支払った」
  // 済みで受け取る側の確認待ちのものがどれだけあるか。進捗が見えると
  // 完了したくなる、という狙い。全員精算済みならNetSummary側の🎉
  // メッセージと役割が重複するため、balances.length > 0のときだけ
  // 出す(呼び出し側で判定)。
  const settlementProgress = useMemo(() => {
    const remaining = balances.length;
    const paid = balances.filter((r) => r.type === 'money' && r.status === 'paid').length;
    return { remaining, paid };
  }, [balances]);

  const visibleEntries = useMemo(
    () => (showSettled ? entries : entries.filter((e) => e.settle_status !== 'confirmed')),
    [entries, showSettled]
  );
  const sections = useMemo(
    () => groupEntriesByDate(visibleEntries, { today: t.dateGroups.today, yesterday: t.dateGroups.yesterday }),
    [visibleEntries, t]
  );
  const settledCount = entries.filter((e) => e.settle_status === 'confirmed').length;

  // 履歴タブ: 双方確認が完了(confirmed)した記録だけを、確認日の新しい順に
  // 並べる。日付グルーピングはconfirmed_at基準にしたいが、groupEntriesByDate
  // はcreated_atしか見ないため、この呼び出し専用にcreated_atをconfirmed_at
  // で置き換えたコピーを渡す(表示に使うentry自体は元のまま)。
  const historySections = useMemo(() => {
    const confirmed = entries
      .filter((e) => e.settle_status === 'confirmed' && e.confirmed_at)
      .slice()
      .sort((a, b) => ((a.confirmed_at as string) < (b.confirmed_at as string) ? 1 : -1));
    return groupEntriesByDate(
      confirmed.map((e) => ({ ...e, created_at: e.confirmed_at as string })),
      { today: t.dateGroups.today, yesterday: t.dateGroups.yesterday }
    );
  }, [entries, t]);

  // グループ作成直後だけ、1回きりの招待導線を出す(成長施策⑥)。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!justCreated) return;
    Alert.alert(t.group.inviteAfterCreateTitle, t.group.inviteAfterCreateMessage(group.name), [
      { text: t.group.inviteAfterCreateLater, style: 'cancel' },
      { text: t.group.inviteAfterCreateNow, onPress: () => setInviteModalOpen(true) },
    ]);
  }, []);

  // 貸し借りが1件もない状態(balances.length === 0)に「今まさに」なった
  // 瞬間だけ、紹介導線を出す(成長施策⑦)。開いた時点で既に精算済みだった
  // 場合は出さない(prevが分かっているとき=2回目以降のレンダーだけ発火)。
  const prevBalanceCountRef = useRef<number | null>(null);
  useEffect(() => {
    const prev = prevBalanceCountRef.current;
    if (prev !== null && prev > 0 && balances.length === 0) {
      logEvent('settlement_completed', { userId: meId, groupId: group.id });
      Alert.alert(t.group.referralTitle, t.group.referralMessage, [
        { text: t.group.referralDismiss, style: 'cancel' },
        { text: t.group.referralNow, onPress: () => setInviteModalOpen(true) },
      ]);
    }
    prevBalanceCountRef.current = balances.length;
  }, [balances.length, group.id, group.name, meId, t]);

  const avatarPicker = (
    <AvatarPicker
      visible={avatarPickerOpen}
      name={me?.display_name ?? '?'}
      selected={me?.avatar_emoji ?? null}
      onSelect={async (emoji) => {
        setAvatarPickerOpen(false);
        await onChangeAvatar(emoji);
      }}
      onClose={() => setAvatarPickerOpen(false)}
    />
  );

  const groupIconPicker = (
    <GroupIconPicker
      visible={groupIconPickerOpen}
      selected={group.icon_emoji}
      onSelect={async (emoji) => {
        setGroupIconPickerOpen(false);
        await onChangeGroupIcon(emoji);
      }}
      onClose={() => setGroupIconPickerOpen(false)}
    />
  );

  const shareInvite = () => {
    const url = buildInviteUrl(group.invite_code);
    Share.share({ message: t.group.inviteMessage(group.name, url, group.invite_code) });
  };

  const inviteModal = (
    <InviteModal
      visible={inviteModalOpen}
      onClose={() => setInviteModalOpen(false)}
      onSubmit={async (invitedName) => {
        const res = await inviteMember(invitedName);
        // 送信成功後、InviteModal(独自の<Modal>)はこの直後にclose()を呼ぶ。
        // その閉じるアニメーション中にShare.share()(OS標準の共有シート)を
        // 呼ぶと、iOSでは「自分のモーダルを閉じている最中に別のモーダルを
        // 開こうとする」形になり、共有シートが一切表示されないまま消えて
        // しまう(名前だけ登録されて共有が開かない、という不具合の原因)。
        // InviteModalの閉じるアニメーションが終わるのを待ってから開く。
        if (!res.error) setTimeout(shareInvite, 500);
        return res;
      }}
    />
  );

  const leave = () => {
    Alert.alert(t.group.leaveConfirmTitle, t.group.leaveConfirmMessage(group.name), [
      { text: t.common.cancel, style: 'cancel' },
      {
        text: t.group.leaveConfirmButton,
        style: 'destructive',
        onPress: async () => {
          const res = await onLeave(group.id);
          if (res.error) {
            Alert.alert(t.group.leaveFailedTitle, res.error);
            return;
          }
          onBack();
        },
      },
    ]);
  };

  const pendingInvites = useMemo(() => invites.filter((i) => i.status === 'pending'), [invites]);

  const header = (
    <View>
      <View style={styles.headerRow}>
        <Pressable onPress={onBack} hitSlop={10}>
          <Text style={styles.back}>{t.group.back}</Text>
        </Pressable>
        <View style={styles.headerRightRow}>
          <Pressable onPress={leave} hitSlop={10}>
            <Text style={styles.leave}>{t.group.leave}</Text>
          </Pressable>
          <Pressable onPress={onOpenSettings} hitSlop={10} accessibilityLabel={t.groups.settingsButton}>
            <Ionicons name="settings-outline" size={22} color={colors.ink} />
          </Pressable>
        </View>
      </View>
      <Pressable onPress={() => setGroupIconPickerOpen(true)} style={styles.titleRow}>
        <Mark size={40} glyph={group.icon_emoji ?? undefined} />
        <View style={styles.titleTextCol}>
          <Text style={styles.title}>{group.name}</Text>
          <Text style={styles.memberCount}>{t.group.memberCount(members.length)}</Text>
        </View>
      </Pressable>

      <View style={styles.memberStrip}>
        {members.map((m) => {
          const isMe = m.id === meId;
          const isAdmin = m.id === group.created_by;
          const slot = (
            <>
              <Avatar name={m.display_name} emoji={m.avatar_emoji} size="md" />
              <Text style={styles.memberSlotName} numberOfLines={1}>
                {m.display_name}
              </Text>
              {isAdmin && (
                <View style={styles.adminBadge}>
                  <Text style={styles.adminBadgeText}>{t.group.adminBadge}</Text>
                </View>
              )}
            </>
          );
          return isMe ? (
            <Pressable key={m.id} onPress={() => setAvatarPickerOpen(true)} style={styles.memberSlot}>
              {slot}
            </Pressable>
          ) : (
            <View key={m.id} style={styles.memberSlot}>
              {slot}
            </View>
          );
        })}
        {pendingInvites.map((invite) => (
          <View key={invite.id} style={styles.memberSlot}>
            <View style={[styles.avatarCircle, styles.pendingCircle]}>
              <Ionicons name="mail-outline" size={16} color={colors.muted} />
            </View>
            <Text style={styles.memberSlotName} numberOfLines={1}>
              {invite.invited_name}
            </Text>
            <View style={styles.pendingBadge}>
              <Text style={styles.pendingBadgeText}>{t.group.pendingSectionTitle}</Text>
            </View>
          </View>
        ))}
        <Pressable onPress={() => setInviteModalOpen(true)} style={styles.memberSlot}>
          <View style={[styles.avatarCircle, styles.addCircle]}>
            <Ionicons name="add" size={22} color={colors.muted} />
          </View>
          <Text style={styles.memberSlotName}>{t.group.invite}</Text>
        </Pressable>
      </View>
    </View>
  );

  // 以前はタブごとに3つのreturn文でSectionList・Fab・各種モーダルを
  // まるごと複製していたが、下固定のBottomTabBarを導入するにあたり
  // 「タブに応じて中身(SectionList)だけ切り替え、Fab・モーダル・
  // タブバー自体は1つだけ」という構成に整理した。
  let listContent: ReactElement;
  if (tab === 'balance') {
    listContent = (
      <SectionList
        sections={balanceSections}
        keyExtractor={(row) => `${row.debtor}-${row.creditor}-${row.type}-${row.currency}`}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} tintColor={colors.accent} />}
        contentContainerStyle={styles.list}
        stickySectionHeadersEnabled={false}
        ListHeaderComponent={
          <View>
            {header}
            <NetSummary totals={netTotals} balances={balances} meId={meId} />
            {balances.length > 0 && (
              <SettlementProgress
                remaining={settlementProgress.remaining}
                paid={settlementProgress.paid}
                onPress={() => setUnpaidModalOpen(true)}
              />
            )}
            {autoSettlePlans.map((plan) => (
              <AutoSettlePlan
                key={plan.currency}
                groupName={group.name}
                currency={plan.currency}
                transactions={plan.transactions}
                nameOf={nameOf}
                emojiOf={emojiOf}
                meId={meId}
                onSettleAll={() => settleAllMoney(plan.currency)}
              />
            ))}
          </View>
        }
        renderSectionHeader={({ section }) => <Text style={styles.sectionTitle}>{section.title}</Text>}
        renderItem={({ item }) => (
          <BalanceCard
            row={item}
            nameOf={nameOf}
            emojiOf={emojiOf}
            meId={meId}
            onSettle={() => settlePair(item.type, item.debtor, item.creditor, item.currency)}
            onMarkPaid={() => markPaid(item.debtor, item.creditor, item.currency)}
            onConfirmReceived={() => confirmReceived(item.debtor, item.creditor, item.currency)}
            onRemindSent={() => logEvent('reminder_sent', { userId: meId, groupId: group.id })}
          />
        )}
        ItemSeparatorComponent={() => <View style={styles.hairline} />}
      />
    );
  } else if (tab === 'history') {
    listContent = (
      <SectionList
        sections={historySections}
        keyExtractor={(e) => e.id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} tintColor={colors.accent} />}
        contentContainerStyle={styles.list}
        stickySectionHeadersEnabled={false}
        ListHeaderComponent={<View>{header}</View>}
        renderSectionHeader={({ section }) => <Text style={styles.dateHeader}>{section.title}</Text>}
        renderItem={({ item }) => <HistoryEntryRow entry={item} nameOf={nameOf} meId={meId} />}
        ItemSeparatorComponent={() => <View style={styles.hairline} />}
        ListEmptyComponent={!loading ? <Text style={styles.emptyNote}>{t.history.empty}</Text> : null}
      />
    );
  } else {
    listContent = (
      <SectionList
        sections={sections}
        keyExtractor={(e) => e.id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} tintColor={colors.accent} />}
        contentContainerStyle={styles.list}
        stickySectionHeadersEnabled={false}
        ListHeaderComponent={
          <View>
            {header}
            {settledCount > 0 && (
              <Pressable onPress={() => setShowSettled((v) => !v)} style={styles.settledToggle}>
                <Text style={styles.settledToggleText}>
                  {showSettled ? t.group.hideSettled : t.group.showSettled(settledCount)}
                </Text>
              </Pressable>
            )}
          </View>
        }
        renderSectionHeader={({ section }) => <Text style={styles.dateHeader}>{section.title}</Text>}
        renderItem={({ item }) => (
          <EntryRow
            entry={item}
            nameOf={nameOf}
            meId={meId}
            onToggleSettled={(e) => toggleSettled(e.id, e.settle_status === 'confirmed' ? 'unpaid' : 'confirmed')}
            onDelete={(e) => deleteEntry(e.id)}
          />
        )}
        ItemSeparatorComponent={() => <View style={styles.hairline} />}
        ListEmptyComponent={!loading ? <Text style={styles.emptyNote}>{t.group.emptyLedger}</Text> : null}
      />
    );
  }

  return (
    <View style={styles.wrap}>
      {listContent}
      <Fab onPress={() => setSheetOpen(true)} disabled={members.length < 2} />
      <BottomTabBar tab={tab} onChange={setTab} />
      <AddEntrySheet visible={sheetOpen} members={members} meId={meId} onClose={() => setSheetOpen(false)} onSubmit={addEntry} onSubmitSplit={addSplitEntry} />
      {avatarPicker}
      {groupIconPicker}
      {inviteModal}
      {tab === 'balance' && (
        <UnpaidMembersModal
          visible={unpaidModalOpen}
          rows={receivingRows}
          nameOf={nameOf}
          emojiOf={emojiOf}
          onConfirmReceived={(row) => confirmReceived(row.debtor, row.creditor, row.currency)}
          onRemindSent={() => logEvent('reminder_sent', { userId: meId, groupId: group.id })}
          onClose={() => setUnpaidModalOpen(false)}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  list: { paddingHorizontal: 20, paddingBottom: 100 },
  headerRow: { marginTop: 44, marginBottom: 4, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  headerRightRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  back: { ...fonts.bodySemiBold, fontSize: 15, color: colors.accent },
  leave: { ...fonts.bodyMedium, fontSize: 12.5, color: colors.muted },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 4, marginBottom: 14 },
  titleTextCol: { flexShrink: 1 },
  title: { ...fonts.display, fontSize: 26, color: colors.ink },
  memberCount: { ...fonts.bodyMedium, fontSize: 12.5, color: colors.muted, marginTop: 1 },
  memberStrip: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginBottom: 18 },
  memberSlot: { alignItems: 'center', width: 64, gap: 3 },
  memberSlotName: { ...fonts.bodyMedium, fontSize: 11.5, color: colors.ink, maxWidth: 62 },
  adminBadge: { backgroundColor: colors.surface2, borderRadius: 999, paddingVertical: 1.5, paddingHorizontal: 7 },
  adminBadgeText: { ...fonts.bodySemiBold, fontSize: 9.5, color: colors.muted },
  avatarCircle: {
    width: 44,
    height: 44,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pendingCircle: { backgroundColor: colors.surface2, borderWidth: 1.5, borderColor: colors.line, borderStyle: 'dashed' },
  pendingBadge: { backgroundColor: colors.surface2, borderRadius: 999, paddingVertical: 1.5, paddingHorizontal: 7 },
  pendingBadgeText: { ...fonts.bodySemiBold, fontSize: 9.5, color: colors.muted },
  addCircle: { borderWidth: 1.5, borderColor: colors.muted, borderStyle: 'dashed' },
  sectionTitle: {
    ...fonts.bodySemiBold,
    fontSize: 12.5,
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 14,
    marginBottom: 4,
  },
  dateHeader: {
    ...fonts.bodySemiBold,
    fontSize: 12.5,
    color: colors.muted,
    marginTop: 14,
    marginBottom: 2,
  },
  settledToggle: { alignSelf: 'flex-start', marginBottom: 6 },
  settledToggleText: { ...fonts.bodyMedium, fontSize: 13, color: colors.accent },
  hairline: { height: 1, backgroundColor: colors.line },
  emptyNote: { ...fonts.body, fontSize: 14.5, color: colors.muted, textAlign: 'center', paddingVertical: 24 },
});
