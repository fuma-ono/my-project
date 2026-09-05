import { useEffect, useState } from 'react';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { useLanguage } from '../i18n';
import { extractGroupIdFromNotification, registerForPushNotifications } from '../lib/pushNotifications';

// サインイン中(userIdがある)ことを条件に、この端末のプッシュ通知
// トークンを登録する。言語設定(lang)が変わったら通知文言もそちらに
// 合わせたいので、langが変わるたびにも登録し直す(upsert_push_tokenは
// 何度呼んでも安全)。
//
// あわせて、通知をタップして開いた(コールドスタート)/タップして
// フォアグラウンドに戻ってきた場合のgroup_idをpendingGroupIdとして返す。
// 実際にその画面を開く処理はApp.tsx側(groupsの読み込みを待つ必要が
// あるため)。
//
// フォアグラウンド中に届いた通知をその場でバナー表示する機能は、
// 69回目でこのフックから削除した(useNotifications.tsのlatestInsert
// 参照)。以前はここでaddNotificationReceivedListener(OSのプッシュ
// 通知に反応する仕組み)を使っていたが、実機で確認したところExpo Go
// 実行中はアプリがフォアグラウンドの時には信頼して発火しなかった
// ため。
export function usePushNotifications(userId: string | null) {
  const { lang } = useLanguage();
  const [pendingGroupId, setPendingGroupId] = useState<string | null>(null);

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

  return {
    pendingGroupId,
    clearPendingGroupId: () => setPendingGroupId(null),
  };
}
