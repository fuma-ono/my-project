import { Component, type ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

// 起動時フリーズ調査用(101回目)。Sentryに一切頼らない、素のReact
// エラー境界。AppInnerのレンダー中に例外が起きているなら、それを
// 画面に直接表示する。SentryErrorBoundaryを無効化した状態でも
// フリーズが直らなかったことから、Sentry非依存の原因(未捕捉の例外)
// を疑うために追加した。
//
// 原因が判明したら、このファイルとApp.tsxでの利用箇所は削除すること。
type Props = { children: ReactNode };
type State = { error: Error | null };

export default class DebugErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    if (this.state.error) {
      const e = this.state.error;
      return (
        <ScrollView style={styles.container} contentContainerStyle={styles.content}>
          <Text style={styles.title}>DebugErrorBoundaryが例外を捕捉</Text>
          <Text style={styles.label}>name:</Text>
          <Text style={styles.text}>{e.name}</Text>
          <Text style={styles.label}>message:</Text>
          <Text style={styles.text}>{e.message}</Text>
          <Text style={styles.label}>stack:</Text>
          <Text style={styles.text}>{e.stack ?? '(スタックトレース無し)'}</Text>
        </ScrollView>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000080' },
  content: { padding: 16, paddingTop: 60 },
  title: { color: '#ffff00', fontSize: 18, fontWeight: 'bold', marginBottom: 16 },
  label: { color: '#00ffff', fontSize: 13, fontWeight: 'bold', marginTop: 12 },
  text: { color: '#ffffff', fontSize: 12 },
});
