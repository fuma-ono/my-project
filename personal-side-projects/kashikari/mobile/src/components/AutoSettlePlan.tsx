import { Share, StyleSheet, Text, View } from 'react-native';

import Avatar from './Avatar';
import PrimaryButton from './PrimaryButton';
import { useT } from '../i18n';
import { formatMoney } from '../lib/currency';
import { buildSettlementShareText } from '../lib/shareText';
import { colors, fonts } from '../theme';
import type { SimplifiedTransaction } from '../types';

type Props = {
  groupName: string;
  currency: string;
  transactions: SimplifiedTransaction[];
  nameOf: (id: string) => string;
  emojiOf: (id: string) => string | null;
  meId: string | null;
  onSettleAll: () => Promise<{ error: string | null }>;
};

// 「自動精算」機能の見た目。個々の相手ごとの内訳(BalanceCard)とは別枠で、
// グループ全体を最小の支払い回数にまとめたプランをカードで見せる。
// このカードは、それが実際に減らせている場合(pairwiseの行数より
// simplifiedの行数が少ない場合)にだけGroupScreen側で表示される。
export default function AutoSettlePlan({ groupName, currency, transactions, nameOf, emojiOf, meId, onSettleAll }: Props) {
  const t = useT();

  const shareText = () =>
    buildSettlementShareText(groupName, transactions, nameOf, {
      heading: t.share.settlementHeading,
      closing: t.share.settlementClosing,
    });

  const share = () => {
    Share.share({ message: shareText() });
  };

  // 「まとめて精算する」は、精算して終わりではなく、そのままLINE等への
  // 共有シートまで開く(精算結果を相手に伝えるところまでが目的のため)。
  // 「共有する」ボタン単体は、精算前にプランだけ先に伝えたい場合用。
  const settleAndShare = async () => {
    const res = await onSettleAll();
    if (!res.error) share();
  };

  // アルゴリズムの説明("最小N回の支払いで…")より、自分にとっての
  // メリット("自分がいくら払えば/受け取れば終わるか")を伝える方が
  // わかりやすい、という指摘への対応。このプランの中に自分の支払い/
  // 受け取りがあればそれを、無ければ("自分は関係ないがグループ全体を
  // 見せている"場合)汎用の説明文を出す。
  const mine = transactions.find((tx) => tx.debtor === meId || tx.creditor === meId);
  const subtitle = mine
    ? mine.debtor === meId
      ? t.group.autoSettleSubtitleMinePay(formatMoney(mine.amount, currency))
      : t.group.autoSettleSubtitleMineReceive(formatMoney(mine.amount, currency))
    : t.group.autoSettleSubtitleGeneric;

  return (
    <View style={styles.card}>
      <Text style={styles.title}>{t.group.autoSettleTitle}</Text>
      <Text style={styles.subtitle}>{subtitle}</Text>

      <View style={styles.rows}>
        {transactions.map((tx, i) => (
          <View key={`${tx.debtor}-${tx.creditor}-${i}`} style={styles.row}>
            <Avatar name={nameOf(tx.debtor)} emoji={emojiOf(tx.debtor)} size="sm" />
            <Text style={styles.name} numberOfLines={1}>
              {nameOf(tx.debtor)}
            </Text>
            <Text style={styles.arrow}>→</Text>
            <Avatar name={nameOf(tx.creditor)} emoji={emojiOf(tx.creditor)} size="sm" />
            <Text style={styles.name} numberOfLines={1}>
              {nameOf(tx.creditor)}
            </Text>
            <Text style={styles.amount} numberOfLines={1}>
              {formatMoney(tx.amount, currency)}
            </Text>
          </View>
        ))}
      </View>

      {/* 「共有する/まとめて精算するの重要度を明確にする」という指摘を
          受け、共有するは白背景＋枠線のsecondaryボタンに変更した
          (以前はテキストのみのghost)。 */}
      <View style={styles.actions}>
        <PrimaryButton title={t.group.autoSettleShareButton} variant="secondary" compact onPress={share} style={styles.shareButton} />
        <PrimaryButton title={t.group.autoSettleButton} compact onPress={settleAndShare} style={styles.settleButton} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // 「グラデーションを多用しすぎない。その他は白背景＋薄いグレーの
  // 境界線を基本とする」という指摘を受け、枠線をブランドカラー
  // (accentSoft)から薄いグレー(line)に変更した。
  // 「おすすめの精算の枠も＋より上に収めたい。文字や幅などを調整して」
  // という指摘を受け、カード全体を一回り詰めた(padding・行間・
  // フォントサイズを縮小し、カードの高さ自体を縮めて、右下に浮く
  // ＋ボタン(FAB)より上に収まるようにした)。
  card: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    padding: 12,
    marginBottom: 18,
    borderWidth: 1.5,
    borderColor: colors.line,
  },
  title: { ...fonts.bodySemiBold, fontSize: 14, color: colors.ink },
  // 「『¥500支払うだけで精算完了します』の説明を目立たせる」という
  // 指摘を受け、色をmutedからaccentに、太さをbodySemiBoldに変更した。
  subtitle: { ...fonts.bodySemiBold, fontSize: 12, color: colors.accent, marginTop: 2, marginBottom: 6 },
  rows: { gap: 6, marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { ...fonts.bodyMedium, fontSize: 12.5, color: colors.ink, flexShrink: 1 },
  arrow: { color: colors.muted },
  amount: { ...fonts.bodySemiBold, fontSize: 12.5, color: colors.ink, marginLeft: 'auto' },
  // 「＋ボタンがこのカードと重なっている」という指摘への対応。右下に
  // 浮くFAB(幅50・右余白20)の左端までボタンの右端が収まるよう余白を
  // 確保している(FABを60→50に縮小したのに合わせてpaddingRightも
  // 44→36に調整)。ボタン自体もcompact(左右paddingを詰める)にして、
  // 「まとめて精算する」が1行に収まる幅を残した。
  actions: { flexDirection: 'row', gap: 6, paddingRight: 36 },
  shareButton: {},
  settleButton: { flex: 1 },
});
