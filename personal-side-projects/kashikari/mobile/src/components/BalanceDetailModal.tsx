import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import Avatar from './Avatar';
import { useT } from '../i18n';
import { formatMoney } from '../lib/currency';
import { colors, fonts } from '../theme';
import type { BalanceRow } from '../types';

type Props = {
  visible: boolean;
  currency: string | null;
  rows: BalanceRow[]; // その通貨・moneyタイプの、自分が関係する行だけを渡す
  meId: string | null;
  nameOf: (id: string) => string;
  emojiOf: (id: string) => string | null;
  onClose: () => void;
};

// NetSummary(「あなたの残高」カード)の各通貨行にある「›」をタップすると
// 開く、その通貨の内訳を人ごとに見られるモーダル。カード自体には合計額
// (受け取る金額・支払う金額)しか出ていないため、「具体的に誰に対して
// いくらなのか」を知りたい場合の詳細画面として用意した。台帳・残高一覧
// の下のセクションと出どころは同じデータだが、複数通貨がある場合に
// その通貨だけへ絞り込んで見られる点が違う。
export default function BalanceDetailModal({ visible, currency, rows, meId, nameOf, emojiOf, onClose }: Props) {
  const t = useT();
  const receiving = rows.filter((r) => r.creditor === meId);
  const paying = rows.filter((r) => r.debtor === meId);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.card} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.title}>{t.netSummary.detailTitle(currency ?? '')}</Text>
          <ScrollView contentContainerStyle={styles.list}>
            <Text style={styles.sectionLabel}>{t.netSummary.receiving}</Text>
            {receiving.length === 0 ? (
              <Text style={styles.empty}>{t.netSummary.detailReceivingEmpty}</Text>
            ) : (
              receiving.map((row) => {
                const otherId = row.debtor;
                return (
                  <View key={`r-${otherId}`} style={styles.row}>
                    <Avatar name={nameOf(otherId)} emoji={emojiOf(otherId)} size="sm" />
                    <Text style={styles.name} numberOfLines={1}>
                      {nameOf(otherId)}
                    </Text>
                    <Text style={[styles.amount, { color: colors.positive }]}>{formatMoney(row.amount, row.currency)}</Text>
                  </View>
                );
              })
            )}

            <Text style={[styles.sectionLabel, styles.sectionLabelSpaced]}>{t.netSummary.paying}</Text>
            {paying.length === 0 ? (
              <Text style={styles.empty}>{t.netSummary.detailPayingEmpty}</Text>
            ) : (
              paying.map((row) => {
                const otherId = row.creditor;
                return (
                  <View key={`p-${otherId}`} style={styles.row}>
                    <Avatar name={nameOf(otherId)} emoji={emojiOf(otherId)} size="sm" />
                    <Text style={styles.name} numberOfLines={1}>
                      {nameOf(otherId)}
                    </Text>
                    <Text style={[styles.amount, { color: colors.negative }]}>{formatMoney(row.amount, row.currency)}</Text>
                  </View>
                );
              })
            )}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(20,15,10,0.45)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { width: '100%', maxWidth: 380, maxHeight: '75%', backgroundColor: colors.surface, borderRadius: 20, padding: 20 },
  title: { ...fonts.displayMedium, fontSize: 18, color: colors.ink, marginBottom: 14 },
  list: { gap: 10, paddingBottom: 4 },
  sectionLabel: { ...fonts.bodySemiBold, fontSize: 12.5, color: colors.muted },
  sectionLabelSpaced: { marginTop: 10 },
  empty: { ...fonts.body, fontSize: 13.5, color: colors.muted, paddingVertical: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  name: { ...fonts.bodyMedium, fontSize: 14.5, color: colors.ink, flex: 1, minWidth: 0 },
  amount: { ...fonts.display, fontSize: 15.5 },
});
