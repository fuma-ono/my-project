import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import Avatar from './Avatar';
import { useT } from '../i18n';
import { daysSince } from '../lib/balances';
import { formatMoney } from '../lib/currency';
import { openRemindPrompt } from '../lib/remind';
import { colors, fonts } from '../theme';
import type { BalanceRow } from '../types';

type Props = {
  visible: boolean;
  rows: BalanceRow[]; // 「受け取る」セクションと同じ行(=自分が受け取る側)だけを渡す
  nameOf: (id: string) => string;
  emojiOf: (id: string) => string | null;
  onConfirmReceived: (row: BalanceRow) => void;
  onClose: () => void;
};

// 精算進捗カードをタップすると開く、「回収」に特化したモーダル。内訳画面の
// 「受け取る」セクションと同じデータを使うが、行ごとに未払い日数を添えて
// 一覧にすることで、「誰にまだ催促していないか」をひと目で把握できるように
// している(催促→支払い→完了、という導線のハブ)。行がstatus==='paid'
// (相手が既に「支払った」を押した)になっていれば、催促するの代わりに
// その場で「受け取った」を押して完了させられる。
export default function UnpaidMembersModal({ visible, rows, nameOf, emojiOf, onConfirmReceived, onClose }: Props) {
  const t = useT();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.card} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.title}>{t.group.unpaidTitle}</Text>
          {rows.length === 0 ? (
            <Text style={styles.empty}>{t.group.unpaidEmpty}</Text>
          ) : (
            <ScrollView contentContainerStyle={styles.list}>
              {rows.map((row) => {
                const otherId = row.debtor;
                const otherName = nameOf(otherId);
                const amountLabel = row.type === 'money' ? formatMoney(row.amount, row.currency) : t.balanceCard.noAmountLabel;
                const isMoney = row.type === 'money';
                const awaitingConfirm = isMoney && row.status === 'paid';
                return (
                  <View key={`${row.debtor}-${row.creditor}-${row.type}-${row.currency}`} style={styles.row}>
                    <Avatar name={otherName} emoji={emojiOf(otherId)} size="sm" />
                    <View style={styles.rowMain}>
                      <Text style={styles.name} numberOfLines={1}>
                        {otherName}
                      </Text>
                      <Text style={styles.days}>
                        {awaitingConfirm ? t.balanceCard.awaitingConfirm : t.balanceCard.daysAgo(daysSince(row.oldestUnsettledAt))}
                      </Text>
                    </View>
                    <View style={styles.rowRight}>
                      <Text style={[styles.amount, { color: isMoney ? colors.positive : colors.muted }]} numberOfLines={1}>
                        {amountLabel}
                      </Text>
                      {isMoney && awaitingConfirm && (
                        <Pressable onPress={() => onConfirmReceived(row)} hitSlop={8} style={styles.confirmBtn}>
                          <Text style={styles.confirmText}>{t.balanceCard.confirmReceived}</Text>
                        </Pressable>
                      )}
                      {isMoney && !awaitingConfirm && (
                        <Pressable onPress={() => openRemindPrompt(t, amountLabel)} hitSlop={8} style={styles.remindBtn}>
                          <Text style={styles.remindText}>{t.balanceCard.remind}</Text>
                        </Pressable>
                      )}
                    </View>
                  </View>
                );
              })}
            </ScrollView>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(20,15,10,0.45)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { width: '100%', maxWidth: 380, maxHeight: '75%', backgroundColor: colors.surface, borderRadius: 20, padding: 20 },
  title: { ...fonts.displayMedium, fontSize: 18, color: colors.ink, marginBottom: 14 },
  empty: { ...fonts.body, fontSize: 14, color: colors.muted, paddingVertical: 12 },
  list: { gap: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  rowMain: { flex: 1, minWidth: 0 },
  name: { ...fonts.bodySemiBold, fontSize: 14.5, color: colors.ink },
  days: { ...fonts.body, fontSize: 12, color: colors.muted, marginTop: 1 },
  rowRight: { alignItems: 'flex-end', gap: 6 },
  amount: { ...fonts.display, fontSize: 16 },
  remindBtn: {
    backgroundColor: colors.favorSoft,
    borderRadius: 999,
    paddingVertical: 5,
    paddingHorizontal: 10,
  },
  remindText: { ...fonts.bodySemiBold, fontSize: 11.5, color: colors.favor },
  confirmBtn: {
    backgroundColor: colors.positiveSoft,
    borderRadius: 999,
    paddingVertical: 5,
    paddingHorizontal: 10,
  },
  confirmText: { ...fonts.bodySemiBold, fontSize: 11.5, color: colors.positive },
});
