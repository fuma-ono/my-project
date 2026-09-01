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

// アプリを開いている間(フォアグラウンド)に届いたプッシュ通知を、
// OSの通知バナーの代わりに自前で表示する。実機で確認したところ、
// expo-notificationsのsetNotificationHandler(shouldShowBanner: true)
// を設定していても、Expo Go実行中はフォアグラウンド時にOSの通知
// バナーが出ないことがあった(アプリを閉じている時は問題なく届く)。
// OS側の挙動に依存せず確実に気づけるよう、画面上部に自前でこの
// バナーを出す(src/hooks/usePushNotifications.tsのforegroundNotification
// 参照)。
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
