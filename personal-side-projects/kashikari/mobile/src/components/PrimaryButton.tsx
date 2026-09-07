import { LinearGradient } from 'expo-linear-gradient';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native';

import { colors, fonts } from '../theme';

type Props = {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: 'primary' | 'ghost' | 'secondary';
  // 横幅が限られた場所(2つ並べるカード等)で、左右のpaddingを詰めたい
  // 場合に使う。高さ(paddingVertical)・文字サイズは変えない。
  compact?: boolean;
  style?: ViewStyle;
};

// primaryはブランドのグラデーション(コーラル→プラム)、ghostは装飾なしの
// テキストのみ(モーダルのキャンセル等、軽い操作向け)。
// secondaryは「白背景＋枠線」— 「まとめて精算する」のような主役の
// アクションと並べて出す、もう一段軽いボタン(「共有する」等)向け。
// primaryと高さ・文字サイズを揃えている(styles.baseを共有)。
export default function PrimaryButton({ title, onPress, disabled, loading, variant = 'primary', compact, style }: Props) {
  const isGhost = variant === 'ghost';
  const isSecondary = variant === 'secondary';
  const textColor = isGhost || isSecondary ? colors.muted : colors.accentInk;
  const content = loading ? (
    <ActivityIndicator color={textColor} />
  ) : (
    <Text style={[styles.text, { color: textColor }]}>{title}</Text>
  );

  return (
    <Pressable onPress={onPress} disabled={disabled || loading} style={style}>
      {({ pressed }) => {
        if (isGhost) {
          return (
            <View style={[styles.base, styles.ghost, compact && styles.compact, (disabled || loading) && styles.disabled, pressed && styles.pressed]}>
              {content}
            </View>
          );
        }
        if (isSecondary) {
          return (
            <View style={[styles.base, styles.secondary, compact && styles.compact, (disabled || loading) && styles.disabled, pressed && styles.pressed]}>
              {content}
            </View>
          );
        }
        return (
          <LinearGradient
            colors={[colors.accent, colors.plum]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[styles.base, compact && styles.compact, (disabled || loading) && styles.disabled, pressed && styles.pressed]}
          >
            {content}
          </LinearGradient>
        );
      }}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: 999,
    paddingVertical: 12,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  compact: { paddingHorizontal: 12 },
  ghost: { backgroundColor: 'transparent', paddingVertical: 10, paddingHorizontal: 12 },
  secondary: { backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.line },
  disabled: { opacity: 0.4 },
  pressed: { transform: [{ scale: 0.97 }] },
  text: { ...fonts.bodySemiBold, fontSize: 15 },
});
