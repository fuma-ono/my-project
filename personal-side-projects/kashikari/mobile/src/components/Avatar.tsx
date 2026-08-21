import { StyleSheet, Text, View } from 'react-native';

import { avatarColor, avatarInitial, fonts } from '../theme';

export default function Avatar({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' }) {
  const dim = size === 'sm' ? 24 : 34;
  return (
    <View
      style={[
        styles.base,
        { width: dim, height: dim, borderRadius: dim / 2, backgroundColor: avatarColor(name) },
      ]}
    >
      <Text style={[styles.text, { fontSize: size === 'sm' ? 11.5 : 14 }]}>{avatarInitial(name)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: 'center', justifyContent: 'center' },
  text: { color: '#fff', fontFamily: fonts.bodySemiBold },
});
