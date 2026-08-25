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
  onSettleAll: () => void;
};

// 「自動精算」機能の見た目。個々の相手ごとの内訳(BalanceCard)とは別枠で、
// グループ全体を最小の支払い回数にまとめたプランをカードで見せる。
// このカードは、それが実際に減らせている場合(pairwiseの行数より
// simplifiedの行数が少ない場合)にだけGroupScreen側で表示される。
export default function AutoSettlePlan({ groupName, currency, transactions, nameOf, emojiOf, onSettleAll }: Props) {
  const t = useT();

  const share = () => {
    const text = buildSettlementShareText(groupName, transactions, nameOf, {
      heading: t.share.settlementHeading,
      closing: t.share.settlementClosing,
    });
    Share.share({ message: text });
  };

  return (
    <View style={styles.card}>
      <Text style={styles.title}>{t.group.autoSettleTitle}</Text>
      <Text style={styles.subtitle}>{t.group.autoSettleSubtitle(transactions.length)}</Text>

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

      <View style={styles.actions}>
        <PrimaryButton title={t.group.autoSettleShareButton} variant="ghost" onPress={share} style={styles.shareButton} />
        <PrimaryButton title={t.group.autoSettleButton} onPress={onSettleAll} style={styles.settleButton} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    padding: 18,
    marginBottom: 18,
    borderWidth: 1.5,
    borderColor: colors.accentSoft,
  },
  title: { ...fonts.bodySemiBold, fontSize: 15, color: colors.ink },
  subtitle: { ...fonts.body, fontSize: 12.5, color: colors.muted, marginTop: 2, marginBottom: 14 },
  rows: { gap: 10, marginBottom: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { ...fonts.bodyMedium, fontSize: 13.5, color: colors.ink, flexShrink: 1 },
  arrow: { color: colors.muted },
  amount: { ...fonts.bodySemiBold, fontSize: 13.5, color: colors.ink, marginLeft: 'auto' },
  actions: { flexDirection: 'row', gap: 8 },
  shareButton: {},
  settleButton: { flex: 1 },
});
