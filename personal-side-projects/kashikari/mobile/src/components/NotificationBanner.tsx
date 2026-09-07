import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fonts } from '../theme';

type Props = {
  title: string;
  body: string;
  visible: boolean;
  onPress: () => void;
  onHide: () => void;
  duration?: number;
};

// アプリを開いている間(フォアグラウンド)に届いた通知を、OSの通知
// バナーの代わりに自前で表示する。実機で確認したところ、
// expo-notificationsのsetNotificationHandler(shouldShowBanner: true)や
// addNotificationReceivedListenerを設定していても、Expo Go実行中は
// フォアグラウンド時にOSの通知バナー・リスナーが信頼して発火しない
// ことがあった(アプリを閉じている時は問題なく届く)。プッシュ通知の
// 受信経路そのものに頼らず、send-pushが書き込むnotification_logへの
// Realtime購読(DBの変化を直接見る)を情報源にすることで確実に気づける
// ようにする(src/hooks/useNotifications.tsのlatestInsert参照)。
export default function NotificationBanner({ title, body, visible, onPress, onHide, duration = 4500 }: Props) {
  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(onHide, duration);
    return () => clearTimeout(timer);
  }, [visible, duration, onHide]);

  if (!visible) return null;

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <Pressable
        style={styles.card}
        onPress={() => {
          onHide();
          onPress();
        }}
      >
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.body} numberOfLines={2}>
          {body}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, top: 56, alignItems: 'center', paddingHorizontal: 16 },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: colors.surface,
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 16,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  title: { ...fonts.bodySemiBold, fontSize: 13, color: colors.accent },
  body: { ...fonts.bodyMedium, fontSize: 14.5, color: colors.ink, marginTop: 2 },
});
