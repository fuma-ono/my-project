import { LinearGradient } from 'expo-linear-gradient';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native';

import { colors, fonts } from '../theme';

type Props = {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: 'primary' | 'ghost';
  style?: ViewStyle;
};

// primaryはブランドのグラデーション(コーラル→プラム)、ghostは装飾なしの
// テキストのみ。ボタンごとに色を変えず、この2種類だけに絞る。
export default function PrimaryButton({ title, onPress, disabled, loading, variant = 'primary', style }: Props) {
  const isGhost = variant === 'ghost';
  const content = loading ? (
    <ActivityIndicator color={isGhost ? colors.muted : colors.accentInk} />
  ) : (
    <Text style={[styles.text, isGhost ? styles.ghostText : styles.primaryText]}>{title}</Text>
  );

  return (
    <Pressable onPress={onPress} disabled={disabled || loading} style={style}>
      {({ pressed }) =>
        isGhost ? (
          <View style={[styles.base, styles.ghost, (disabled || loading) && styles.disabled, pressed && styles.pressed]}>{content}</View>
        ) : (
          <LinearGradient
            colors={[colors.accent, colors.plum]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[styles.base, (disabled || loading) && styles.disabled, pressed && styles.pressed]}
          >
            {content}
          </LinearGradient>
        )
      }
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
  ghost: { backgroundColor: 'transparent', paddingVertical: 10, paddingHorizontal: 12 },
  disabled: { opacity: 0.4 },
  pressed: { transform: [{ scale: 0.97 }] },
  text: { fontFamily: fonts.bodySemiBold, fontSize: 15 },
  primaryText: { color: colors.accentInk },
  ghostText: { color: colors.muted },
});
