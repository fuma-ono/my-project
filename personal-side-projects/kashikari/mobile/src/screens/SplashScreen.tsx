import { StyleSheet, Text, View } from 'react-native';

import Mark from '../components/Mark';
import { useT } from '../i18n';
import { colors, fonts } from '../theme';

// 起動直後に一瞬だけ見せるブランド画面。参考UI画像に合わせて、背景に
// 淡いグラデーションのぼかし玉(装飾)、キャッチコピー、ページ
// インジケータ(ドット)を追加した。ドットは実際にスワイプできる
// カルーセルではなく静的な装飾(複数ページのオンボーディングは、今回の
// UI刷新とは別の規模の大きい変更として見送っている)。
export default function SplashScreen() {
  const t = useT();
  return (
    <View style={styles.wrap}>
      <View style={[styles.blob, styles.blobTopLeft]} />
      <View style={[styles.blob, styles.blobTopRight]} />
      <View style={[styles.blob, styles.blobBottom]} />

      <View style={styles.content}>
        <Mark size={112} />
        <Text style={styles.wordmark}>kashikari</Text>
        <Text style={styles.tagline}>{t.splash.tagline}</Text>
      </View>

      <View style={styles.dots}>
        <View style={[styles.dot, styles.dotActive]} />
        <View style={styles.dot} />
        <View style={styles.dot} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg, overflow: 'hidden' },
  blob: { position: 'absolute', borderRadius: 999 },
  blobTopLeft: { width: 260, height: 260, top: -60, left: -80, backgroundColor: colors.accentSoft, opacity: 0.7 },
  blobTopRight: { width: 220, height: 220, top: -40, right: -70, backgroundColor: colors.favorSoft, opacity: 0.6 },
  blobBottom: { width: 300, height: 300, bottom: -100, left: -60, backgroundColor: colors.accentSoft, opacity: 0.5 },
  content: { alignItems: 'center', gap: 20 },
  wordmark: { ...fonts.display, fontSize: 44, color: colors.ink, letterSpacing: -0.5 },
  tagline: { ...fonts.bodyMedium, fontSize: 15, color: colors.muted, textAlign: 'center', lineHeight: 22 },
  dots: { position: 'absolute', bottom: 64, flexDirection: 'row', gap: 8 },
  dot: { width: 7, height: 7, borderRadius: 999, backgroundColor: colors.line },
  dotActive: { backgroundColor: colors.accent, width: 20 },
});
