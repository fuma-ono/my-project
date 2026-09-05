import { StyleSheet, Text, View } from 'react-native';

import Mark from '../components/Mark';
import { useT } from '../i18n';
import { colors, fonts } from '../theme';

// EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY が未設定のまま
// 起動された場合に表示する画面。以前はここでSupabaseクライアントの
// 初期化自体が例外を投げ、本番ビルドでは真っ白な画面のままクラッシュして
// 原因が分からなくなっていた(2026-09-03、TestFlightで発生)。
// src/lib/supabase.ts の isSupabaseConfigured を見てApp.tsx側から出す。
export default function ConfigErrorScreen() {
  const t = useT();
  return (
    <View style={styles.wrap}>
      <Mark size={72} />
      <Text style={styles.title}>{t.configError.title}</Text>
      <Text style={styles.message}>{t.configError.message}</Text>
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
});
