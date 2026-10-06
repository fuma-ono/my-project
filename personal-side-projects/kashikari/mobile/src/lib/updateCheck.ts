// 「旧バージョンを開いていても気付かない」という指摘への対応(107回目)。
// 起動時にiTunes Lookup APIでApp Store上の最新バージョンを取得し、手元の
// バージョン(app.jsonのexpo.version)より新しければアップデートを促す
// Alertを出す。Androidは未リリースのため対象外。通信に失敗しても、
// アプリ本体の起動は一切妨げない(ads.ts/sentry.tsと同じ方針)。
import Constants from 'expo-constants';
import { Alert, Linking, Platform } from 'react-native';

import { IOS_APP_ID } from './reviewPrompt';

const LOOKUP_URL = `https://itunes.apple.com/lookup?id=${IOS_APP_ID}&country=jp`;

function isNewerVersion(remote: string, local: string): boolean {
  const r = remote.split('.').map((n) => parseInt(n, 10) || 0);
  const l = local.split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(r.length, l.length);
  for (let i = 0; i < len; i++) {
    const rv = r[i] ?? 0;
    const lv = l[i] ?? 0;
    if (rv !== lv) return rv > lv;
  }
  return false;
}

function openAppStore(): void {
  Linking.openURL(`itms-apps://apps.apple.com/app/id${IOS_APP_ID}`).catch(() => {
    Linking.openURL(`https://apps.apple.com/app/id${IOS_APP_ID}`).catch(() => {});
  });
}

type UpdateCheckStrings = { title: string; message: string; updateButton: string; laterButton: string };

// アプリ起動時に1回だけ呼ぶ想定(App.tsx)。デモモードでは呼ばないこと。
export async function checkForAppUpdate(t: UpdateCheckStrings): Promise<void> {
  if (Platform.OS !== 'ios') return;
  try {
    const res = await fetch(LOOKUP_URL);
    if (!res.ok) return;
    const json = (await res.json()) as { results?: Array<{ version?: string }> };
    const remoteVersion = json.results?.[0]?.version;
    // 111回目: Constants.expoConfig?.versionは本番(standalone)ビルドで
    // nullになることがあり(JS側の設定マニフェストに依存するため)、
    // 1.2をリリースしても実機でアラートが出ない不具合があった。ネイティブ
    // バイナリに埋め込まれた実際のバージョン文字列を直接読む
    // Constants.nativeAppVersionに切り替える。
    const localVersion = Constants.nativeAppVersion;
    if (!remoteVersion || !localVersion || !isNewerVersion(remoteVersion, localVersion)) return;
    Alert.alert(t.title, t.message, [
      { text: t.laterButton, style: 'cancel' },
      { text: t.updateButton, onPress: openAppStore },
    ]);
  } catch {
    // 通信失敗(オフライン等)は何もしない。次回起動時にまた確認される。
  }
}
