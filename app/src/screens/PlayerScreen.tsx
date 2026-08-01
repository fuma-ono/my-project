import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { Track } from '../data/tracks';

type Props = {
  track: Track;
  onBack: () => void;
};

export default function PlayerScreen({ track, onBack }: Props) {
  const player = useAudioPlayer(track.source);
  const status = useAudioPlayerStatus(player);

  useEffect(() => {
    player.loop = true;
    player.play();
    return () => {
      player.pause();
    };
  }, [player]);

  const togglePlay = () => {
    if (status.playing) {
      player.pause();
    } else {
      player.play();
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: track.color }]}>
      <Pressable onPress={onBack} style={styles.back}>
        <Text style={styles.backText}>← 戻る</Text>
      </Pressable>

      <View style={styles.center}>
        <Text style={styles.title}>{track.title}</Text>
        <Text style={styles.description}>{track.description}</Text>

        <Pressable style={styles.playButton} onPress={togglePlay}>
          <Text style={styles.playButtonText}>{status.playing ? '⏸ 一時停止' : '▶ 再生'}</Text>
        </Pressable>

        <Text style={styles.loopHint}>ループ再生中(タイマー機能は今後追加予定)</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: 64, paddingHorizontal: 20 },
  back: { marginBottom: 40 },
  backText: { color: 'white', fontSize: 16 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  title: { color: 'white', fontSize: 26, fontWeight: '700', textAlign: 'center' },
  description: { color: '#e8e8f5', fontSize: 14, textAlign: 'center', marginTop: 8, marginBottom: 32 },
  playButton: {
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 999,
    paddingVertical: 16,
    paddingHorizontal: 32,
  },
  playButtonText: { color: 'white', fontSize: 18, fontWeight: '600' },
  loopHint: { color: '#c8c8e0', fontSize: 12, marginTop: 24 },
});
