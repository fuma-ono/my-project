import { Pressable, StyleSheet, Text, View } from 'react-native';

type Props = {
  onClose: () => void;
  onMockPurchase: () => void;
};

export default function PaywallScreen({ onClose, onMockPurchase }: Props) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Premiumにアップグレード</Text>
      <Text style={styles.item}>・広告なし</Text>
      <Text style={styles.item}>・全トラック解放(Lo-Fi / Binaural など)</Text>
      <Text style={styles.item}>・新規トラックを毎週追加</Text>

      <Pressable style={styles.buyButton} onPress={onMockPurchase}>
        <Text style={styles.buyButtonText}>¥480/月ではじめる</Text>
      </Pressable>
      <Text style={styles.note}>
        ※ これはモック画面です。実際の課金には App Store / Google Play の in-app purchase 連携が必要です。
      </Text>

      <Pressable onPress={onClose}>
        <Text style={styles.close}>閉じる</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0b0b16', paddingTop: 100, paddingHorizontal: 24 },
  title: { color: 'white', fontSize: 24, fontWeight: '700', marginBottom: 24 },
  item: { color: '#d8d8ea', fontSize: 15, marginBottom: 10 },
  buyButton: {
    backgroundColor: '#5b3df0',
    borderRadius: 12,
    paddingVertical: 16,
    marginTop: 24,
  },
  buyButtonText: { color: 'white', fontSize: 16, fontWeight: '700', textAlign: 'center' },
  note: { color: '#8a8aa0', fontSize: 11, marginTop: 12 },
  close: { color: '#9a9ab0', fontSize: 14, marginTop: 32, textAlign: 'center' },
});
