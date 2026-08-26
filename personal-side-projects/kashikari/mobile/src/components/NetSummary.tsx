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
      {/* 参考UIの残高カードに合わせて、右側に財布アイコン(装飾)を添えた。
          「主役は金額」という指摘を受け、財布アイコンは金額の邪魔に
          ならないよう、より薄くしている。「財布マークを¥500の横の
          位置に」という指摘を受け、見出し(heading)の右上ではなく、
          金額(amount)と高さが揃う位置まで下げた。 */}
      <Ionicons name="wallet" size={80} color="rgba(255,255,255,0.12)" style={styles.walletIcon} />
      <Text style={styles.heading}>{t.netSummary.heading}</Text>
      {totals.map((total, i) => {
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
                ラベルを削除した。さらに「¥500支払うと精算が完了します」の
                説明文(actionHint)も不要という指摘を受けて削除し、
                空いた分カード全体を縮小した。 */}
            <Text style={styles.amount}>{amountStr}</Text>
            {/* 参考UIに合わせ、「受取 ¥1,500」のような省略形1行ではなく、
                「受け取る金額」「支払う金額」を見出しにした2カラム構成にした。
                「支払う金額の右の›を、支払う金額と¥2,000の間の高さで
                右端に」という指摘を受け、カード右下角に絶対配置していた
                シェブロンを、この行(grossRow)の最後の要素として並べる
                形に変更した。grossRowはalignItems:'center'のため、
                2行(ラベル+金額)のグロス列と高さの異なるシェブロンは
                行全体の高さの中央=ちょうどラベルと金額の間の高さに
                自然と揃う。 */}
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
              <Ionicons name="chevron-forward" size={24} color="rgba(255,255,255,0.7)" style={styles.chevron} />
            </View>
          </View>
        );
      })}
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  // 「人のアイコンを大きくするんじゃなくて、あなたの残高の欄を
  // 大きくして。金額も大きく」という指摘を受け、前回縮めたpadding・
  // 金額のフォントサイズ・各要素間の余白を、前回より大きい値に
  // 戻した(単純な巻き戻しではなく、旧デザインより一段階大きくした)。
  // 「あなたの残高の枠も少し上に」「精算の進捗ももう少し上に」という
  // 指摘を受け、marginBottomを18→12に詰め、下の精算進捗カードとの
  // 間隔を縮めた(カード自体を上に動かすというより、後に続くカードとの
  // 余白を詰める形で対応)。
  card: { borderRadius: 24, padding: 24, marginBottom: 12, overflow: 'hidden' },
  // 「財布のマークを¥500の横の位置に」という指摘を受け、見出しの右上
  // (top:12)ではなく、金額(amount, fontSize46)の高さと揃うところまで
  // topを下げた。
  walletIcon: { position: 'absolute', top: 34, right: 6 },
  heading: {
    ...fonts.bodyMedium,
    fontSize: 13,
    color: 'rgba(255,255,255,0.65)',
    marginBottom: 6,
  },
  line: { paddingVertical: 2 },
  lineDivider: { marginTop: 6, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.22)', paddingTop: 10 },
  // 「¥500も大きく」という指摘を受け、40→46に拡大した。
  amount: { ...fonts.display, fontSize: 46, color: '#fff', letterSpacing: -0.5 },
  grossRow: { flexDirection: 'row', alignItems: 'center', marginTop: 14 },
  grossCol: { flex: 1 },
  grossDivider: { width: 1, height: 26, backgroundColor: 'rgba(255,255,255,0.25)', marginHorizontal: 14 },
  grossLabel: { ...fonts.bodyMedium, fontSize: 12, color: 'rgba(255,255,255,0.75)', marginBottom: 2 },
  grossAmount: { ...fonts.bodySemiBold, fontSize: 16, color: '#fff' },
  // grossRowの最後の要素として並ぶシェブロン(詳細はJSX側のコメント参照)。
  chevron: { marginLeft: 10 },
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
