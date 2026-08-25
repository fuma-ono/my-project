import { StyleSheet, Text, View } from 'react-native';

import { useT } from '../i18n';
import { colors, fonts } from '../theme';

type Props = {
  doneCount: number;
  totalCount: number;
};

// 「進捗が見えると完了したくなる」という狙いのミニカード。メンバーのうち
// 何人が(このグループで)貸し借りゼロの状態になっているかを進捗バーで
// 見せる。全員精算済みの場合はNetSummary側の🎉メッセージと役割が
// 重複するため、GroupScreen側でbalances.length > 0のときだけ表示する。
export default function SettlementProgress({ doneCount, totalCount }: Props) {
  const t = useT();
  const pct = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 100;

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={styles.label}>{t.group.progressLabel}</Text>
        <Text style={styles.pct}>{pct}%</Text>
      </View>
      <View style={styles.barBg}>
        <View style={[styles.barFill, { width: `${pct}%` }]} />
      </View>
      <Text style={styles.count}>{t.group.progressCount(doneCount, totalCount)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 18,
  },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  label: { ...fonts.bodySemiBold, fontSize: 13, color: colors.ink },
  pct: { ...fonts.display, fontSize: 15, color: colors.accent },
  barBg: { height: 8, borderRadius: 999, backgroundColor: colors.surface2, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 999, backgroundColor: colors.accent },
  count: { ...fonts.body, fontSize: 12.5, color: colors.muted, marginTop: 8 },
});
