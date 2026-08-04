import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { CATEGORY_LABEL, Track } from '../data/tracks';
import MoonBadge from '../components/MoonBadge';

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

  const pulse = useRef(new Animated.Value(1)).current;

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

  useEffect(() => {
    if (!status.playing) {
      pulse.stopAnimation();
      Animated.timing(pulse, { toValue: 1, duration: 300, useNativeDriver: true }).start();
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.06, duration: 1800, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 1800, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [status.playing, pulse]);

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
    <LinearGradient colors={track.gradient} style={styles.container}>
      <Pressable onPress={onBack} style={styles.back} hitSlop={10}>
        <Ionicons name="chevron-back" size={18} color="white" />
        <Text style={styles.backText}>戻る</Text>
      </Pressable>

      <View style={styles.center}>
        <Animated.View style={[styles.artwork, { transform: [{ scale: pulse }] }]}>
          <View style={styles.artworkRing} />
          <MoonBadge size={72} color="#F0955C" />
        </Animated.View>

        <View style={styles.categoryPill}>
          <Text style={styles.categoryPillText}>{CATEGORY_LABEL[track.category]} · {track.duration}</Text>
        </View>
        <Text style={styles.title}>{track.title}</Text>
        <Text style={styles.englishTitle}>{track.englishTitle}</Text>
        <Text style={styles.description}>{track.description}</Text>

        <Pressable style={styles.playButton} onPress={togglePlay}>
          <Ionicons name={status.playing ? 'pause' : 'play'} size={26} color="#0B0E1A" style={!status.playing && styles.playIconOffset} />
        </Pressable>
        <Text style={styles.loopHint}>{status.playing ? 'ループ再生中' : '一時停止中'}</Text>

        <View style={styles.timerSection}>
          <View style={styles.timerLabelRow}>
            <Ionicons name="timer-outline" size={13} color="#C8CFE8" />
            <Text style={styles.timerLabel}>スリープタイマー</Text>
          </View>
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
            <Text style={styles.timerCountdown}>残り {formatRemaining(remainingSeconds)} で自動停止</Text>
          )}
        </View>
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: 64, paddingHorizontal: 20 },
  back: { flexDirection: 'row', alignItems: 'center', marginBottom: 24, alignSelf: 'flex-start' },
  backText: { color: 'white', fontSize: 15, marginLeft: 2 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  artwork: { alignItems: 'center', justifyContent: 'center', marginBottom: 22 },
  artworkRing: {
    position: 'absolute',
    width: 148,
    height: 148,
    borderRadius: 74,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  categoryPill: {
    backgroundColor: 'rgba(255,255,255,0.14)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    marginBottom: 10,
  },
  categoryPillText: { color: 'white', fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  title: { color: 'white', fontSize: 24, fontWeight: '700', textAlign: 'center' },
  englishTitle: { color: 'rgba(255,255,255,0.45)', fontSize: 12, textAlign: 'center', marginTop: 2 },
  description: {
    color: 'rgba(255,255,255,0.78)',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 12,
    marginBottom: 30,
    lineHeight: 19,
    maxWidth: 300,
  },
  playButton: {
    backgroundColor: '#F0955C',
    borderRadius: 999,
    width: 68,
    height: 68,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  playIconOffset: { marginLeft: 3 },
  loopHint: { color: 'rgba(255,255,255,0.55)', fontSize: 12, marginTop: 14 },
  timerSection: { marginTop: 34, alignItems: 'center' },
  timerLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 10 },
  timerLabel: { color: '#C8CFE8', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, fontWeight: '600' },
  timerRow: { flexDirection: 'row', gap: 10 },
  timerChip: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  timerChipActive: { backgroundColor: '#F0955C', borderColor: '#F0955C' },
  timerChipText: { color: 'rgba(255,255,255,0.85)', fontSize: 13, fontWeight: '600' },
  timerChipTextActive: { color: '#0B0E1A' },
  timerCountdown: { color: 'white', fontSize: 13, marginTop: 14 },
});
