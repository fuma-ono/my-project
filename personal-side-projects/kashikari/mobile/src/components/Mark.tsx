import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, Text } from 'react-native';

import { colors, fonts } from '../theme';

// ブランドのロゴマーク。アプリアイコンと同じコーラル→プラムのグラデーションを
// 使い、スプラッシュ・オンボーディング・グループ一覧ヘッダーで使い回す。
//
// グリフは以前「⇄」(矢印の記号)を使っていたが、システムフォント任せの
// 記号はデバイスによって細すぎたり位置がずれたりして見栄えが悪かった
// ("アイコンが変" というフィードバック)。絵文字は各OSがネイティブに
// 描画するため太さ・見た目が安定しており、かつ「頼みごと」の絵文字
// (🤝)ともモチーフが揃うため、友達同士の貸し借り・信頼を表す🤝に変更。
//
// glyphを渡せば、同じグラデーションの入れ物のまま中身だけ差し替えられる。
// グループごとのアイコン(GROUP_ICON_EMOJI_OPTIONSから選択)を表示するのに使う。
export default function Mark({ size = 40, glyph = '🤝' }: { size?: number; glyph?: string }) {
  return (
    <LinearGradient
      colors={[colors.accent, colors.plum]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[styles.base, { width: size, height: size, borderRadius: size * 0.32 }]}
    >
      <Text style={[styles.glyph, { fontSize: size * 0.52 }]}>{glyph}</Text>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: 'center', justifyContent: 'center' },
  glyph: { ...fonts.display, color: '#fff' },
});
