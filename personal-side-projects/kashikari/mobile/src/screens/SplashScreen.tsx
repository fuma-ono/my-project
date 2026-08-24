import { StyleSheet, Text, View } from 'react-native';

import Mark from '../components/Mark';
import { colors, fonts } from '../theme';

// 起動直後に一瞬だけ見せるブランド画面。アイコンと「kashikari」だけを
// 中央に出し、読み込みが終わったらホーム(グループ一覧)へ切り替わる。
export default function SplashScreen() {
  return (
    <View style={styles.wrap}>
      <Mark size={72} />
      <Text style={styles.wordmark}>kashikari</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg, gap: 20 },
  wordmark: { ...fonts.display, fontSize: 44, color: colors.ink, letterSpacing: -0.5 },
});
