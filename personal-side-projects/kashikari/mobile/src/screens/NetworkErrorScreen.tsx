import { StyleSheet, Text, View } from 'react-native';

import PrimaryButton from '../components/PrimaryButton';
import Mark from '../components/Mark';
import { useT } from '../i18n';
import { colors, fonts } from '../theme';

// サインイン確認(getSession)がバックエンドの不調で固まった場合に表示する
// 画面。以前はApp.tsx側がauthLoadingの間ずっとSplashScreenを表示し続ける
// 作りだったため、バックエンドが応答しないとスプラッシュ画面から永久に
// 遷移できず、ログインもできない状態になっていた(2026-11、オーナー報告)。
// App.tsx側で一定時間authLoadingが続いたらこの画面に切り替え、
// 「再試行」でuseAuthのretry()を呼び直せるようにしている。
export default function NetworkErrorScreen({ onRetry }: { onRetry: () => void }) {
  const t = useT();
  return (
    <View style={styles.wrap}>
      <Mark size={72} />
      <Text style={styles.title}>{t.networkError.title}</Text>
      <Text style={styles.message}>{t.networkError.message}</Text>
      <PrimaryButton title={t.networkError.retryButton} onPress={onRetry} style={styles.button} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
    paddingHorizontal: 32,
    gap: 16,
  },
  title: { ...fonts.display, fontSize: 22, color: colors.ink },
  message: { ...fonts.bodyMedium, fontSize: 15, color: colors.muted, textAlign: 'center', lineHeight: 22 },
  button: { marginTop: 8 },
});
