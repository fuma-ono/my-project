// プッシュ通知(Expo Push)。「誰かが記録してもアプリを開くまで気づけない」
// への対応。仕組み:
//   1. サインイン中、この端末のExpoプッシュトークンを取得してSupabase
//      (push_tokensテーブル、upsert_push_token RPC経由)に登録しておく
//      (registerForPushNotifications。src/hooks/usePushNotifications.ts
//      が言語設定変更のたびにも呼び直す)
//   2. entry作成・支払い報告・受取確認のタイミングで、Edge Function
//      (supabase/functions/send-push)を呼び、該当メンバーの端末に通知を
//      送ってもらう(notifyGroup。失敗しても操作自体は成功させたいため、
//      結果を待たず・エラーも表に出さないベストエフォート)
//   3. サインアウト時、この端末のトークンだけ登録解除する
//      (unregisterPushNotifications)
//   4. 通知をタップして開いた/再開したときは、data.group_idを見て
//      該当グループを直接開く(extractGroupIdFromNotification。
//      src/hooks/usePushNotifications.ts・App.tsx参照)
//
// 既知の制限: SDK53以降、Expo GoはAndroidでのリモートプッシュ通知(この
// 仕組み)をサポートしなくなった(Googleのポリシー変更に伴うExpo側の
// 対応)。Android実機での動作確認には development build
// (`eas build --profile development`)が必要。iOSのExpo Goでは
// 引き続き動作する。
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import type { Lang } from '../i18n';
import { supabase } from './supabase';

export type PushKind = 'entry_created' | 'marked_paid' | 'marked_confirmed';

// フォアグラウンド中に通知を受け取ったときも、バナー表示・音を鳴らす
// (デフォルトのままだとフォアグラウンドでは何も表示されない)。
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

// unregisterPushNotifications(サインアウト時)で使うため、直近取得できた
// トークンを覚えておく(取得し直すとExpoへの通信が余分に発生するのと、
// サインアウト後は取得自体ができなくなるため)。
let cachedToken: string | null = null;

// サインイン中に呼ぶ(言語設定が変わった時も呼び直してよい。
// upsert_push_tokenは何度呼んでも安全)。実機の物理デバイスでのみ動く
// (シミュレータ/Web/デモモードでは静かに何もしない)。
export async function registerForPushNotifications(lang: Lang): Promise<void> {
  try {
    // Web(react-native-webのDeviceはisDeviceが常にtrueを返すため、
    // 別途Platform.OSで弾く必要がある)・シミュレータ・エミュレータでは
    // 取得不可。
    if (Platform.OS === 'web' || !Device.isDevice) return;

    const { status: existing } = await Notifications.getPermissionsAsync();
    let finalStatus = existing;
    if (existing !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== 'granted') return;

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'default',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }

    // `eas init`未実行(=projectId未設定)の開発中でもアプリ全体が
    // クラッシュしないよう、projectId不在時は諦めて何もしない。
    const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
    if (!projectId) {
      console.warn('[push] EAS projectId未設定のため、プッシュ通知トークンを取得できません(eas initが必要)');
      return;
    }

    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    cachedToken = token;
    await supabase.rpc('upsert_push_token', { _token: token, _lang: lang });
  } catch (e) {
    // 通知登録の失敗でアプリ本体の利用を妨げたくないので、握りつぶす。
    console.warn('[push] registerForPushNotifications failed', e);
  }
}

// サインアウト時に呼ぶ。この端末のトークンだけ削除する(他の端末には
// 影響しない)。セッションが切れる前(signOut本体を呼ぶ前)に呼ぶこと
// (削除にはRLS上、自分自身のセッションが必要なため)。
export async function unregisterPushNotifications(): Promise<void> {
  try {
    if (!cachedToken) return;
    await supabase.from('push_tokens').delete().eq('token', cachedToken);
    cachedToken = null;
  } catch {
    // ベストエフォート。
  }
}

// entry作成・支払い報告・受取確認のたびに呼ぶ。Edge Function
// (send-push)の応答を待たず、失敗しても呼び出し元には伝えない
// (通知はあくまで付加的な機能で、本体の操作を失敗扱いにしたくないため)。
export function notifyGroup(input: {
  groupId: string;
  kind: PushKind;
  recipientIds: string[];
  amount?: number | null;
  currency?: string | null;
  description?: string | null;
}): void {
  if (input.recipientIds.length === 0) return;
  supabase.functions
    .invoke('send-push', {
      body: {
        group_id: input.groupId,
        kind: input.kind,
        recipient_ids: input.recipientIds,
        amount: input.amount ?? null,
        currency: input.currency ?? null,
        description: input.description ?? null,
      },
    })
    .catch(() => {
      // ベストエフォート。
    });
}

// 通知をタップして開かれたとき、送信側(send-push)が載せたdata.group_id
// を取り出す(無ければnull)。
export function extractGroupIdFromNotification(response: Notifications.NotificationResponse): string | null {
  const data = response.notification.request.content.data as Record<string, unknown> | undefined;
  const groupId = data?.group_id;
  return typeof groupId === 'string' ? groupId : null;
}
