import { Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import MoonBadge from '../components/MoonBadge';

type Props = {
  onClose: () => void;
  onMockPurchase: () => void;
};

const FEATURES: { icon: keyof typeof Ionicons.glyphMap; text: string }[] = [
  { icon: 'ban', text: '広告なしで聴き放題' },
  { icon: 'lock-open', text: '全トラック解放(Lo-Fi・バイノーラルも含めて)' },
  { icon: 'calendar', text: '新しいトラックを毎週追加' },
];

export default function PaywallScreen({ onClose, onMockPurchase }: Props) {
  return (
    <LinearGradient colors={['#1E2648', '#0B0E1A']} style={styles.container}>
      <Pressable onPress={onClose} style={styles.closeIcon} hitSlop={10}>
        <Ionicons name="close" size={22} color="rgba(255,255,255,0.6)" />
      </Pressable>

      <View style={styles.badgeWrap}>
        <MoonBadge size={56} />
      </View>

      <Text style={styles.eyebrow}>QUIET HOURS PREMIUM</Text>
      <Text style={styles.title}>集中と睡眠を、もっと自由に</Text>

      <View style={styles.card}>
        {FEATURES.map((f) => (
          <View key={f.text} style={styles.featureRow}>
            <View style={styles.featureIconWrap}>
              <Ionicons name={f.icon} size={16} color="#F0955C" />
            </View>
            <Text style={styles.featureText}>{f.text}</Text>
          </View>
        ))}
      </View>

      <Pressable onPress={onMockPurchase}>
        <LinearGradient colors={['#F0955C', '#C67646']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.buyButton}>
          <Text style={styles.buyButtonText}>¥480 / 月ではじめる</Text>
        </LinearGradient>
      </Pressable>

      <View style={styles.noteRow}>
        <Ionicons name="information-circle-outline" size={13} color="#8A8AA0" />
        <Text style={styles.note}>
          これはモック画面です。実際の課金には App Store / Google Play の in-app purchase 連携が必要です。
        </Text>
      </View>

      <Pressable onPress={onClose}>
        <Text style={styles.close}>あとで</Text>
      </Pressable>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: 90, paddingHorizontal: 24 },
  closeIcon: { position: 'absolute', top: 56, right: 20, zIndex: 1 },
  badgeWrap: { alignItems: 'center', marginBottom: 18 },
  eyebrow: { color: '#F0955C', fontSize: 11, letterSpacing: 2, textAlign: 'center', fontWeight: '700', marginBottom: 8 },
  title: { color: 'white', fontSize: 22, fontWeight: '700', textAlign: 'center', marginBottom: 28 },
  card: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 16,
    padding: 18,
    gap: 14,
    marginBottom: 26,
  },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  featureIconWrap: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(240,149,92,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureText: { color: '#EEF0F6', fontSize: 14, flex: 1 },
  buyButton: { borderRadius: 14, paddingVertical: 16 },
  buyButtonText: { color: '#241206', fontSize: 16, fontWeight: '700', textAlign: 'center' },
  noteRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: 14 },
  note: { color: '#8A8AA0', fontSize: 11, flex: 1, lineHeight: 16 },
  close: { color: '#9AA3C0', fontSize: 14, marginTop: 32, textAlign: 'center' },
});
