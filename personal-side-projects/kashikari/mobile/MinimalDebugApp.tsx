import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

// 起動時フリーズ調査用(101回目)の一時的な最小構成アプリ。App.tsx配下の
// 大量のimport(画面・フック・lib群)を一切経由せず、react/react-native
// 本体だけで画面を出せるかを確認するための切り分け専用コンポーネント。
// これが実機で表示されれば「JS/React自体はこの端末・このビルドで動作
// する、原因はApp.tsxのimportグラフのどこか」と確定できる。表示され
// なければ、ビルド設定やネイティブ側などもっと手前を疑う必要がある。
//
// 原因が判明したらこのファイルとindex.tsでの切り替えは削除すること。
export default function MinimalDebugApp() {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 300);
    return () => clearInterval(id);
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.text}>MINIMAL DEBUG APP</Text>
      <Text style={styles.text}>tick: {tick}</Text>
      <Text style={styles.text}>これが見えていればJS/Reactは動いている</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ff0000',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  text: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: 'bold',
    textAlign: 'center',
    marginVertical: 8,
  },
});
