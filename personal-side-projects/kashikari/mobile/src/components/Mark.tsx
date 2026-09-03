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
// 一時、ホーム画面アイコン(assets/icon.png、zoom=6でトリミングして手を
// 大きく見せている)と揃えようとして、こちらの絵文字も拡大クロップする
// 方式(GLYPH_ZOOM)を試したが、「手だけでなくバッジ全体が大きくなった
// ように見える」という指摘を受けて元に戻した。ホーム画面アイコンは
// ビットマップを直接トリミングするのに対し、こちらはOSの絵文字フォントを
// そのまま描画する方式のため、同じ「zoom」の考え方をそのまま持ち込むと
// 見え方の変化の仕方が異なる(このバッジ自体の存在感が増して見える)。
// 両者を完全に一致させる調整は改めて依頼があれば対応する。

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
