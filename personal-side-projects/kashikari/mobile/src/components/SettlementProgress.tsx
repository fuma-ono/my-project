import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useT } from '../i18n';
import { colors, fonts } from '../theme';

type Props = {
  doneCount: number;
  totalCount: number;
  onPress?: () => void;
};

// 「進捗が見えると完了したくなる」という狙いのミニカード。メンバーのうち
// 何人が(このグループで)貸し借りゼロの状態になっているかを進捗バーで
// 見せる。全員精算済みの場合はNetSummary側の🎉メッセージと役割が
// 重複するため、GroupScreen側でbalances.length > 0のときだけ表示する。
//
// 4回目のUI改善指示で、タップすると「未払いユーザー一覧」を開けるように
// した(進捗を確認するだけでなく、そのまま催促のアクションに繋げる導線)。
export default function SettlementProgress({ doneCount, totalCount, onPress }: Props) {
  const t = useT();
  const pct = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 100;

  return (
    <Pressable style={styles.card} onPress={onPress} disabled={!onPress}>
      <View style={styles.headerRow}>
        <Text style={styles.label}>{t.group.progressLabel}</Text>
        <Text style={styles.pct}>{pct}%</Text>
      </View>
      <View style={styles.barBg}>
        <View style={[styles.barFill, { width: `${pct}%` }]} />
      </View>
      <View style={styles.footerRow}>
        <Text style={styles.count}>{t.group.progressCount(doneCount, totalCount)}</Text>
        {onPress && <Text style={styles.chevron}>›</Text>}
      </View>
    </Pressable>
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
  footerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 },
  count: { ...fonts.body, fontSize: 12.5, color: colors.muted },
  chevron: { ...fonts.bodySemiBold, fontSize: 16, color: colors.muted },
});
