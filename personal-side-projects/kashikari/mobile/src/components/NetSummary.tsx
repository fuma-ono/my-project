import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, Text, View } from 'react-native';

import { useT } from '../i18n';
import { formatMoney } from '../lib/currency';
import { colors, fonts } from '../theme';
import type { NetTotal } from '../lib/balances';
import type { BalanceRow } from '../types';

type Props = {
  totals: NetTotal[];
  // 「未精算N件」の代わりに「受取総額/支払総額」の内訳を出すため、
  // 内訳の生データ(balances)を受け取って通貨ごとに集計する。
  balances: BalanceRow[];
  meId: string | null;
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
// さらに、下部の「未精算N件」は件数より金額の根拠(受取総額・支払総額)
// の方が有益、という指摘を受けて差し替えた。ここに出す受取/支払は、
// 相手ごとに既にネット済みのbalances(内訳)を合算したもので、
// 受取−支払=上のヒーロー数字(net)と一致する。
export default function NetSummary({ totals, balances, meId }: Props) {
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
        let receivable = 0;
        let payable = 0;
        for (const b of balances) {
          if (!b.mine || b.type !== 'money' || b.currency !== total.currency) continue;
          if (b.creditor === meId) receivable += b.amount;
          else if (b.debtor === meId) payable += b.amount;
        }
        return (
          <View key={total.currency} style={[styles.line, i > 0 && styles.lineDivider]}>
            <Text style={styles.label}>{owed ? t.netSummary.receiving : t.netSummary.paying}</Text>
            <Text style={styles.amount}>{formatMoney(Math.abs(total.amount), total.currency)}</Text>
            <View style={styles.grossRow}>
              <Text style={styles.grossText}>{t.netSummary.grossReceivable(formatMoney(receivable, total.currency))}</Text>
              <Text style={styles.grossText}>{t.netSummary.grossPayable(formatMoney(payable, total.currency))}</Text>
            </View>
          </View>
        );
      })}
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
  grossRow: { flexDirection: 'row', gap: 16, marginTop: 12 },
  grossText: { ...fonts.bodyMedium, fontSize: 13, color: 'rgba(255,255,255,0.8)' },
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
