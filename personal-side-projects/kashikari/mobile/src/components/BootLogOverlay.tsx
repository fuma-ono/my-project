import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { getBootLog } from '../lib/bootLog';

// 起動時フリーズ(101回目)の調査用の一時オーバーレイ。目的は2つ:
// ①0.3秒ごとに増えるtick数字が止まらずに動き続けていれば、JSスレッド
//   (Hermes)自体は生きている証拠になる。数字が固まったまま増えなくなれば、
//   JS側が完全にブロックされていることの証拠になる。
// ②各所に仕込んだlogBoot()の記録を時系列で表示することで、フリーズ
//   直前に「どこまで」実行が進んだかが画面から直接読み取れる。
// SafeAreaProvider等どのProviderにも依存させたくないため、App()の
// 一番外側・SafeAreaProviderと並列(兄弟)の位置に置くこと。
// 原因が判明したら、この呼び出しごと削除すること。
export default function BootLogOverlay() {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 300);
    return () => clearInterval(id);
  }, []);

  const log = getBootLog();

  return (
    <View style={styles.container} pointerEvents="none">
      <Text style={styles.tick}>tick: {tick} (増え続けていればJS生存)</Text>
      {log.map((entry, i) => (
        <Text key={i} style={styles.line}>
          [{(entry.t / 1000).toFixed(2)}s] {entry.msg}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 50,
    left: 8,
    right: 8,
    zIndex: 9999,
    backgroundColor: 'rgba(0,0,0,0.8)',
    padding: 8,
    borderRadius: 6,
  },
  tick: {
    color: '#0f0',
    fontSize: 12,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  line: {
    color: '#0f0',
    fontSize: 10,
  },
});
