// デモモード専用。GroupScreen.tsxと同じ見た目・操作感を、Supabaseを
// 一切呼ばずローカルstateだけで再現する(スクリーンショット・動作確認用)。
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, SectionList, Share, StyleSheet, Text, View } from 'react-native';

import AddEntrySheet from '../components/AddEntrySheet';
import AutoSettlePlan from '../components/AutoSettlePlan';
import Avatar from '../components/Avatar';
import AvatarPicker from '../components/AvatarPicker';
import BalanceCard from '../components/BalanceCard';
import EntryRow from '../components/EntryRow';
import Fab from '../components/Fab';
import GroupIconPicker from '../components/GroupIconPicker';
import HistoryEntryRow from '../components/HistoryEntryRow';
import InviteModal from '../components/InviteModal';
import Mark from '../components/Mark';
import NetSummary from '../components/NetSummary';
import PendingInvites from '../components/PendingInvites';
import SettlementProgress from '../components/SettlementProgress';
import UnpaidMembersModal from '../components/UnpaidMembersModal';
import { useT } from '../i18n';
import { computeBalances, computeMyNet, computeSimplifiedSettlement } from '../lib/balances';
import { groupEntriesByDate } from '../lib/dateGroups';
import { buildInviteUrl } from '../lib/invite';
import { splitAmount } from '../lib/split';
import { colors, fonts } from '../theme';
import type { BalanceRow, Entry, EntryType, Group, GroupInvite, Profile, SimplifiedTransaction } from '../types';
import { DEMO_ENTRIES, DEMO_GROUP, DEMO_ME_ID, DEMO_MEMBERS } from './mockData';

type Tab = 'balance' | 'ledger' | 'history';
let demoIdSeq = 100;

export default function DemoGroupScreen({ onBack }: { onBack: () => void }) {
  const t = useT();
  const [entries, setEntries] = useState<Entry[]>(DEMO_ENTRIES);
  const [members, setMembers] = useState<Profile[]>(DEMO_MEMBERS);
  const [group, setGroup] = useState<Group>(DEMO_GROUP);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [avatarPickerOpen, setAvatarPickerOpen] = useState(false);
  const [groupIconPickerOpen, setGroupIconPickerOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('balance');
  const [showSettled, setShowSettled] = useState(false);
  const [unpaidModalOpen, setUnpaidModalOpen] = useState(false);
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [invites, setInvites] = useState<GroupInvite[]>([]);
  const meId = DEMO_ME_ID;
  const me = members.find((m) => m.id === meId);

  const nameOf = (id: string) => members.find((m) => m.id === id)?.display_name ?? t.group.unknownMember;
  const emojiOf = (id: string) => members.find((m) => m.id === id)?.avatar_emoji ?? null;
  const balances = useMemo(() => computeBalances(entries, meId), [entries]);
  const netTotals = useMemo(() => computeMyNet(entries, meId), [entries]);
  const visibleEntries = useMemo(
    () => (showSettled ? entries : entries.filter((e) => e.settle_status !== 'confirmed')),
    [entries, showSettled]
  );
  const sections = useMemo(
    () => groupEntriesByDate(visibleEntries, { today: t.dateGroups.today, yesterday: t.dateGroups.yesterday }),
    [visibleEntries, t]
  );
  const settledCount = entries.filter((e) => e.settle_status === 'confirmed').length;

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

  const settlementProgress = useMemo(() => {
    const remaining = balances.length;
    const paid = balances.filter((r) => r.type === 'money' && r.status === 'paid').length;
    return { remaining, paid };
  }, [balances]);

  const settleAllMoney = async (currency: string) => {
    const now = new Date().toISOString();
    setEntries((prev) =>
      prev.map((e) =>
        e.type === 'money' && (e.currency || 'JPY') === currency && e.settle_status !== 'confirmed'
          ? { ...e, settle_status: 'confirmed', confirmed_at: now }
          : e
      )
    );
    return { error: null };
  };

  // 貸し借りが0件になった瞬間だけ紹介導線を出す(本番のGroupScreenと同じ狙い)。
  const prevBalanceCountRef = useRef<number | null>(null);
  useEffect(() => {
    const prev = prevBalanceCountRef.current;
    if (prev !== null && prev > 0 && balances.length === 0) {
      Alert.alert(t.group.referralTitle, t.group.referralMessage, [
        { text: t.group.referralDismiss, style: 'cancel' },
        { text: t.group.referralNow, onPress: () => setInviteModalOpen(true) },
      ]);
    }
    prevBalanceCountRef.current = balances.length;
  }, [balances.length, t]);

  const inviteMember = async (invitedName: string) => {
    const invite: GroupInvite = {
      id: `demo-invite-${demoIdSeq++}`,
      group_id: group.id,
      invited_name: invitedName,
      status: 'pending',
      created_by: meId,
      created_at: new Date().toISOString(),
      joined_user_id: null,
      joined_at: null,
    };
    setInvites((prev) => [...prev, invite]);
    return { error: null };
  };

  const shareInvite = () => {
    const url = buildInviteUrl(group.invite_code);
    Share.share({ message: t.group.inviteMessage(group.name, url, group.invite_code) });
  };

  const addEntry = async (input: {
    fromUser: string;
    toUser: string;
    type: EntryType;
    amount: number | null;
    currency: string | null;
    description: string;
    photoUri?: string | null;
  }) => {
    const entry: Entry = {
      id: `demo-${demoIdSeq++}`,
      group_id: group.id,
      from_user: input.fromUser,
      to_user: input.toUser,
      type: input.type,
      amount: input.amount,
      currency: input.currency,
      description: input.description || null,
      photo_path: null,
      settle_status: 'unpaid',
      paid_at: null,
      confirmed_at: null,
      created_by: meId,
      created_at: new Date().toISOString(),
    };
    setEntries((prev) => [entry, ...prev]);
    return { error: null };
  };

  const addSplitEntry = async (input: {
    payer: string;
    participantIds: string[];
    totalAmount: number;
    currency: string;
    description: string;
    photoUri?: string | null;
  }) => {
    const others = input.participantIds.filter((id) => id !== input.payer);
    if (others.length === 0) return { error: t.addEntry.splitNeedOthersError };
    const shares = splitAmount(input.totalAmount, input.participantIds.length, input.currency);
    const newEntries: Entry[] = others.map((id) => ({
      id: `demo-${demoIdSeq++}`,
      group_id: group.id,
      from_user: input.payer,
      to_user: id,
      type: 'money',
      amount: shares[input.participantIds.indexOf(id)],
      currency: input.currency,
      description: input.description || null,
      photo_path: null,
      settle_status: 'unpaid',
      paid_at: null,
      confirmed_at: null,
      created_by: meId,
      created_at: new Date().toISOString(),
    }));
    setEntries((prev) => [...newEntries, ...prev]);
    return { error: null };
  };

  // 台帳の「精算済みにする/未精算に戻す」(1件単位の手動オーバーライド)。
  const toggleSettled = (e: Entry) =>
    setEntries((prev) =>
      prev.map((x) => {
        if (x.id !== e.id) return x;
        return x.settle_status === 'confirmed'
          ? { ...x, settle_status: 'unpaid', paid_at: null, confirmed_at: null }
          : { ...x, settle_status: 'confirmed', confirmed_at: new Date().toISOString() };
      })
    );
  const deleteEntry = (e: Entry) => setEntries((prev) => prev.filter((x) => x.id !== e.id));

  // 頼みごと専用: 一括で直接confirmedにする。
  const settlePair = (type: EntryType, a: string, b: string, currency: string | null) => {
    const now = new Date().toISOString();
    setEntries((prev) =>
      prev.map((e) => {
        if (e.settle_status === 'confirmed' || e.type !== type) return e;
        const match =
          type === 'money'
            ? (e.currency || 'JPY') === (currency || 'JPY') && ((e.from_user === a && e.to_user === b) || (e.from_user === b && e.to_user === a))
            : e.from_user === a && e.to_user === b;
        return match ? { ...e, settle_status: 'confirmed', confirmed_at: now } : e;
      })
    );
  };

  // お金の「支払った」/「受け取った」の2段階確認。
  const markPaid = (a: string, b: string, currency: string | null) => {
    const now = new Date().toISOString();
    setEntries((prev) =>
      prev.map((e) => {
        if (e.type !== 'money' || e.settle_status !== 'unpaid') return e;
        const match = (e.currency || 'JPY') === (currency || 'JPY') && ((e.from_user === a && e.to_user === b) || (e.from_user === b && e.to_user === a));
        return match ? { ...e, settle_status: 'paid', paid_at: now } : e;
      })
    );
    return Promise.resolve({ error: null });
  };
  const confirmReceived = (a: string, b: string, currency: string | null) => {
    const now = new Date().toISOString();
    setEntries((prev) =>
      prev.map((e) => {
        if (e.type !== 'money' || e.settle_status !== 'paid') return e;
        const match = (e.currency || 'JPY') === (currency || 'JPY') && ((e.from_user === a && e.to_user === b) || (e.from_user === b && e.to_user === a));
        return match ? { ...e, settle_status: 'confirmed', confirmed_at: now } : e;
      })
    );
    return Promise.resolve({ error: null });
  };

  const header = (
    <View>
      <View style={styles.demoBanner}>
        <Text style={styles.demoBannerText}>{t.demo.banner}</Text>
      </View>
      <View style={styles.headerRow}>
        <Pressable onPress={onBack} hitSlop={10}>
          <Text style={styles.back}>{t.group.back}</Text>
        </Pressable>
      </View>
      <Pressable onPress={() => setGroupIconPickerOpen(true)} style={styles.titleRow}>
        <Mark size={40} glyph={group.icon_emoji ?? undefined} />
        <View style={styles.titleTextCol}>
          <Text style={styles.title}>{group.name}</Text>
          <Text style={styles.memberCount}>{t.group.memberCount(members.length)}</Text>
        </View>
      </Pressable>

      <View style={styles.memberStrip}>
        {members.map((m) =>
          m.id === meId ? (
            <Pressable key={m.id} onPress={() => setAvatarPickerOpen(true)} style={styles.memberChip}>
              <Avatar name={m.display_name} emoji={m.avatar_emoji} size="sm" />
              <Text style={styles.memberName}>{m.display_name}</Text>
              <Text style={styles.editHint}>{t.group.changeHint}</Text>
            </Pressable>
          ) : (
            <View key={m.id} style={styles.memberChip}>
              <Avatar name={m.display_name} emoji={m.avatar_emoji} size="sm" />
              <Text style={styles.memberName}>{m.display_name}</Text>
            </View>
          )
        )}
        <Pressable onPress={() => setInviteModalOpen(true)} style={styles.inviteChip}>
          <Text style={styles.inviteChipText}>{t.group.invite}</Text>
        </Pressable>
      </View>

      <PendingInvites invites={invites} />

      <View style={styles.tabs}>
        <Pressable onPress={() => setTab('balance')} style={[styles.tabBtn, tab === 'balance' && styles.tabBtnActive]}>
          <Text style={[styles.tabText, tab === 'balance' && styles.tabTextActive]}>{t.group.tabBalance}</Text>
        </Pressable>
        <Pressable onPress={() => setTab('ledger')} style={[styles.tabBtn, tab === 'ledger' && styles.tabBtnActive]}>
          <Text style={[styles.tabText, tab === 'ledger' && styles.tabTextActive]}>{t.group.tabLedger}</Text>
        </Pressable>
        <Pressable onPress={() => setTab('history')} style={[styles.tabBtn, tab === 'history' && styles.tabBtnActive]}>
          <Text style={[styles.tabText, tab === 'history' && styles.tabTextActive]}>{t.group.tabHistory}</Text>
        </Pressable>
      </View>
    </View>
  );

  return (
    <View style={styles.wrap}>
      {tab === 'balance' ? (
        <SectionList
          sections={balanceSections}
          keyExtractor={(row) => `${row.debtor}-${row.creditor}-${row.type}-${row.currency}`}
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
            />
          )}
          ItemSeparatorComponent={() => <View style={styles.hairline} />}
        />
      ) : tab === 'history' ? (
        <SectionList
          sections={historySections}
          keyExtractor={(e) => e.id}
          contentContainerStyle={styles.list}
          stickySectionHeadersEnabled={false}
          ListHeaderComponent={<View>{header}</View>}
          renderSectionHeader={({ section }) => <Text style={styles.dateHeader}>{section.title}</Text>}
          renderItem={({ item }) => <HistoryEntryRow entry={item} nameOf={nameOf} meId={meId} />}
          ItemSeparatorComponent={() => <View style={styles.hairline} />}
          ListEmptyComponent={<Text style={styles.emptyNote}>{t.history.empty}</Text>}
        />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(e) => e.id}
          contentContainerStyle={styles.list}
          stickySectionHeadersEnabled={false}
          ListHeaderComponent={
            <View>
              {header}
              {settledCount > 0 && (
                <Pressable onPress={() => setShowSettled((v) => !v)} style={styles.settledToggle}>
                  <Text style={styles.settledToggleText}>{showSettled ? t.group.hideSettled : t.group.showSettled(settledCount)}</Text>
                </Pressable>
              )}
            </View>
          }
          renderSectionHeader={({ section }) => <Text style={styles.dateHeader}>{section.title}</Text>}
          renderItem={({ item }) => (
            <EntryRow entry={item} nameOf={nameOf} meId={meId} onToggleSettled={toggleSettled} onDelete={deleteEntry} />
          )}
          ItemSeparatorComponent={() => <View style={styles.hairline} />}
        />
      )}

      <Fab onPress={() => setSheetOpen(true)} />

      <AddEntrySheet
        visible={sheetOpen}
        members={members}
        meId={meId}
        onClose={() => setSheetOpen(false)}
        onSubmit={addEntry}
        onSubmitSplit={addSplitEntry}
      />

      <AvatarPicker
        visible={avatarPickerOpen}
        name={me?.display_name ?? '?'}
        selected={me?.avatar_emoji ?? null}
        onSelect={(emoji) => {
          setAvatarPickerOpen(false);
          setMembers((prev) => prev.map((m) => (m.id === meId ? { ...m, avatar_emoji: emoji } : m)));
        }}
        onClose={() => setAvatarPickerOpen(false)}
      />

      <GroupIconPicker
        visible={groupIconPickerOpen}
        selected={group.icon_emoji}
        onSelect={(emoji) => {
          setGroupIconPickerOpen(false);
          setGroup((prev) => ({ ...prev, icon_emoji: emoji }));
        }}
        onClose={() => setGroupIconPickerOpen(false)}
      />

      <InviteModal
        visible={inviteModalOpen}
        onClose={() => setInviteModalOpen(false)}
        onSubmit={async (invitedName) => {
          const res = await inviteMember(invitedName);
          if (!res.error) shareInvite();
          return res;
        }}
      />

      <UnpaidMembersModal
        visible={unpaidModalOpen}
        rows={receivingRows}
        nameOf={nameOf}
        emojiOf={emojiOf}
        onConfirmReceived={(row) => confirmReceived(row.debtor, row.creditor, row.currency)}
        onClose={() => setUnpaidModalOpen(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  demoBanner: { backgroundColor: colors.favor, marginHorizontal: -20, paddingVertical: 8, paddingHorizontal: 16, paddingTop: 44, marginBottom: 8 },
  demoBannerText: { ...fonts.bodySemiBold, fontSize: 12, color: '#fff', textAlign: 'center' },
  list: { paddingHorizontal: 20, paddingBottom: 100 },
  headerRow: { marginBottom: 4 },
  back: { ...fonts.bodySemiBold, fontSize: 15, color: colors.accent },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 4, marginBottom: 14 },
  titleTextCol: { flexShrink: 1 },
  title: { ...fonts.display, fontSize: 26, color: colors.ink },
  memberCount: { ...fonts.bodyMedium, fontSize: 12.5, color: colors.muted, marginTop: 1 },
  memberStrip: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 18 },
  memberChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.surface,
    borderRadius: 999,
    paddingVertical: 5,
    paddingRight: 12,
    paddingLeft: 5,
    borderWidth: 1,
    borderColor: colors.line,
  },
  memberName: { ...fonts.bodySemiBold, fontSize: 13, color: colors.ink },
  editHint: { ...fonts.bodyMedium, fontSize: 11, color: colors.accent },
  inviteChip: {
    borderWidth: 1.5,
    borderColor: colors.muted,
    borderStyle: 'dashed',
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 14,
    justifyContent: 'center',
  },
  inviteChipText: { ...fonts.bodySemiBold, fontSize: 13, color: colors.muted },
  tabs: { flexDirection: 'row', backgroundColor: colors.surface2, borderRadius: 12, padding: 4, marginBottom: 22 },
  tabBtn: { flex: 1, paddingVertical: 9, borderRadius: 9, alignItems: 'center' },
  tabBtnActive: { backgroundColor: colors.surface, shadowColor: '#3c2814', shadowOpacity: 0.08, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 1 },
  tabText: { ...fonts.bodySemiBold, fontSize: 14, color: colors.muted },
  tabTextActive: { color: colors.ink },
  sectionTitle: {
    ...fonts.bodySemiBold,
    fontSize: 12.5,
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 14,
    marginBottom: 4,
  },
  dateHeader: { ...fonts.bodySemiBold, fontSize: 12.5, color: colors.muted, marginTop: 14, marginBottom: 2 },
  settledToggle: { alignSelf: 'flex-start', marginBottom: 6 },
  settledToggleText: { ...fonts.bodyMedium, fontSize: 13, color: colors.accent },
  hairline: { height: 1, backgroundColor: colors.line },
  emptyNote: { ...fonts.body, fontSize: 14.5, color: colors.muted, textAlign: 'center', paddingVertical: 24 },
});
