import { StyleSheet, Text, View } from 'react-native';

import { formatMoney } from '../lib/currency';
import { colors, fonts } from '../theme';
import type { NetTotal } from '../lib/balances';

// Venmo/Cash App的な「まず一番大事な数字を大きく見せる」ヒーロー表示。
// 「いまの貸し借り」画面を開いた瞬間に、自分がどっちなのかが分かることを狙う。
export default function NetSummary({ totals }: { totals: NetTotal[] }) {
  if (totals.length === 0) {
    return (
      <View style={styles.wrap}>
        <Text style={styles.emoji}>🎉</Text>
        <Text style={styles.settledText}>貸し借りはすべて精算済みです</Text>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      {totals.map((t) => {
        const owed = t.amount > 0; // 正値 = 自分が受け取る側(lib/balances.tsのNetTotal参照)
        return (
          <View key={t.currency} style={styles.line}>
            <Text style={[styles.label, { color: owed ? colors.positive : colors.negative }]}>
              {owed ? 'あなたが受け取る' : 'あなたが払う'}
            </Text>
            <Text style={[styles.amount, { color: owed ? colors.positive : colors.negative }]}>
              {formatMoney(Math.abs(t.amount), t.currency)}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 8 },
  line: { marginBottom: 14 },
  label: { fontFamily: fonts.bodySemiBold, fontSize: 13, marginBottom: 2 },
  amount: { fontFamily: fonts.display, fontSize: 40, letterSpacing: -0.5 },
  emoji: { fontSize: 32, marginBottom: 6 },
  settledText: { fontFamily: fonts.bodyMedium, fontSize: 15, color: colors.muted },
});
