import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, Text, View } from 'react-native';

import { useT } from '../i18n';
import { formatMoney } from '../lib/currency';
import { colors, fonts } from '../theme';
import type { NetTotal } from '../lib/balances';

type Props = {
  totals: NetTotal[];
  // 「未精算N件」の表示用。相手ごとの内訳(BalanceCard)のうち、自分が
  // 関係している行の件数を渡してもらう(このカード単体では件数を
  // 計算できないため、GroupScreen側から渡す)。
  unsettledCount: number;
};

// Venmo/Cash App的な「まず一番大事な数字を大きく見せる」ヒーロー表示。
// ブランドのグラデーション(コーラル→プラム)を使った1枚のカードにして、
// 「決まった」印象を作る狙い。カード内は白文字で統一し、色の意味付け
// (緑/赤)は下の内訳リスト側で担う(グラデーションの上で赤緑を使うと
// 逆に読みにくくなるため)。
//
// 「受け取り/支払い」という名詞だけだと、誰が受け取る・払う側なのかを
// 一瞬考える必要があった、という指摘を受け、「あなたの残高」という
// 見出しと「受け取る金額/支払う金額」という動詞込みの言い方に変えた。
// 開いた瞬間に自分の行動(いくら払う/もらうか)が分かることを優先する。
export default function NetSummary({ totals, unsettledCount }: Props) {
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
      <Text style={styles.heading}>{t.netSummary.heading}</Text>
      {totals.map((total, i) => {
        const owed = total.amount > 0; // 正値 = 自分が受け取る側(lib/balances.tsのNetTotal参照)
        return (
          <View key={total.currency} style={[styles.line, i > 0 && styles.lineDivider]}>
            <Text style={styles.label}>{owed ? t.netSummary.receiving : t.netSummary.paying}</Text>
            <Text style={styles.amount}>{formatMoney(Math.abs(total.amount), total.currency)}</Text>
          </View>
        );
      })}
      {unsettledCount > 0 && <Text style={styles.footer}>{t.netSummary.unsettledCount(unsettledCount)}</Text>}
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 24, padding: 24, marginBottom: 8 },
  heading: {
    ...fonts.bodySemiBold,
    fontSize: 13,
    color: 'rgba(255,255,255,0.85)',
    marginBottom: 14,
  },
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
  footer: {
    ...fonts.bodyMedium,
    fontSize: 12.5,
    color: 'rgba(255,255,255,0.75)',
    marginTop: 14,
  },
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
