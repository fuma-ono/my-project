// デモモード専用。GroupScreen.tsxと同じ見た目・操作感を、Supabaseを
// 一切呼ばずローカルstateだけで再現する(スクリーンショット・動作確認用)。
import { useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, SectionList, StyleSheet, Text, View } from 'react-native';

import AddEntrySheet from '../components/AddEntrySheet';
import Avatar from '../components/Avatar';
import AvatarPicker from '../components/AvatarPicker';
import BalanceCard from '../components/BalanceCard';
import EntryRow from '../components/EntryRow';
import Fab from '../components/Fab';
import GroupIconPicker from '../components/GroupIconPicker';
import Mark from '../components/Mark';
import NetSummary from '../components/NetSummary';
import { computeBalances, computeMyNet } from '../lib/balances';
import { groupEntriesByDate } from '../lib/dateGroups';
import { colors, fonts } from '../theme';
import type { Entry, EntryType, Group, Profile } from '../types';
import { DEMO_ENTRIES, DEMO_GROUP, DEMO_ME_ID, DEMO_MEMBERS } from './mockData';

type Tab = 'balance' | 'ledger';
let demoIdSeq = 100;

export default function DemoGroupScreen({ onBack }: { onBack: () => void }) {
  const [entries, setEntries] = useState<Entry[]>(DEMO_ENTRIES);
  const [members, setMembers] = useState<Profile[]>(DEMO_MEMBERS);
  const [group, setGroup] = useState<Group>(DEMO_GROUP);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [avatarPickerOpen, setAvatarPickerOpen] = useState(false);
  const [groupIconPickerOpen, setGroupIconPickerOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('balance');
  const [showSettled, setShowSettled] = useState(false);
  const meId = DEMO_ME_ID;
  const me = members.find((m) => m.id === meId);

  const nameOf = (id: string) => members.find((m) => m.id === id)?.display_name ?? '不明';
  const emojiOf = (id: string) => members.find((m) => m.id === id)?.avatar_emoji ?? null;
  const balances = useMemo(() => computeBalances(entries, meId), [entries]);
  const netTotals = useMemo(() => computeMyNet(entries, meId), [entries]);
  const visibleEntries = useMemo(() => (showSettled ? entries : entries.filter((e) => !e.settled)), [entries, showSettled]);
  const sections = useMemo(() => groupEntriesByDate(visibleEntries), [visibleEntries]);
  const settledCount = entries.length - entries.filter((e) => !e.settled).length;

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
      settled: false,
      created_by: meId,
      created_at: new Date().toISOString(),
    };
    setEntries((prev) => [entry, ...prev]);
    return { error: null };
  };

  const toggleSettled = (e: Entry) => setEntries((prev) => prev.map((x) => (x.id === e.id ? { ...x, settled: !x.settled } : x)));
  const deleteEntry = (e: Entry) => setEntries((prev) => prev.filter((x) => x.id !== e.id));
  const settlePair = (type: EntryType, a: string, b: string, currency: string | null) => {
    setEntries((prev) =>
      prev.map((e) => {
        if (e.settled || e.type !== type) return e;
        const match =
          type === 'money'
            ? (e.currency || 'JPY') === (currency || 'JPY') && ((e.from_user === a && e.to_user === b) || (e.from_user === b && e.to_user === a))
            : e.from_user === a && e.to_user === b;
        return match ? { ...e, settled: true } : e;
      })
    );
  };

  const header = (
    <View>
      <View style={styles.demoBanner}>
        <Text style={styles.demoBannerText}>デモモード(Supabase未接続・操作はこの端末だけに反映されます)</Text>
      </View>
      <View style={styles.headerRow}>
        <Pressable onPress={onBack} hitSlop={10}>
          <Text style={styles.back}>‹ グループ</Text>
        </Pressable>
      </View>
      <Pressable onPress={() => setGroupIconPickerOpen(true)} style={styles.titleRow}>
        <Mark size={40} glyph={group.icon_emoji ?? undefined} />
        <Text style={styles.title}>{group.name}</Text>
      </Pressable>

      <View style={styles.memberStrip}>
        {members.map((m) =>
          m.id === meId ? (
            <Pressable key={m.id} onPress={() => setAvatarPickerOpen(true)} style={styles.memberChip}>
              <Avatar name={m.display_name} emoji={m.avatar_emoji} size="sm" />
              <Text style={styles.memberName}>{m.display_name}</Text>
              <Text style={styles.editHint}>変更</Text>
            </Pressable>
          ) : (
            <View key={m.id} style={styles.memberChip}>
              <Avatar name={m.display_name} emoji={m.avatar_emoji} size="sm" />
              <Text style={styles.memberName}>{m.display_name}</Text>
            </View>
          )
        )}
        <Pressable onPress={() => Alert.alert('デモモードでは招待できません')} style={styles.inviteChip}>
          <Text style={styles.inviteChipText}>＋ 招待</Text>
        </Pressable>
      </View>

      <View style={styles.tabs}>
        <Pressable onPress={() => setTab('balance')} style={[styles.tabBtn, tab === 'balance' && styles.tabBtnActive]}>
          <Text style={[styles.tabText, tab === 'balance' && styles.tabTextActive]}>残高</Text>
        </Pressable>
        <Pressable onPress={() => setTab('ledger')} style={[styles.tabBtn, tab === 'ledger' && styles.tabBtnActive]}>
          <Text style={[styles.tabText, tab === 'ledger' && styles.tabTextActive]}>台帳</Text>
        </Pressable>
      </View>
    </View>
  );

  return (
    <View style={styles.wrap}>
      {tab === 'balance' ? (
        <FlatList
          data={balances}
          keyExtractor={(row, i) => `${row.debtor}-${row.creditor}-${row.type}-${row.currency}-${i}`}
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            <View>
              {header}
              <NetSummary totals={netTotals} />
              {balances.length > 0 && <Text style={styles.sectionTitle}>内訳</Text>}
            </View>
          }
          renderItem={({ item }) => (
            <BalanceCard
              row={item}
              nameOf={nameOf}
              emojiOf={emojiOf}
              meId={meId}
              onSettle={() => settlePair(item.type, item.debtor, item.creditor, item.currency)}
            />
          )}
          ItemSeparatorComponent={() => <View style={styles.hairline} />}
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
                  <Text style={styles.settledToggleText}>{showSettled ? '精算済みを隠す' : `精算済み${settledCount}件を表示`}</Text>
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

      <AddEntrySheet visible={sheetOpen} members={members} meId={meId} onClose={() => setSheetOpen(false)} onSubmit={addEntry} />

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
  title: { ...fonts.display, fontSize: 26, color: colors.ink },
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
    marginBottom: 4,
  },
  dateHeader: { ...fonts.bodySemiBold, fontSize: 12.5, color: colors.muted, marginTop: 14, marginBottom: 2 },
  settledToggle: { alignSelf: 'flex-start', marginBottom: 6 },
  settledToggleText: { ...fonts.bodyMedium, fontSize: 13, color: colors.accent },
  hairline: { height: 1, backgroundColor: colors.line },
});
