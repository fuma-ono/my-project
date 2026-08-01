import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useAudioPlayer, useAudioPlayerStatus, setAudioModeAsync } from 'expo-audio';
import { Track } from '../data/tracks';

type Props = {
  track: Track;
  onBack: () => void;
};

const TIMER_OPTIONS_MIN = [15, 30, 45, 60];

function formatRemaining(seconds: number) {
  const m = Math.floor(seconds / 60)
    .toString()
    .padStart(2, '0');
  const s = Math.floor(seconds % 60)
    .toString()
    .padStart(2, '0');
  return `${m}:${s}`;
}

export default function PlayerScreen({ track, onBack }: Props) {
  const player = useAudioPlayer(track.source);
  const status = useAudioPlayerStatus(player);

  const [timerMinutes, setTimerMinutes] = useState<number | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: 'doNotMix',
    });

    player.loop = true;
    player.play();
    player.setActiveForLockScreen(true, {
      title: track.title,
      artist: 'Focus & Sleep Sounds',
    });

    return () => {
      player.clearLockScreenControls();
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

  const selectTimer = (minutes: number | null) => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (minutes === null) {
      setTimerMinutes(null);
      setRemainingSeconds(null);
      return;
    }
    setTimerMinutes(minutes);
    setRemainingSeconds(minutes * 60);
    intervalRef.current = setInterval(() => {
      setRemainingSeconds((prev) => {
        if (prev === null || prev <= 1) {
          if (intervalRef.current) clearInterval(intervalRef.current);
          intervalRef.current = null;
          player.pause();
          setTimerMinutes(null);
          return null;
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

        <Text style={styles.loopHint}>
          ループ再生中・画面ロック中も再生継続
          {remainingSeconds !== null ? ` ・あと${formatRemaining(remainingSeconds)}で自動停止` : ''}
        </Text>

        <View style={styles.timerRow}>
          <Text style={styles.timerLabel}>スリープタイマー</Text>
          <View style={styles.timerButtons}>
            {TIMER_OPTIONS_MIN.map((min) => (
              <Pressable
                key={min}
                style={[styles.timerButton, timerMinutes === min && styles.timerButtonActive]}
                onPress={() => selectTimer(min)}
              >
                <Text
                  style={[
                    styles.timerButtonText,
                    timerMinutes === min && styles.timerButtonTextActive,
                  ]}
                >
                  {min}分
                </Text>
              </Pressable>
            ))}
            <Pressable
              style={[styles.timerButton, timerMinutes === null && styles.timerButtonActive]}
              onPress={() => selectTimer(null)}
            >
              <Text
                style={[
                  styles.timerButtonText,
                  timerMinutes === null && styles.timerButtonTextActive,
                ]}
              >
                オフ
              </Text>
            </Pressable>
          </View>
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
  loopHint: { color: '#c8c8e0', fontSize: 12, marginTop: 24, textAlign: 'center' },
  timerRow: { marginTop: 36, alignItems: 'center' },
  timerLabel: { color: '#c8c8e0', fontSize: 12, marginBottom: 10 },
  timerButtons: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8 },
  timerButton: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  timerButtonActive: { backgroundColor: 'rgba(255,255,255,0.9)' },
  timerButtonText: { color: '#e8e8f5', fontSize: 13, fontWeight: '600' },
  timerButtonTextActive: { color: '#141413' },
});
