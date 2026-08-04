import Svg, { Circle, Path } from 'react-native-svg';

/**
 * Quiet Hours ブランドの三日月+星モチーフ(bgm_pipeline/branding.py・会社サイトと共通の
 * ビジュアル言語)。アプリ全体で繰り返し使う唯一の装飾モチーフとして、この1つに統一する。
 */
type Props = {
  size?: number;
  color?: string;
  starColor?: string;
};

export default function MoonBadge({ size = 48, color = '#F0955C', starColor = '#FFFFFF' }: Props) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Circle cx="78" cy="20" r="2.4" fill={starColor} opacity={0.85} />
      <Circle cx="85" cy="34" r="1.6" fill={starColor} opacity={0.65} />
      <Circle cx="68" cy="12" r="1.4" fill={starColor} opacity={0.55} />
      <Path
        d="M62 12 C40 12 22 30 22 52 C22 74 40 92 62 92 C71 92 79 89 86 84 C72 90 56 86 46 74 C36 62 36 42 46 30 C54 20 66 16 78 17 C74 14 68 12 62 12 Z"
        fill={color}
      />
    </Svg>
  );
}
