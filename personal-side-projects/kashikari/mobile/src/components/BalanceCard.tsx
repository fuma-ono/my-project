import { Pressable, StyleSheet, Text, View } from 'react-native';

import Avatar from './Avatar';
import { formatMoney } from '../lib/currency';
import { colors, fonts } from '../theme';
import type { BalanceRow } from '../types';

type Props = {
  row: BalanceRow;
  nameOf: (id: string) => string;
  meId: string | null;
  onSettle: () => void;
};

export default function BalanceCard({ row, nameOf, meId, onSettle }: Props) {
  const debtorLabel = row.mine && row.debtor === meId ? 'あなた' : nameOf(row.debtor);
  const creditorLabel = row.mine && row.creditor === meId ? 'あなた' : nameOf(row.creditor);
  const amountLabel = row.type === 'money' ? formatMoney(row.amount, row.currency) : `${row.amount}件`;

  return (
    <View style={[styles.card, row.mine && styles.mine]}>
      <View style={styles.topRow}>
        <View style={styles.pair}>
          <Avatar name={nameOf(row.debtor)} size="sm" />
          <Text style={[styles.name, row.mine && row.debtor === meId && styles.me]} numberOfLines={1}>
            {debtorLabel}
          </Text>
          <Text style={styles.arrow}>→</Text>
          <Avatar name={nameOf(row.creditor)} size="sm" />
          <Text style={[styles.name, row.mine && row.creditor === meId && styles.me]} numberOfLines={1}>
            {creditorLabel}
          </Text>
        </View>
        <Text style={[styles.amount, { color: row.type === 'money' ? colors.owe : colors.favor }]} numberOfLines={1}>
          {amountLabel}
        </Text>
      </View>
      <Pressable onPress={onSettle} style={styles.settleBtn}>
        <Text style={styles.settleText}>精算する</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 14,
    gap: 10,
    shadowColor: '#3c2814',
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  mine: { borderWidth: 1.5, borderColor: `${colors.accent}73` },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  pair: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0 },
  name: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.ink, flexShrink: 1 },
  me: { color: colors.accent },
  arrow: { color: colors.muted },
  amount: { fontFamily: fonts.display, fontSize: 18, flexShrink: 0 },
  settleBtn: {
    alignSelf: 'flex-end',
    backgroundColor: colors.accentSoft,
    borderRadius: 999,
    paddingVertical: 7,
    paddingHorizontal: 12,
  },
  settleText: { fontFamily: fonts.bodySemiBold, fontSize: 12.5, color: colors.accent },
});
