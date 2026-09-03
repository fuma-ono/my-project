import { LinearGradient } from 'expo-linear-gradient';
import { Image, StyleSheet, Text } from 'react-native';

import { useSignedUrl } from '../hooks/useSignedUrl';
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
// 大きく見せている)と揃えようとして、こちらの絵文字も同じzoom=6相当で
// 拡大クロップする方式を試したが、「手だけでなくバッジ全体が大きくなった
// ように見える」という指摘を受けて撤回した経緯がある。原因は、
// generate_icons.pyのzoom値とこちらのfontSize倍率が同じ「6倍」でも、
// 実際に絵文字が画面上に占める割合(=見た目の拡大率)は絵文字フォントの
// 内部余白の違いにより全く別物になること(zoom値をそのまま流用するのは
// 誤りだった)。そこで、実際にassets/icon.pngの手のピクセル境界を計測し
// (背景グラデーションと異なる色の範囲を検出)、キャンバス幅に対する比率
// (約68%)を求めたうえで、このMarkコンポーネントの絵文字も同じ比率に
// なるようfontSizeの倍率を逆算した(詳細はREADME参照)。
const GLYPH_ZOOM = 1.22;

// glyphを渡せば、同じグラデーションの入れ物のまま中身だけ差し替えられる。
// グループごとのアイコン(GROUP_ICON_EMOJI_OPTIONSから選択)を表示するのに使う。
// photoPath(avatarsバケット内のパス、groups.icon_photo_path)を渡すと、
// 署名付きURLを取得してグラデーション+絵文字より優先して表示する
// (「グループのアイコンも写真を選べるように」への対応)。
export default function Mark({ size = 40, glyph = '🤝', photoPath }: { size?: number; glyph?: string; photoPath?: string | null }) {
  const photoUrl = useSignedUrl('avatars', photoPath ?? null);
  const boxStyle = [styles.base, { width: size, height: size, borderRadius: size * 0.32 }];
  if (photoUrl) {
    return <Image source={{ uri: photoUrl }} style={boxStyle} />;
  }
  return (
    <LinearGradient colors={[colors.accent, colors.plum]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={boxStyle}>
      <Text style={[styles.glyph, { fontSize: size * 0.52 * GLYPH_ZOOM, lineHeight: size * 0.52 * GLYPH_ZOOM }]}>{glyph}</Text>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  glyph: { ...fonts.display, color: '#fff' },
});
