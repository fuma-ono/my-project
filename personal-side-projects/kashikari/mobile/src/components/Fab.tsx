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
  // 「＋を下に下げて小さく」という指摘を受け、bottomを96→84に下げ、
  // サイズを60→50に縮小した(BottomTabBarの上に浮かせる分は維持)。
  wrap: {
    position: 'absolute',
    right: 20,
    bottom: 84,
    width: 50,
    height: 50,
    borderRadius: 999,
    shadowColor: colors.plum,
    shadowOpacity: 0.4,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  gradient: { flex: 1, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.4 },
  text: { ...fonts.display, fontSize: 24, color: colors.accentInk },
});
