import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Entry } from '../types';
import { monthKey, summarizeMonth } from '../storage';

type Props = {
  entries: Entry[];
  monthKeyValue: string;
  onAdd: () => void;
  onExport: () => void;
  onDelete: (id: string) => void;
};

function formatYen(amount: number) {
  return `¥${amount.toLocaleString('ja-JP')}`;
}

export default function HomeScreen({ entries, monthKeyValue, onAdd, onExport, onDelete }: Props) {
  const summary = summarizeMonth(entries, monthKeyValue);
  const monthEntries = entries.filter((e) => monthKey(e.date) === monthKeyValue);
  const [year, month] = monthKeyValue.split('-');

  return (
    <View style={styles.container}>
      <Text style={styles.header}>サクッと経費</Text>
      <Text style={styles.monthLabel}>{year}年{Number(month)}月</Text>

      <View style={styles.summaryCard}>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>収入</Text>
          <Text style={[styles.summaryValue, styles.income]}>{formatYen(summary.income)}</Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>支出</Text>
          <Text style={[styles.summaryValue, styles.expense]}>{formatYen(summary.expense)}</Text>
        </View>
        <View style={[styles.summaryRow, styles.balanceRow]}>
          <Text style={styles.summaryLabel}>収支</Text>
          <Text style={styles.summaryValue}>{formatYen(summary.balance)}</Text>
        </View>
      </View>

      <View style={styles.actionRow}>
        <Pressable style={styles.primaryButton} onPress={onAdd}>
          <Text style={styles.primaryButtonText}>+ 記録する</Text>
        </Pressable>
        <Pressable style={styles.secondaryButton} onPress={onExport}>
          <Text style={styles.secondaryButtonText}>CSV書き出し</Text>
        </Pressable>
      </View>

      <FlatList
        style={styles.list}
        data={monthEntries}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={<Text style={styles.empty}>この月の記録はまだありません</Text>}
        renderItem={({ item }) => (
          <Pressable style={styles.entryRow} onLongPress={() => onDelete(item.id)}>
            <View>
              <Text style={styles.entryCategory}>{item.category}</Text>
              <Text style={styles.entryMeta}>
                {item.date}
                {item.memo ? ` ・ ${item.memo}` : ''}
              </Text>
            </View>
            <Text style={[styles.entryAmount, item.type === 'income' ? styles.income : styles.expense]}>
              {item.type === 'income' ? '+' : '-'}
              {formatYen(item.amount)}
            </Text>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0b0e1a', paddingTop: 64, paddingHorizontal: 20 },
  header: { color: 'white', fontSize: 22, fontWeight: '700' },
  monthLabel: { color: '#9a9ab0', fontSize: 14, marginTop: 4, marginBottom: 20 },
  summaryCard: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 16,
    padding: 18,
    marginBottom: 20,
  },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  balanceRow: { marginTop: 8, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.1)', paddingTop: 8, marginBottom: 0 },
  summaryLabel: { color: '#c8c8e0', fontSize: 14 },
  summaryValue: { color: 'white', fontSize: 16, fontWeight: '700' },
  income: { color: '#6fe3a0' },
  expense: { color: '#ff8a8a' },
  actionRow: { flexDirection: 'row', gap: 10, marginBottom: 20 },
  primaryButton: {
    flex: 1,
    backgroundColor: '#5b3df0',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryButtonText: { color: 'white', fontSize: 15, fontWeight: '700' },
  secondaryButton: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  secondaryButtonText: { color: '#d8d8ea', fontSize: 15, fontWeight: '600' },
  list: { flex: 1 },
  empty: { color: '#7a7a90', fontSize: 13, textAlign: 'center', marginTop: 40 },
  entryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  entryCategory: { color: 'white', fontSize: 15, fontWeight: '600' },
  entryMeta: { color: '#8a8aa0', fontSize: 12, marginTop: 2 },
  entryAmount: { fontSize: 15, fontWeight: '700' },
});
