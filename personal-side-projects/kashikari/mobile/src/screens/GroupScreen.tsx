import { useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, RefreshControl, SectionList, Share, StyleSheet, Text, View } from 'react-native';

import AddEntrySheet from '../components/AddEntrySheet';
import Avatar from '../components/Avatar';
import AvatarPicker from '../components/AvatarPicker';
import BalanceCard from '../components/BalanceCard';
import EntryRow from '../components/EntryRow';
import Fab from '../components/Fab';
import GroupIconPicker from '../components/GroupIconPicker';
import Mark from '../components/Mark';
import NetSummary from '../components/NetSummary';
import { useGroupData } from '../hooks/useGroupData';
import { computeBalances, computeMyNet } from '../lib/balances';
import { groupEntriesByDate } from '../lib/dateGroups';
import { colors, fonts } from '../theme';
import type { Group } from '../types';

type Tab = 'balance' | 'ledger';

type Props = {
  group: Group;
  meId: string | null;
  onBack: () => void;
  onLeave: (groupId: string) => Promise<{ error: string | null }>;
  onChangeAvatar: (emoji: string) => Promise<{ error: string | null }>;
  onChangeGroupIcon: (emoji: string) => Promise<{ error: string | null }>;
};

export default function GroupScreen({ group, meId, onBack, onLeave, onChangeAvatar, onChangeGroupIcon }: Props) {
  const { members, entries, loading, refresh, addEntry, toggleSettled, deleteEntry, settlePair } = useGroupData(group.id, meId);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [avatarPickerOpen, setAvatarPickerOpen] = useState(false);
  const [groupIconPickerOpen, setGroupIconPickerOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('balance');
  const [showSettled, setShowSettled] = useState(false);

  const nameOf = (id: string) => members.find((m) => m.id === id)?.display_name ?? '不明';
  const emojiOf = (id: string) => members.find((m) => m.id === id)?.avatar_emoji ?? null;
  const me = members.find((m) => m.id === meId);
  const balances = useMemo(() => computeBalances(entries, meId), [entries, meId]);
  const netTotals = useMemo(() => computeMyNet(entries, meId), [entries, meId]);

  const visibleEntries = useMemo(
    () => (showSettled ? entries : entries.filter((e) => !e.settled)),
    [entries, showSettled]
  );
  const sections = useMemo(() => groupEntriesByDate(visibleEntries), [visibleEntries]);
  const settledCount = entries.length - entries.filter((e) => !e.settled).length;

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

  const invite = () => {
    Share.share({ message: `kashikariの「${group.name}」に招待するよ。アプリを開いて招待コード「${group.invite_code}」で参加してね。` });
  };

  const leave = () => {
    Alert.alert('グループを抜けますか?', `「${group.name}」の記録は他のメンバーの画面には残りますが、あなたはこのグループのデータにアクセスできなくなります。`, [
      { text: 'キャンセル', style: 'cancel' },
      {
        text: '抜ける',
        style: 'destructive',
        onPress: async () => {
          const res = await onLeave(group.id);
          if (res.error) {
            Alert.alert('抜けられませんでした', res.error);
            return;
          }
          onBack();
        },
      },
    ]);
  };

  const header = (
    <View>
      <View style={styles.headerRow}>
        <Pressable onPress={onBack} hitSlop={10}>
          <Text style={styles.back}>‹ グループ</Text>
        </Pressable>
        <Pressable onPress={leave} hitSlop={10}>
          <Text style={styles.leave}>抜ける</Text>
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
        <Pressable onPress={invite} style={styles.inviteChip}>
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

  if (tab === 'balance') {
    return (
      <View style={styles.wrap}>
        <FlatList
          data={balances}
          keyExtractor={(row, i) => `${row.debtor}-${row.creditor}-${row.type}-${row.currency}-${i}`}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} tintColor={colors.accent} />}
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
        <Fab onPress={() => setSheetOpen(true)} disabled={members.length < 2} />
        <AddEntrySheet visible={sheetOpen} members={members} meId={meId} onClose={() => setSheetOpen(false)} onSubmit={addEntry} />
        {avatarPicker}
        {groupIconPicker}
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
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
                  {showSettled ? '精算済みを隠す' : `精算済み${settledCount}件を表示`}
                </Text>
              </Pressable>
            )}
          </View>
        }
        renderSectionHeader={({ section }) => <Text style={styles.dateHeader}>{section.title}</Text>}
        renderItem={({ item }) => (
          <EntryRow entry={item} nameOf={nameOf} meId={meId} onToggleSettled={(e) => toggleSettled(e.id, !e.settled)} onDelete={(e) => deleteEntry(e.id)} />
        )}
        ItemSeparatorComponent={() => <View style={styles.hairline} />}
        ListEmptyComponent={
          !loading ? <Text style={styles.emptyNote}>まだ記録がありません。右下の「＋」から最初の貸し借りを記録しましょう。</Text> : null
        }
      />
      <Fab onPress={() => setSheetOpen(true)} disabled={members.length < 2} />
      <AddEntrySheet visible={sheetOpen} members={members} meId={meId} onClose={() => setSheetOpen(false)} onSubmit={addEntry} />
      {avatarPicker}
      {groupIconPicker}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  list: { paddingHorizontal: 20, paddingBottom: 100 },
  headerRow: { marginTop: 44, marginBottom: 4, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  back: { ...fonts.bodySemiBold, fontSize: 15, color: colors.accent },
  leave: { ...fonts.bodyMedium, fontSize: 12.5, color: colors.muted },
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
