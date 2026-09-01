import { useEffect, useState } from 'react';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { useLanguage } from '../i18n';
import { extractGroupIdFromNotification, registerForPushNotifications } from '../lib/pushNotifications';

export type ForegroundNotification = { title: string; body: string; groupId: string | null };

// サインイン中(userIdがある)ことを条件に、この端末のプッシュ通知
// トークンを登録する。言語設定(lang)が変わったら通知文言もそちらに
// 合わせたいので、langが変わるたびにも登録し直す(upsert_push_tokenは
// 何度呼んでも安全)。
//
// あわせて、通知をタップして開いた(コールドスタート)/タップして
// フォアグラウンドに戻ってきた場合のgroup_idをpendingGroupIdとして返す。
// 実際にその画面を開く処理はApp.tsx側(groupsの読み込みを待つ必要が
// あるため)。
export function usePushNotifications(userId: string | null) {
  const { lang } = useLanguage();
  const [pendingGroupId, setPendingGroupId] = useState<string | null>(null);
  const [foregroundNotification, setForegroundNotification] = useState<ForegroundNotification | null>(null);

  useEffect(() => {
    if (!userId) return;
    registerForPushNotifications(lang);
  }, [userId, lang]);

  useEffect(() => {
    // Web版(デモモード含む)はプッシュ通知自体に非対応
    // (expo-notificationsのgetLastNotificationResponseAsync等がWebでは
    // 例外を投げる)なので、ここで打ち切る。
    if (Platform.OS === 'web') return;
    // 通知をタップしてアプリが(何も無い状態から)起動した場合。
    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (!response) return;
      const groupId = extractGroupIdFromNotification(response);
      if (groupId) setPendingGroupId(groupId);
    });
    // バックグラウンド/フォアグラウンド中に通知をタップした場合。
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const groupId = extractGroupIdFromNotification(response);
      if (groupId) setPendingGroupId(groupId);
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    // アプリを開いている間(フォアグラウンド)に通知を受け取った場合。
    // 実機で確認したところ、setNotificationHandler(shouldShowBanner:
    // true)を設定していても、Expo Go実行中はOSの通知バナー自体が
    // フォアグラウンド時に表示されないことがある(アプリを閉じている
    // 時は問題なく届く)。OS側の挙動に頼らず、自前でバナー
    // (NotificationBanner、App.tsx参照)を出すことで確実に気づける
    // ようにする。
    const sub = Notifications.addNotificationReceivedListener((notification) => {
      const { title, body, data } = notification.request.content;
      const groupId = typeof data?.group_id === 'string' ? data.group_id : null;
      setForegroundNotification({ title: title ?? '', body: body ?? '', groupId });
    });
    return () => sub.remove();
  }, []);

  return {
    pendingGroupId,
    clearPendingGroupId: () => setPendingGroupId(null),
    foregroundNotification,
    clearForegroundNotification: () => setForegroundNotification(null),
  };
}
