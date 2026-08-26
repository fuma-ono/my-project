import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, StyleSheet, Text } from 'react-native';

import { colors, fonts } from '../theme';

export default function Fab({ onPress, disabled }: { onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={[styles.wrap, disabled && styles.disabled]}>
      <LinearGradient colors={[colors.accent, colors.plum]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.gradient}>
        <Text style={styles.text}>＋</Text>
      </LinearGradient>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    right: 20,
    // 画面下固定のBottomTabBar(高さ+セーフエリア分)の上に浮かせる。
    bottom: 96,
    width: 60,
    height: 60,
    borderRadius: 999,
    shadowColor: colors.plum,
    shadowOpacity: 0.4,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  gradient: { flex: 1, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.4 },
  text: { ...fonts.display, fontSize: 30, color: colors.accentInk },
});
