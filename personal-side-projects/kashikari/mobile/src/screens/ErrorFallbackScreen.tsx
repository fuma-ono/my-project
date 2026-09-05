import { StyleSheet, Text, View } from 'react-native';

import PrimaryButton from '../components/PrimaryButton';
import { colors, fonts } from '../theme';

// SentryErrorBoundaryが捕まえたJSエラーの表示先(99回目)。
// 「画面が真っ白になって二度とアプリを開いてもらえない」を防ぐための、
// 最低限の案内画面。i18nコンテキストに依存すると、その仕組み自体が
// クラッシュの原因だった場合にこの画面も道連れで壊れかねないため、
// あえて文言は日本語固定のプレーンな実装にしてある。
export default function ErrorFallbackScreen({ resetError }: { resetError?: () => void }) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.emoji}>😣</Text>
      <Text style={styles.title}>予期しないエラーが発生しました</Text>
      <Text style={styles.body}>
        ご迷惑をおかけしています。この問題は開発者に自動で報告されました。{'\n'}
        もう一度お試しください。
      </Text>
      {resetError && <PrimaryButton title="もう一度試す" onPress={resetError} style={styles.button} />}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emoji: { fontSize: 48, marginBottom: 16 },
  title: { ...fonts.display, fontSize: 20, color: colors.ink, textAlign: 'center', marginBottom: 12 },
  body: { ...fonts.body, fontSize: 14.5, color: colors.muted, textAlign: 'center', lineHeight: 22 },
  button: { marginTop: 24 },
});
