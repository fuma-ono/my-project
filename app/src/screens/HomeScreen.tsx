import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { TRACKS, Track } from '../data/tracks';

type Props = {
  isPremium: boolean;
  onSelectTrack: (track: Track) => void;
  onOpenPaywall: () => void;
};

export default function HomeScreen({ isPremium, onSelectTrack, onOpenPaywall }: Props) {
  return (
    <View style={styles.container}>
      <Text style={styles.header}>Focus & Sleep Sounds</Text>
      <Text style={styles.subheader}>AI生成のBGMでリラックス・集中</Text>

      {!isPremium && (
        <Pressable style={styles.upsell} onPress={onOpenPaywall}>
          <Text style={styles.upsellText}>広告なし・全トラック解放 → Premiumを見る</Text>
        </Pressable>
      )}

      <FlatList
        data={TRACKS}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => {
          const locked = item.premium && !isPremium;
          return (
            <Pressable
              style={[styles.card, { backgroundColor: item.color }]}
              onPress={() => (locked ? onOpenPaywall() : onSelectTrack(item))}
            >
              <View>
                <Text style={styles.cardTitle}>{item.title}</Text>
                <Text style={styles.cardCategory}>{item.category}</Text>
                <Text style={styles.cardDescription}>{item.description}</Text>
              </View>
              {locked && <Text style={styles.lock}>🔒</Text>}
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0b0b16', paddingTop: 64, paddingHorizontal: 20 },
  header: { color: 'white', fontSize: 28, fontWeight: '700' },
  subheader: { color: '#9a9ab0', fontSize: 14, marginTop: 4, marginBottom: 16 },
  upsell: {
    backgroundColor: '#5b3df0',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  upsellText: { color: 'white', fontWeight: '600', textAlign: 'center' },
  list: { paddingBottom: 40 },
  card: {
    borderRadius: 16,
    padding: 18,
    marginBottom: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardTitle: { color: 'white', fontSize: 18, fontWeight: '700' },
  cardCategory: { color: '#e0e0f0', fontSize: 12, marginTop: 2, textTransform: 'uppercase' },
  cardDescription: { color: '#d8d8ea', fontSize: 13, marginTop: 6, maxWidth: 260 },
  lock: { fontSize: 22 },
});
