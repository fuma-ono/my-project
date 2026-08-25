import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useT } from '../i18n';
import { colors, fonts } from '../theme';

type Props = {
  remaining: number; // まだ完了(confirmed)していない内訳の件数
  paid: number; // そのうち「支払った」済み(受け取る側の確認待ち)の件数
  onPress?: () => void;
};

// 「進捗が見えると完了したくなる」という狙いのミニカード。以前はメンバーの
// 完了人数(◯/◯人完了)を見せていたが、「支払った→受け取った」の2段階
// 確認を導入したことで、より具体的に動ける「あと何件残っているか」を
// 見せる方が行動に繋がる、という指摘を受けて変更した。バーの割合は
// 「残っている件数のうち、既に支払い済みで受け取る側の確認待ちのものが
// どれだけあるか」を表す(0% = まだ誰も支払っていない、100% = 全件
// 支払い済みで確認待ちのみ)。
export default function SettlementProgress({ remaining, paid, onPress }: Props) {
  const t = useT();
  const pct = remaining > 0 ? Math.round((paid / remaining) * 100) : 100;

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
        <Text style={styles.count}>{t.group.progressRemaining(remaining)}</Text>
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
