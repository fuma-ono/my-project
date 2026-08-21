// デモモード専用。GroupScreen.tsxと同じ見た目・操作感を、Supabaseを
// 一切呼ばずローカルstateだけで再現する(スクリーンショット・動作確認用)。
import { useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import AddEntrySheet from '../components/AddEntrySheet';
import Avatar from '../components/Avatar';
import BalanceCard from '../components/BalanceCard';
import EntryRow from '../components/EntryRow';
import { computeBalances } from '../lib/balances';
import { colors, fonts } from '../theme';
import type { Entry, EntryType } from '../types';
import { DEMO_ENTRIES, DEMO_GROUP, DEMO_ME_ID, DEMO_MEMBERS } from './mockData';

let demoIdSeq = 100;

export default function DemoGroupScreen({ onBack }: { onBack: () => void }) {
  const [entries, setEntries] = useState<Entry[]>(DEMO_ENTRIES);
  const [sheetOpen, setSheetOpen] = useState(false);
  const members = DEMO_MEMBERS;
  const meId = DEMO_ME_ID;

  const nameOf = (id: string) => members.find((m) => m.id === id)?.display_name ?? '不明';
  const balances = useMemo(() => computeBalances(entries, meId), [entries]);

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
      group_id: DEMO_GROUP.id,
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

  const toggleSettled = (e: Entry) => {
    setEntries((prev) => prev.map((x) => (x.id === e.id ? { ...x, settled: !x.settled } : x)));
  };
  const deleteEntry = (e: Entry) => {
    setEntries((prev) => prev.filter((x) => x.id !== e.id));
  };
  const settlePair = (type: EntryType, a: string, b: string, currency: string | null) => {
    setEntries((prev) =>
      prev.map((e) => {
        if (e.settled || e.type !== type) return e;
        const match =
          type === 'money'
            ? (e.currency || 'JPY') === (currency || 'JPY') &&
              ((e.from_user === a && e.to_user === b) || (e.from_user === b && e.to_user === a))
            : e.from_user === a && e.to_user === b;
        return match ? { ...e, settled: true } : e;
      })
    );
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.demoBanner}>
        <Text style={styles.demoBannerText}>デモモード(Supabase未接続・操作はこの端末だけに反映されます)</Text>
      </View>
      <FlatList
        data={entries}
        keyExtractor={(e) => e.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View>
            <View style={styles.headerRow}>
              <Pressable onPress={onBack} hitSlop={10}>
                <Text style={styles.back}>‹ グループ</Text>
              </Pressable>
            </View>
            <Text style={styles.title}>{DEMO_GROUP.name}</Text>

            <View style={styles.memberStrip}>
              {members.map((m) => (
                <View key={m.id} style={styles.memberChip}>
                  <Avatar name={m.display_name} size="sm" />
                  <Text style={styles.memberName}>{m.display_name}</Text>
                </View>
              ))}
              <Pressable onPress={() => Alert.alert('デモモードでは招待できません')} style={styles.inviteChip}>
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
          <EntryRow entry={item} nameOf={nameOf} onToggleSettled={toggleSettled} onDelete={deleteEntry} />
        )}
        ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
      />

      <Pressable onPress={() => setSheetOpen(true)} style={styles.fab}>
        <Text style={styles.fabText}>＋</Text>
      </Pressable>

      <AddEntrySheet visible={sheetOpen} members={members} meId={meId} onClose={() => setSheetOpen(false)} onSubmit={addEntry} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  demoBanner: { backgroundColor: colors.favor, paddingVertical: 8, paddingHorizontal: 16, paddingTop: 44 },
  demoBannerText: { fontFamily: fonts.bodySemiBold, fontSize: 12, color: '#fff', textAlign: 'center' },
  list: { padding: 20, paddingBottom: 100 },
  headerRow: { marginBottom: 4 },
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
