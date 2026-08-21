import { useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, Share, StyleSheet, Text, View } from 'react-native';

import AddEntrySheet from '../components/AddEntrySheet';
import Avatar from '../components/Avatar';
import BalanceCard from '../components/BalanceCard';
import EntryRow from '../components/EntryRow';
import { useGroupData } from '../hooks/useGroupData';
import { computeBalances } from '../lib/balances';
import { colors, fonts } from '../theme';
import type { Group } from '../types';

export default function GroupScreen({ group, meId, onBack }: { group: Group; meId: string | null; onBack: () => void }) {
  const { members, entries, loading, refresh, addEntry, toggleSettled, deleteEntry, settlePair } = useGroupData(group.id, meId);
  const [sheetOpen, setSheetOpen] = useState(false);

  const nameOf = (id: string) => members.find((m) => m.id === id)?.display_name ?? '不明';
  const balances = useMemo(() => computeBalances(entries, meId), [entries, meId]);

  const invite = () => {
    Share.share({ message: `kashikariの「${group.name}」に招待するよ。アプリを開いて招待コード「${group.invite_code}」で参加してね。` });
  };

  return (
    <View style={styles.wrap}>
      <FlatList
        data={entries}
        keyExtractor={(e) => e.id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} tintColor={colors.accent} />}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View>
            <View style={styles.headerRow}>
              <Pressable onPress={onBack} hitSlop={10}>
                <Text style={styles.back}>‹ グループ</Text>
              </Pressable>
            </View>
            <Text style={styles.title}>{group.name}</Text>

            <View style={styles.memberStrip}>
              {members.map((m) => (
                <View key={m.id} style={styles.memberChip}>
                  <Avatar name={m.display_name} size="sm" />
                  <Text style={styles.memberName}>{m.display_name}</Text>
                </View>
              ))}
              <Pressable onPress={invite} style={styles.inviteChip}>
                <Text style={styles.inviteChipText}>＋ 招待</Text>
              </Pressable>
            </View>

            <Text style={styles.sectionTitle}>いまの貸し借り</Text>
            {balances.length === 0 ? (
              <View style={styles.settledAll}>
                <Text style={styles.settledAllText}>🎉 今のところ貸し借りはすべて精算済みです</Text>
              </View>
            ) : (
              <View style={styles.balanceList}>
                {balances.map((row, i) => (
                  <BalanceCard
                    key={`${row.debtor}-${row.creditor}-${row.type}-${row.currency}-${i}`}
                    row={row}
                    nameOf={nameOf}
                    meId={meId}
                    onSettle={() => settlePair(row.type, row.debtor, row.creditor, row.currency)}
                  />
                ))}
              </View>
            )}

            <Text style={styles.sectionTitle}>台帳</Text>
          </View>
        }
        renderItem={({ item }) => (
          <EntryRow
            entry={item}
            nameOf={nameOf}
            onToggleSettled={(e) => toggleSettled(e.id, !e.settled)}
            onDelete={(e) => deleteEntry(e.id)}
          />
        )}
        ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
        ListEmptyComponent={
          !loading ? (
            <Text style={styles.emptyNote}>まだ記録がありません。右下の「＋」から最初の貸し借りを記録しましょう。</Text>
          ) : null
        }
      />

      <Pressable onPress={() => setSheetOpen(true)} style={styles.fab} disabled={members.length < 2}>
        <Text style={styles.fabText}>＋</Text>
      </Pressable>

      <AddEntrySheet visible={sheetOpen} members={members} meId={meId} onClose={() => setSheetOpen(false)} onSubmit={addEntry} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  list: { padding: 20, paddingBottom: 100 },
  headerRow: { marginTop: 44, marginBottom: 4 },
  back: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.accent },
  title: { fontFamily: fonts.display, fontSize: 28, color: colors.ink, marginTop: 6, marginBottom: 16 },
  memberStrip: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 22 },
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
  memberName: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: colors.ink },
  inviteChip: {
    borderWidth: 1.5,
    borderColor: colors.muted,
    borderStyle: 'dashed',
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 14,
    justifyContent: 'center',
  },
  inviteChipText: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: colors.muted },
  sectionTitle: {
    fontFamily: fonts.display,
    fontSize: 14,
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 12,
  },
  balanceList: { gap: 10, marginBottom: 26 },
  settledAll: { backgroundColor: colors.surface, borderRadius: 16, padding: 22, alignItems: 'center', marginBottom: 26 },
  settledAllText: { fontFamily: fonts.body, fontSize: 14.5, color: colors.muted },
  emptyNote: { fontFamily: fonts.body, fontSize: 14.5, color: colors.muted, textAlign: 'center', paddingVertical: 24 },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 28,
    width: 60,
    height: 60,
    borderRadius: 999,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.accent,
    shadowOpacity: 0.4,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  fabText: { fontFamily: fonts.display, fontSize: 30, color: colors.accentInk },
});
