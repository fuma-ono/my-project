import { Pressable, StyleSheet, Text, View } from 'react-native';

import Avatar from './Avatar';
import { formatMoney } from '../lib/currency';
import { colors, fonts } from '../theme';
import type { BalanceRow } from '../types';

type Props = {
  row: BalanceRow;
  nameOf: (id: string) => string;
  emojiOf: (id: string) => string | null;
  meId: string | null;
  onSettle: () => void;
};

// Splitwiseに倣い、「あなたが受け取る=緑」「あなたが払う=赤」という意味を持つ
// 色分けにする(単なる装飾ではなく、金額の向きを一目で伝えるための色)。
// 自分が関係しない行(グループ内の他の2人同士)は色を付けずニュートラルにする。
export default function BalanceCard({ row, nameOf, emojiOf, meId, onSettle }: Props) {
  const debtorLabel = row.mine && row.debtor === meId ? 'あなた' : nameOf(row.debtor);
  const creditorLabel = row.mine && row.creditor === meId ? 'あなた' : nameOf(row.creditor);
  const amountLabel = row.type === 'money' ? formatMoney(row.amount, row.currency) : `${row.amount}件`;

  const iOwe = row.mine && row.debtor === meId;
  const iAmOwed = row.mine && row.creditor === meId;
  const amountColor = iOwe ? colors.negative : iAmOwed ? colors.positive : colors.muted;
  const directionLabel = iOwe ? '払う' : iAmOwed ? '受け取る' : null;

  return (
    <View style={styles.row}>
      <View style={styles.pair}>
        <Avatar name={nameOf(row.debtor)} emoji={emojiOf(row.debtor)} size="sm" />
        <Text style={[styles.name, row.debtor === meId && styles.me]} numberOfLines={1}>
          {debtorLabel}
        </Text>
        <Text style={styles.arrow}>→</Text>
        <Avatar name={nameOf(row.creditor)} emoji={emojiOf(row.creditor)} size="sm" />
        <Text style={[styles.name, row.creditor === meId && styles.me]} numberOfLines={1}>
          {creditorLabel}
        </Text>
      </View>

      <View style={styles.right}>
        <View style={styles.amountBlock}>
          {directionLabel && <Text style={[styles.directionLabel, { color: amountColor }]}>{directionLabel}</Text>}
          <Text style={[styles.amount, { color: amountColor }]} numberOfLines={1}>
            {amountLabel}
          </Text>
        </View>
        <Pressable onPress={onSettle} hitSlop={8} style={styles.settleBtn}>
          <Text style={styles.settleText}>精算</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingVertical: 14,
  },
  pair: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0 },
  name: { ...fonts.bodyMedium, fontSize: 14.5, color: colors.ink, flexShrink: 1 },
  me: { ...fonts.bodySemiBold },
  arrow: { color: colors.muted },
  right: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  amountBlock: { alignItems: 'flex-end' },
  directionLabel: { ...fonts.bodyMedium, fontSize: 11, marginBottom: 1 },
  amount: { ...fonts.display, fontSize: 19, flexShrink: 0 },
  settleBtn: {
    backgroundColor: colors.surface2,
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  settleText: { ...fonts.bodySemiBold, fontSize: 12, color: colors.muted },
});
