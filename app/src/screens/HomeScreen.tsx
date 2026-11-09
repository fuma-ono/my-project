import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { CATEGORY_ICON, CATEGORY_LABEL, TRACKS, Track } from '../data/tracks';
import MoonBadge from '../components/MoonBadge';

type Props = {
  isPremium: boolean;
  onSelectTrack: (track: Track) => void;
  onOpenPaywall: () => void;
};

export default function HomeScreen({ isPremium, onSelectTrack, onOpenPaywall }: Props) {
  return (
    <View style={styles.container}>
      <LinearGradient colors={['#141a30', '#0b0e1a']} style={styles.hero}>
        <View style={styles.heroTop}>
          <MoonBadge size={34} />
          <Text style={styles.eyebrow}>QUIET HOURS · AIサウンドスタジオ</Text>
        </View>
        <Text style={styles.header}>Focus & Sleep Sounds</Text>
        <Text style={styles.subheader}>眠りと集中のための、AI生成サウンド</Text>

        {!isPremium && (
          <Pressable onPress={onOpenPaywall}>
            <LinearGradient colors={['#F0955C', '#C67646']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.upsell}>
              <Ionicons name="sparkles" size={16} color="#241206" />
              <Text style={styles.upsellText}>広告なし・全トラック解放 → Premiumを見る</Text>
            </LinearGradient>
          </Pressable>
        )}
      </LinearGradient>

      <FlatList
        data={TRACKS}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => {
          const locked = item.premium && !isPremium;
          return (
            <Pressable onPress={() => (locked ? onOpenPaywall() : onSelectTrack(item))}>
              <LinearGradient
                colors={item.gradient}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.card}
              >
                <View style={styles.cardIconWrap}>
                  <Ionicons name={CATEGORY_ICON[item.category]} size={20} color="#F0955C" />
                </View>

                <View style={styles.cardBody}>
                  <View style={styles.cardTopRow}>
                    <View style={styles.categoryPill}>
                      <Text style={styles.categoryPillText}>{CATEGORY_LABEL[item.category]}</Text>
                    </View>
                    <Text style={styles.duration}>{item.duration}</Text>
                  </View>
                  <Text style={styles.cardTitle}>{item.title}</Text>
                  <Text style={styles.cardDescription} numberOfLines={2}>{item.description}</Text>
                </View>

                {locked ? (
                  <View style={styles.lockWrap}>
                    <Ionicons name="lock-closed" size={16} color="#F0D9C4" />
                  </View>
                ) : (
                  <View style={styles.playWrap}>
                    <Ionicons name="play" size={16} color="#0B0E1A" />
                  </View>
                )}
              </LinearGradient>
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0b0e1a' },
  hero: { paddingTop: 64, paddingHorizontal: 20, paddingBottom: 22 },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 },
  eyebrow: { color: '#9AA3C0', fontSize: 10, letterSpacing: 1.2, textTransform: 'uppercase', fontWeight: '700' },
  header: { color: 'white', fontSize: 28, fontWeight: '700' },
  subheader: { color: '#9AA3C0', fontSize: 14, marginTop: 4, marginBottom: 18 },
  upsell: {
    borderRadius: 14,
    paddingVertical: 13,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  upsellText: { color: '#241206', fontWeight: '700', fontSize: 13 },
  list: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 40 },
  card: {
    borderRadius: 18,
    padding: 16,
    marginBottom: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  cardIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardBody: { flex: 1 },
  cardTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  categoryPill: {
    backgroundColor: 'rgba(255,255,255,0.16)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
  },
  categoryPillText: { color: 'white', fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
  duration: { color: 'rgba(255,255,255,0.55)', fontSize: 11 },
  cardTitle: { color: 'white', fontSize: 20, fontWeight: '700', letterSpacing: 0.5 },
  cardDescription: { color: 'rgba(255,255,255,0.72)', fontSize: 12, marginTop: 4, lineHeight: 17 },
  lockWrap: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(0,0,0,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  playWrap: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#F0955C',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
