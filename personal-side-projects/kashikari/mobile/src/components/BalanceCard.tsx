import { Pressable, StyleSheet, Text, View } from 'react-native';

import Avatar from './Avatar';
import { useT } from '../i18n';
import { formatMoney } from '../lib/currency';
import { daysSince } from '../lib/balances';
import { openRemindPrompt } from '../lib/remind';
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
//
// 以前は「はなこ → あなた」のような矢印表記だったが、「誰が受け取る/払う
// 側なのか一瞬考える必要がある」という指摘を受け、自分が関係する行は
// 「はなこから受け取る」「はなこへ支払う」という文章表記に変えた
// (相手の名前と向きが1つの文で読める)。自分が関係しない行(グループ内の
// 他の2人同士)には「あなた」という基準点が無いため、従来通り
// 「A → B」の表記のまま。
//
// 「催促する」ボタンを追加した際、1行に名前ペア+金額+ボタン2つを
// 詰め込むと長い名前・長い通貨表記(例: "$20.00 USD")で名前が
// "は…"のように潰れてしまったため、上段(名前/文章+金額)と
// 下段(アクションボタン)の2段組みに分けている。
export default function BalanceCard({ row, nameOf, emojiOf, meId, onSettle }: Props) {
  const t = useT();
  // 残高画面は金額確認のための画面のため、頼みごと(金額を持たない)でも
  // 「1件」のような件数をここに出さない(件数確認は台帳側の役割)。
  const amountLabel = row.type === 'money' ? formatMoney(row.amount, row.currency) : t.balanceCard.noAmountLabel;

  const iOwe = row.mine && row.debtor === meId;
  const iAmOwed = row.mine && row.creditor === meId;
  // 色の意味を「受け取る=緑・支払う=赤・金額未設定=グレー」に統一する。
  // 頼みごとは金額を持たない(「金額未設定」表示)ため、向き(iOwe/iAmOwed)
  // に関わらずグレー固定にする。
  const amountColor = row.type !== 'money' ? colors.muted : iOwe ? colors.negative : iAmOwed ? colors.positive : colors.muted;

  // 「催促する」は、自分が受け取る側(相手が自分にお金を払っていない)の
  // 場合だけ意味があるので、それ以外では出さない。頼みごとは金額が
  // 無いため文面が作れず対象外(お金のみ)。同じ理由で、未払い日数も
  // 受け取る側の行にだけ添える(「回収」導線としての意味がある情報のため)。
  const canRemind = iAmOwed && row.type === 'money';
  const remind = () => openRemindPrompt(t, amountLabel);

  return (
    <View style={styles.card}>
      <View style={styles.topRow}>
        {row.mine ? (
          <MineLine row={row} nameOf={nameOf} emojiOf={emojiOf} iOwe={iOwe} t={t} />
        ) : (
          <OtherPairLine row={row} nameOf={nameOf} emojiOf={emojiOf} />
        )}
        <View style={styles.amountCol}>
          <Text style={[styles.amount, { color: amountColor }]} numberOfLines={1}>
            {amountLabel}
          </Text>
          {canRemind && <Text style={styles.daysAgo}>{t.balanceCard.daysAgo(daysSince(row.oldestUnsettledAt))}</Text>}
        </View>
      </View>

      <View style={styles.bottomRow}>
        {canRemind && (
          <Pressable onPress={remind} hitSlop={8} style={styles.remindBtn}>
            <Text style={styles.remindText}>{t.balanceCard.remind}</Text>
          </Pressable>
        )}
        <Pressable onPress={onSettle} hitSlop={8} style={styles.settleBtn}>
          <Text style={styles.settleText}>{t.balanceCard.settle}</Text>
        </Pressable>
      </View>
    </View>
  );
}

// 自分が関係する行: 相手の名前だけを1文にまとめて見せる。
function MineLine({
  row,
  nameOf,
  emojiOf,
  iOwe,
  t,
}: {
  row: BalanceRow;
  nameOf: (id: string) => string;
  emojiOf: (id: string) => string | null;
  iOwe: boolean;
  t: ReturnType<typeof useT>;
}) {
  const otherId = iOwe ? row.creditor : row.debtor;
  const otherName = nameOf(otherId);
  return (
    <View style={styles.line}>
      <Avatar name={otherName} emoji={emojiOf(otherId)} size="sm" />
      <Text style={styles.sentence} numberOfLines={1}>
        {iOwe ? t.balanceCard.sentencePay(otherName) : t.balanceCard.sentenceReceive(otherName)}
      </Text>
    </View>
  );
}

// 自分が関係しない行(グループ内の他の2人同士): 従来通りA→B表記。
function OtherPairLine({
  row,
  nameOf,
  emojiOf,
}: {
  row: BalanceRow;
  nameOf: (id: string) => string;
  emojiOf: (id: string) => string | null;
}) {
  return (
    <View style={styles.line}>
      <Avatar name={nameOf(row.debtor)} emoji={emojiOf(row.debtor)} size="sm" />
      <Text style={styles.name} numberOfLines={1}>
        {nameOf(row.debtor)}
      </Text>
      <Text style={styles.arrow}>→</Text>
      <Avatar name={nameOf(row.creditor)} emoji={emojiOf(row.creditor)} size="sm" />
      <Text style={styles.name} numberOfLines={1}>
        {nameOf(row.creditor)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { paddingVertical: 14, gap: 8 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  line: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0 },
  sentence: { ...fonts.bodyMedium, fontSize: 14.5, color: colors.ink, flexShrink: 1 },
  name: { ...fonts.bodyMedium, fontSize: 14.5, color: colors.ink, flexShrink: 1 },
  arrow: { color: colors.muted },
  amountCol: { alignItems: 'flex-end', flexShrink: 0 },
  amount: { ...fonts.display, fontSize: 19 },
  daysAgo: { ...fonts.body, fontSize: 11, color: colors.muted, marginTop: 2 },
  bottomRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 6 },
  remindBtn: {
    backgroundColor: colors.favorSoft,
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  remindText: { ...fonts.bodySemiBold, fontSize: 12, color: colors.favor },
  settleBtn: {
    backgroundColor: colors.surface2,
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  settleText: { ...fonts.bodySemiBold, fontSize: 12, color: colors.muted },
});
