import { Ionicons } from '@expo/vector-icons';
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
        <Text style={styles.settledTitle}>{t.netSummary.allSettledTitle}</Text>
        <Text style={styles.settledText}>{t.netSummary.allSettled}</Text>
      </View>
    );
  }

  return (
    <LinearGradient colors={[colors.accent, colors.plum]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.card}>
      {/* 参考UIの残高カードに合わせて、右上に財布アイコン(装飾)・右下に
          シェブロン(装飾。すぐ下に内訳セクションが続くため、タップ先は
          別途持たせていない)を添えた。「主役は金額」という指摘を受け、
          財布アイコンは金額の邪魔にならないよう、より薄くしている。 */}
      <Ionicons name="wallet" size={56} color="rgba(255,255,255,0.12)" style={styles.walletIcon} />
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
        const amountStr = formatMoney(Math.abs(total.amount), total.currency);
        return (
          <View key={total.currency} style={[styles.line, i > 0 && styles.lineDivider]}>
            {/* 「あなたの残高の下の支払う金額はいらない」という指摘を受け、
                見出し(heading)のすぐ下にあった「支払う金額/受け取る金額」
                ラベルを削除した。方向は下の説明文(actionHint)で伝わる。 */}
            <Text style={styles.amount}>{amountStr}</Text>
            {/* 「何をすべきか分かる説明を追加してもよい」という指摘への対応。 */}
            <Text style={styles.actionHint}>
              {owed ? t.netSummary.actionHintReceive(amountStr) : t.netSummary.actionHintPay(amountStr)}
            </Text>
            {/* 参考UIに合わせ、「受取 ¥1,500」のような省略形1行ではなく、
                「受け取る金額」「支払う金額」を見出しにした2カラム構成にした。 */}
            <View style={styles.grossRow}>
              <View style={styles.grossCol}>
                <Text style={styles.grossLabel}>{t.netSummary.receiving}</Text>
                <Text style={styles.grossAmount}>{formatMoney(receivable, total.currency)}</Text>
              </View>
              <View style={styles.grossDivider} />
              <View style={styles.grossCol}>
                <Text style={styles.grossLabel}>{t.netSummary.paying}</Text>
                <Text style={styles.grossAmount}>{formatMoney(payable, total.currency)}</Text>
              </View>
            </View>
          </View>
        );
      })}
      <Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.7)" style={styles.chevron} />
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  // 「画像と比べて大きすぎる」という指摘を受け、padding・金額の
  // フォントサイズ・各要素間の余白を全体的に詰めた(以前の見直しで
  // 逆に広げすぎていた)。
  card: { borderRadius: 24, padding: 20, marginBottom: 18, overflow: 'hidden' },
  walletIcon: { position: 'absolute', top: 16, right: 16 },
  chevron: { position: 'absolute', bottom: 16, right: 16 },
  heading: {
    ...fonts.bodyMedium,
    fontSize: 12,
    color: 'rgba(255,255,255,0.65)',
    marginBottom: 6,
  },
  line: { paddingVertical: 2 },
  lineDivider: { marginTop: 4, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.22)', paddingTop: 10 },
  amount: { ...fonts.display, fontSize: 34, color: '#fff', letterSpacing: -0.5 },
  actionHint: { ...fonts.bodyMedium, fontSize: 12.5, color: 'rgba(255,255,255,0.8)', marginTop: 4 },
  grossRow: { flexDirection: 'row', alignItems: 'center', marginTop: 12, paddingRight: 24 },
  grossCol: { flex: 1 },
  grossDivider: { width: 1, height: 26, backgroundColor: 'rgba(255,255,255,0.25)', marginHorizontal: 14 },
  grossLabel: { ...fonts.bodyMedium, fontSize: 11.5, color: 'rgba(255,255,255,0.75)', marginBottom: 2 },
  grossAmount: { ...fonts.bodySemiBold, fontSize: 15, color: '#fff' },
  settledWrap: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    marginBottom: 8,
  },
  emoji: { fontSize: 30, marginBottom: 6 },
  settledTitle: { ...fonts.display, fontSize: 17, color: colors.ink, marginBottom: 2 },
  settledText: { ...fonts.bodyMedium, fontSize: 14, color: colors.muted },
});
