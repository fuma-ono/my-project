import { ActivityIndicator, Pressable, StyleSheet, Text, ViewStyle } from 'react-native';

import { colors, fonts } from '../theme';

type Props = {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: 'primary' | 'ghost';
  style?: ViewStyle;
};

export default function PrimaryButton({ title, onPress, disabled, loading, variant = 'primary', style }: Props) {
  const isGhost = variant === 'ghost';
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.base,
        isGhost ? styles.ghost : styles.primary,
        (disabled || loading) && styles.disabled,
        pressed && !disabled && !loading && styles.pressed,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={isGhost ? colors.muted : colors.accentInk} />
      ) : (
        <Text style={[styles.text, isGhost ? styles.ghostText : styles.primaryText]}>{title}</Text>
      )}
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
  primary: { backgroundColor: colors.accent },
  ghost: { backgroundColor: 'transparent', paddingVertical: 10, paddingHorizontal: 12 },
  disabled: { opacity: 0.4 },
  pressed: { transform: [{ scale: 0.97 }] },
  text: { fontFamily: fonts.bodySemiBold, fontSize: 15 },
  primaryText: { color: colors.accentInk },
  ghostText: { color: colors.muted },
});
