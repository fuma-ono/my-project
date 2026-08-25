import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, Text, View } from 'react-native';

import { useT } from '../i18n';
import { formatMoney } from '../lib/currency';
import { colors, fonts } from '../theme';
import type { NetTotal } from '../lib/balances';

// Venmo/Cash App的な「まず一番大事な数字を大きく見せる」ヒーロー表示。
// ブランドのグラデーション(コーラル→プラム)を使った1枚のカードにして、
// 「決まった」印象を作る狙い。カード内は白文字で統一し、色の意味付け
// (緑/赤)は下の内訳リスト側で担う(グラデーションの上で赤緑を使うと
// 逆に読みにくくなるため)。
export default function NetSummary({ totals }: { totals: NetTotal[] }) {
  const t = useT();

  if (totals.length === 0) {
    return (
      <View style={styles.settledWrap}>
        <Text style={styles.emoji}>🎉</Text>
        <Text style={styles.settledText}>{t.netSummary.allSettled}</Text>
      </View>
    );
  }

  return (
    <LinearGradient colors={[colors.accent, colors.plum]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.card}>
      {totals.map((total, i) => {
        const owed = total.amount > 0; // 正値 = 自分が受け取る側(lib/balances.tsのNetTotal参照)
        return (
          <View key={total.currency} style={[styles.line, i > 0 && styles.lineDivider]}>
            <Text style={styles.label}>{owed ? t.netSummary.receiving : t.netSummary.paying}</Text>
            <Text style={styles.amount}>{formatMoney(Math.abs(total.amount), total.currency)}</Text>
          </View>
        );
      })}
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 24, padding: 24, marginBottom: 8 },
  line: { paddingVertical: 6 },
  lineDivider: { marginTop: 6, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.22)', paddingTop: 14 },
  label: {
    ...fonts.bodySemiBold,
    fontSize: 12.5,
    color: 'rgba(255,255,255,0.85)',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 2,
  },
  amount: { ...fonts.display, fontSize: 42, color: '#fff', letterSpacing: -0.5 },
  settledWrap: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    marginBottom: 8,
  },
  emoji: { fontSize: 30, marginBottom: 6 },
  settledText: { ...fonts.bodyMedium, fontSize: 15, color: colors.muted },
});
