import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, Text } from 'react-native';

import { colors, fonts } from '../theme';

// ブランドのロゴマーク。アプリアイコンと同じコーラル→プラムのグラデーションを
// 使い、スプラッシュ・オンボーディング・グループ一覧ヘッダーで使い回す。
export default function Mark({ size = 40 }: { size?: number }) {
  return (
    <LinearGradient
      colors={[colors.accent, colors.plum]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[styles.base, { width: size, height: size, borderRadius: size * 0.32 }]}
    >
      <Text style={[styles.glyph, { fontSize: size * 0.46 }]}>⇄</Text>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: 'center', justifyContent: 'center' },
  glyph: { ...fonts.display, color: '#fff' },
});
