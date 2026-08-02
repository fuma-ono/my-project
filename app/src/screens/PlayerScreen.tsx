import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { Track } from '../data/tracks';

type Props = {
  track: Track;
  onBack: () => void;
};

const TIMER_OPTIONS_MIN = [15, 30, 45, 60];

function formatRemaining(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function PlayerScreen({ track, onBack }: Props) {
  const player = useAudioPlayer(track.source);
  const status = useAudioPlayerStatus(player);

  const [timerMinutes, setTimerMinutes] = useState<number | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    player.loop = true;
    player.play();
    return () => {
      player.pause();
    };
  }, [player]);

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  const togglePlay = () => {
    if (status.playing) {
      player.pause();
    } else {
      player.play();
    }
  };

  const clearTimer = () => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = null;
    setTimerMinutes(null);
    setRemainingSeconds(0);
  };

  const selectTimer = (minutes: number) => {
    if (timerMinutes === minutes) {
      clearTimer();
      return;
    }
    if (intervalRef.current) clearInterval(intervalRef.current);
    setTimerMinutes(minutes);
    setRemainingSeconds(minutes * 60);
    intervalRef.current = setInterval(() => {
      setRemainingSeconds((prev) => {
        if (prev <= 1) {
          if (intervalRef.current) clearInterval(intervalRef.current);
          intervalRef.current = null;
          player.pause();
          setTimerMinutes(null);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
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

        <Text style={styles.loopHint}>ループ再生中</Text>

        <View style={styles.timerSection}>
          <Text style={styles.timerLabel}>スリープタイマー</Text>
          <View style={styles.timerRow}>
            {TIMER_OPTIONS_MIN.map((minutes) => {
              const active = timerMinutes === minutes;
              return (
                <Pressable
                  key={minutes}
                  style={[styles.timerChip, active && styles.timerChipActive]}
                  onPress={() => selectTimer(minutes)}
                >
                  <Text style={[styles.timerChipText, active && styles.timerChipTextActive]}>
                    {minutes}分
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {timerMinutes !== null && (
            <Text style={styles.timerCountdown}>
              残り {formatRemaining(remainingSeconds)} で自動停止
            </Text>
          )}
        </View>
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
  timerSection: { marginTop: 36, alignItems: 'center' },
  timerLabel: { color: '#c8c8e0', fontSize: 12, marginBottom: 10, textTransform: 'uppercase', letterSpacing: 1 },
  timerRow: { flexDirection: 'row', gap: 10 },
  timerChip: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  timerChipActive: { backgroundColor: 'rgba(255,255,255,0.25)', borderColor: 'white' },
  timerChipText: { color: '#e8e8f5', fontSize: 13, fontWeight: '600' },
  timerChipTextActive: { color: 'white' },
  timerCountdown: { color: 'white', fontSize: 13, marginTop: 14 },
});
