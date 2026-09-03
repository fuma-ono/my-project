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
// scripts/generate_icons.pyで生成する本番アプリアイコン(assets/icon.png)は
// 「手のマークをもっと大きく」という要望を受けてzoom=6まで拡大しており、
// 絵文字が正方形の外周ギリギリまで(トリミングされる形で)埋まっている。
// 一方このMarkはOSの絵文字フォントをそのまま描画していたため、絵文字本来の
// 内側の余白が残ったままで、本番アイコンより明らかに小さく見えてしまって
// いた("最初のページやログインページのアイコンが違う"という指摘)。
// generate_icons.pyと全く同じ「拡大してから中央をクロップ」を、こちらでも
// overflow:hiddenのコンテナ+実サイズより大きいfontSizeで再現している。
const GLYPH_ZOOM = 1.85;

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
      <Text style={[styles.glyph, { fontSize: size * 0.52 * GLYPH_ZOOM, lineHeight: size * 0.52 * GLYPH_ZOOM }]}>{glyph}</Text>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  glyph: { ...fonts.display, color: '#fff' },
});
