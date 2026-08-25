import { Alert, Pressable, Share, StyleSheet, Text, View } from 'react-native';

import Avatar from './Avatar';
import { useT } from '../i18n';
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
//
// 「催促する」ボタンを追加した際、1行に名前ペア+金額+ボタン2つを
// 詰め込むと長い名前・長い通貨表記(例: "$20.00 USD")で名前が
// "は…"のように潰れてしまったため、上段(名前ペア+金額)と
// 下段(向きラベル+アクションボタン)の2段組みに分けている。
export default function BalanceCard({ row, nameOf, emojiOf, meId, onSettle }: Props) {
  const t = useT();
  const debtorLabel = row.mine && row.debtor === meId ? t.balanceCard.you : nameOf(row.debtor);
  const creditorLabel = row.mine && row.creditor === meId ? t.balanceCard.you : nameOf(row.creditor);
  const amountLabel = row.type === 'money' ? formatMoney(row.amount, row.currency) : t.common.favorCount(row.amount);

  const iOwe = row.mine && row.debtor === meId;
  const iAmOwed = row.mine && row.creditor === meId;
  const amountColor = iOwe ? colors.negative : iAmOwed ? colors.positive : colors.muted;
  const directionLabel = iOwe ? t.balanceCard.pay : iAmOwed ? t.balanceCard.receive : null;

  // 「催促する」は、自分が受け取る側(相手が自分にお金を払っていない)の
  // 場合だけ意味があるので、それ以外では出さない。頼みごとは金額が
  // 無いため文面が作れず対象外(お金のみ)。
  const canRemind = iAmOwed && row.type === 'money';
  const remind = () => {
    Alert.alert(t.remind.toneTitle, undefined, [
      { text: t.remind.toneGentle, onPress: () => shareReminder(t.remind.gentleMessage(amountLabel)) },
      { text: t.remind.toneNormal, onPress: () => shareReminder(t.remind.normalMessage(amountLabel)) },
      { text: t.remind.toneFunny, onPress: () => shareReminder(t.remind.funnyMessage(amountLabel)) },
      { text: t.remind.toneStrong, onPress: () => shareReminder(t.remind.strongMessage(amountLabel)) },
      { text: t.common.cancel, style: 'cancel' },
    ]);
  };

  return (
    <View style={styles.card}>
      <View style={styles.topRow}>
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
        <Text style={[styles.amount, { color: amountColor }]} numberOfLines={1}>
          {amountLabel}
        </Text>
      </View>

      <View style={styles.bottomRow}>
        {directionLabel ? <Text style={[styles.directionLabel, { color: amountColor }]}>{directionLabel}</Text> : <View />}
        <View style={styles.actions}>
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
    </View>
  );
}

function shareReminder(message: string) {
  Share.share({ message });
}

const styles = StyleSheet.create({
  card: { paddingVertical: 14, gap: 8 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  pair: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0 },
  name: { ...fonts.bodyMedium, fontSize: 14.5, color: colors.ink, flexShrink: 1 },
  me: { ...fonts.bodySemiBold },
  arrow: { color: colors.muted },
  amount: { ...fonts.display, fontSize: 19, flexShrink: 0 },
  bottomRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  directionLabel: { ...fonts.bodyMedium, fontSize: 12 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
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
