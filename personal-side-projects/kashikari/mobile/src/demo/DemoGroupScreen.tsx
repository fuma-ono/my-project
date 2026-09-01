// デモモード専用。GroupScreen.tsxと同じ見た目・操作感を、Supabaseを
// 一切呼ばずローカルstateだけで再現する(スクリーンショット・動作確認用)。
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { Alert, Platform, Pressable, ScrollView, SectionList, StyleSheet, Text, View } from 'react-native';

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
import NetSummary from '../components/NetSummary';
import SettlementProgress from '../components/SettlementProgress';
import ShareChannelSheet from '../components/ShareChannelSheet';
import Toast from '../components/Toast';
import UnpaidMembersModal from '../components/UnpaidMembersModal';
import { useT } from '../i18n';
import { computeBalances, computeMyNet, computeSimplifiedSettlement, entryFromKey, entryToKey } from '../lib/balances';
import { groupEntriesByDate } from '../lib/dateGroups';
import { buildInviteUrl } from '../lib/invite';
import { splitAmount } from '../lib/split';
import { avatarColor, colors, fonts } from '../theme';
import type { BalanceRow, Entry, EntryType, Group, GroupInvite, Profile, SimplifiedTransaction } from '../types';
import { DEMO_ENTRIES, DEMO_GROUP, DEMO_ME_ID, DEMO_MEMBERS } from './mockData';

type Tab = GroupTab;
let demoIdSeq = 100;

export default function DemoGroupScreen({ onBack, onOpenSettings }: { onBack: () => void; onOpenSettings: () => void }) {
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
  const [shareSheetOpen, setShareSheetOpen] = useState(false);
  const [shareMessage, setShareMessage] = useState('');
  const [invites, setInvites] = useState<GroupInvite[]>([]);
  const [remindToastMessage, setRemindToastMessage] = useState<string | null>(null);
  const [inviteToastMessage, setInviteToastMessage] = useState<string | null>(null);
  const [fabHintToastVisible, setFabHintToastVisible] = useState(false);
  // 招待送信直後、InviteModalが実際に閉じ終わってから共有シートを
  // 開くためのフラグ(詳細はGroupScreen.tsxの同じ箇所のコメント参照)。
  const pendingShareRef = useRef(false);
  const meId = DEMO_ME_ID;
  const me = members.find((m) => m.id === meId);

  const nameOf = (id: string) =>
    members.find((m) => m.id === id)?.display_name ?? invites.find((i) => i.id === id)?.invited_name ?? t.group.unknownMember;
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

  // 「共有する時にLINEやメールへのリンクを送れるようにしてほしい」への
  // 対応(詳細はGroupScreen.tsxの同じ箇所のコメント参照)。
  const triggerPendingShare = () => {
    if (!pendingShareRef.current) return;
    pendingShareRef.current = false;
    const url = buildInviteUrl(group.invite_code);
    setShareMessage(t.group.inviteMessage(group.name, url, group.invite_code));
    setShareSheetOpen(true);
  };

  // 「招待した相手が参加する前でも記録できる」対応(詳細はuseGroupData.tsの
  // 同じ箇所のコメント参照)。実メンバーIDならfrom_user/to_user、招待中の
  // 相手(group_invites.id)ならfrom_invite/to_inviteに入れる。
  const personColumns = (id: string, prefix: 'from' | 'to'): Pick<Entry, 'from_user' | 'from_invite'> | Pick<Entry, 'to_user' | 'to_invite'> => {
    const isMember = members.some((m) => m.id === id);
    return prefix === 'from'
      ? { from_user: isMember ? id : null, from_invite: isMember ? null : id }
      : { to_user: isMember ? id : null, to_invite: isMember ? null : id };
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
      ...(personColumns(input.fromUser, 'from') as Pick<Entry, 'from_user' | 'from_invite'>),
      ...(personColumns(input.toUser, 'to') as Pick<Entry, 'to_user' | 'to_invite'>),
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
      ...(personColumns(input.payer, 'from') as Pick<Entry, 'from_user' | 'from_invite'>),
      ...(personColumns(id, 'to') as Pick<Entry, 'to_user' | 'to_invite'>),
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
            ? (e.currency || 'JPY') === (currency || 'JPY') &&
              ((entryFromKey(e) === a && entryToKey(e) === b) || (entryFromKey(e) === b && entryToKey(e) === a))
            : entryFromKey(e) === a && entryToKey(e) === b;
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
        const match =
          (e.currency || 'JPY') === (currency || 'JPY') &&
          ((entryFromKey(e) === a && entryToKey(e) === b) || (entryFromKey(e) === b && entryToKey(e) === a));
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
        const match =
          (e.currency || 'JPY') === (currency || 'JPY') &&
          ((entryFromKey(e) === a && entryToKey(e) === b) || (entryFromKey(e) === b && entryToKey(e) === a));
        return match ? { ...e, settle_status: 'confirmed', confirmed_at: now } : e;
      })
    );
    return Promise.resolve({ error: null });
  };

  const pendingInvites = useMemo(() => invites.filter((i) => i.status === 'pending'), [invites]);

  const header = (
    <View>
      {/* 「デモモードの上部は消せないの？大学の友達タブと重なってしまってる」
          という指摘を受け、ヘッダーに重なっていたバナーを削除した。
          デモモードであること自体は、設定画面などから引き続き分かる。 */}
      <View style={styles.headerShadowWrap}>
        {/* ヘッダーの2層構成(横グラデーション+縦の黒フェード)の詳細は
            GroupScreen.tsxの同じ箇所のコメント参照。 */}
        <View style={styles.headerGradientBase}>
          <LinearGradient
            colors={[colors.headerAccent, colors.headerPlum]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={StyleSheet.absoluteFill}
          />
          <LinearGradient
            colors={[colors.headerShadeTop, colors.headerShadeBottom]}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 0.75 }}
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.headerRow}>
            <Pressable onPress={onBack} hitSlop={10} accessibilityLabel={t.group.back}>
              <Ionicons name="chevron-back" size={22} color="#fff" />
            </Pressable>
            <Pressable onPress={() => setGroupIconPickerOpen(true)} style={styles.titleCol}>
              <Text style={styles.title} numberOfLines={1}>{group.name}</Text>
              <Text style={styles.memberCount}>{t.group.memberCount(members.length)}</Text>
            </Pressable>
            <View style={styles.headerRightRow}>
              <Pressable onPress={onOpenSettings} hitSlop={10} accessibilityLabel={t.groups.settingsButton}>
                <Ionicons name="settings-outline" size={22} color="#fff" />
              </Pressable>
            </View>
          </View>
        </View>
      </View>

      {/* 画像で示してもらって判明: 動かすべきはアイコンの位置ではなく、
          「下の白い本体側」の形だった。詳細はGroupScreen.tsxの同じ箇所
          のコメント参照。 */}
      <View style={styles.memberStripCard}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.memberStrip}>
          {members.map((m) => {
            const isMe = m.id === meId;
            const isAdmin = m.id === group.created_by;
            const slot = (
              <>
                <View style={[styles.avatarRing, { borderColor: avatarColor(m.display_name) }]}>
                  <Avatar name={m.display_name} emoji={m.avatar_emoji} size="lg" />
                </View>
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
                <Ionicons name="mail" size={22} color="#fff" />
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
              <Ionicons name="add" size={26} color={colors.muted} />
            </View>
            <Text style={styles.memberSlotName}>{t.group.invite}</Text>
          </Pressable>
        </ScrollView>
      </View>
    </View>
  );

  let listContent: ReactElement;
  if (tab === 'balance') {
    listContent = (
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
              groupId={null}
              onSettle={() => settlePair(item.type, item.debtor, item.creditor, item.currency)}
              onMarkPaid={() => markPaid(item.debtor, item.creditor, item.currency)}
              onConfirmReceived={() => confirmReceived(item.debtor, item.creditor, item.currency)}
              onRemindSent={() => {}}
              onRemindResult={(sent) => setRemindToastMessage(sent ? t.group.remindSentToast : t.group.remindFailedToast)}
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
        contentContainerStyle={styles.list}
        stickySectionHeadersEnabled={false}
        ListHeaderComponent={<View>{header}</View>}
        renderSectionHeader={({ section }) => <Text style={styles.dateHeader}>{section.title}</Text>}
        renderItem={({ item }) => <HistoryEntryRow entry={item} nameOf={nameOf} meId={meId} />}
        ItemSeparatorComponent={() => <View style={styles.hairline} />}
        ListEmptyComponent={<Text style={styles.emptyNote}>{t.history.empty}</Text>}
      />
    );
  } else {
    listContent = (
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
    );
  }

  return (
    <View style={styles.wrap}>
      {listContent}

      <Fab
        onPress={() => setSheetOpen(true)}
        disabled={members.length + pendingInvites.length < 2}
        onDisabledPress={() => setFabHintToastVisible(true)}
      />
      <BottomTabBar tab={tab} onChange={setTab} />

      <AddEntrySheet
        visible={sheetOpen}
        members={members}
        pendingInvites={pendingInvites}
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
        onDismiss={triggerPendingShare}
        onSubmit={async (invitedName) => {
          const res = await inviteMember(invitedName);
          // InviteModalが実際に閉じ終わってから共有シートを開く
          // (詳細はGroupScreen.tsxの同じ箇所のコメント参照)。
          if (!res.error) {
            setInviteToastMessage(t.group.inviteSuccessToast(invitedName));
            pendingShareRef.current = true;
            if (Platform.OS !== 'ios') setTimeout(triggerPendingShare, 400);
          }
          return res;
        }}
      />

      <ShareChannelSheet
        visible={shareSheetOpen}
        message={shareMessage}
        onClose={() => setShareSheetOpen(false)}
        onCopied={() => setInviteToastMessage(t.group.inviteLinkCopiedToast)}
      />

      <UnpaidMembersModal
        visible={unpaidModalOpen}
        rows={receivingRows}
        nameOf={nameOf}
        emojiOf={emojiOf}
        groupId={null}
        onConfirmReceived={(row) => confirmReceived(row.debtor, row.creditor, row.currency)}
        onRemindSent={() => {}}
        onRemindResult={(sent) => setRemindToastMessage(sent ? t.group.remindSentToast : t.group.remindFailedToast)}
        onClose={() => setUnpaidModalOpen(false)}
      />

      <Toast message={remindToastMessage ?? ''} visible={remindToastMessage !== null} onHide={() => setRemindToastMessage(null)} />
      <Toast message={inviteToastMessage ?? ''} visible={inviteToastMessage !== null} onHide={() => setInviteToastMessage(null)} />
      <Toast message={t.group.fabNeedMemberHint} visible={fabHintToastVisible} onHide={() => setFabHintToastVisible(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  list: { paddingHorizontal: 20, paddingBottom: 100 },
  // デモモードバナーを削除したため、ステータスバー避けの余白は本番の
  // GroupScreen.tsxと同じ値にしている。「タイトル行を上に配置して」の
  // 指摘を受け、paddingTopは44→28に詰めた(GroupScreen.tsxと同じ)。
  headerShadowWrap: {
    marginHorizontal: -20,
    marginBottom: 0,
  },
  headerGradientBase: {
    position: 'relative',
    paddingTop: 28,
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center' },
  headerRightRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  titleCol: { flex: 1, marginHorizontal: 16 },
  title: { ...fonts.display, fontSize: 23, color: '#fff' },
  memberCount: { ...fonts.bodyMedium, fontSize: 12, color: 'rgba(255,255,255,0.8)', marginTop: 1 },
  // メンバー行の「背景」だけを上端角丸のカードにしてヘッダー下端に
  // めり込ませる(詳細はGroupScreen.tsxの同じ箇所のコメント参照)。
  memberStripCard: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    marginHorizontal: -20,
    marginTop: -12,
    paddingTop: 18,
    paddingHorizontal: 20,
  },
  memberStrip: { flexDirection: 'row', gap: 16, marginBottom: 10, paddingRight: 4 },
  memberSlot: { alignItems: 'center', width: 70, gap: 4 },
  avatarRing: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  memberSlotName: { ...fonts.bodyMedium, fontSize: 12, color: colors.ink, maxWidth: 68 },
  adminBadge: { backgroundColor: colors.accentSoft, borderRadius: 999, paddingVertical: 1, paddingHorizontal: 6 },
  adminBadgeText: { ...fonts.bodySemiBold, fontSize: 9.5, color: colors.accent },
  avatarCircle: {
    width: 56,
    height: 56,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pendingCircle: {
    backgroundColor: colors.favor,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: 'rgba(255,255,255,0.7)',
  },
  pendingBadge: { backgroundColor: colors.accentSoft, borderRadius: 999, paddingVertical: 1, paddingHorizontal: 6 },
  pendingBadgeText: { ...fonts.bodySemiBold, fontSize: 8.5, color: colors.accent },
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
  dateHeader: { ...fonts.bodySemiBold, fontSize: 12.5, color: colors.muted, marginTop: 14, marginBottom: 2 },
  settledToggle: { alignSelf: 'flex-start', marginBottom: 6 },
  settledToggleText: { ...fonts.bodyMedium, fontSize: 13, color: colors.accent },
  hairline: { height: 1, backgroundColor: colors.line },
  emptyNote: { ...fonts.body, fontSize: 14.5, color: colors.muted, textAlign: 'center', paddingVertical: 24 },
});
