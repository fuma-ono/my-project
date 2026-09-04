import { Platform } from 'react-native';
import * as TrackingTransparency from 'expo-tracking-transparency';
import mobileAds, { TestIds } from 'react-native-google-mobile-ads';

// 「広告なし」をPremium特典にする(94回目の続き、95回目)。バナー広告は
// Google AdMob(react-native-google-mobile-ads)を使う。
//
// 広告ユニットIDは.envで上書きできるようにしつつ、未設定でもクラッシュ
// せず必ずGoogle公式のテスト広告ユニットID(TestIds)にフォールバック
// するようにした。テストIDは実際の広告在庫は出ないダミー広告だが、
// レイアウト・動作の確認には支障がない(オーナーが実際のAdMob
// アカウント・広告ユニットを作るまでの間、安全に動かせる)。
//
// AdMobの「アプリID」自体(SDK初期化やInfo.plist/AndroidManifestに
// 埋め込む値)はネイティブビルド時に固定される値のため、実行時のenvでは
// 上書きできない。app.jsonのreact-native-google-mobile-adsプラグイン
// 設定(androidAppId/iosAppId)を、オーナーが実際のAdMobアプリIDに
// 差し替える必要がある(README参照)。
export const BANNER_AD_UNIT_ID =
  (Platform.OS === 'ios' ? process.env.EXPO_PUBLIC_ADMOB_BANNER_IOS : process.env.EXPO_PUBLIC_ADMOB_BANNER_ANDROID) ||
  TestIds.BANNER;

let initialized = false;

export function initAds() {
  if (initialized) return;
  initialized = true;
  mobileAds()
    .initialize()
    .catch(() => {
      // 初期化失敗(ネットワーク不通など)は広告が出ないだけに留め、
      // アプリ本体の動作は止めない。
    });
}

// iOSのApp Tracking Transparency許可ダイアログ。「パーソナライズ広告の
// ために他アプリ・Webサイトでの行動を追跡してよいか」をユーザーに聞く
// もので、iOS 14.5以降は広告SDKがIDFAを使う前に必須。Androidでは
// 概念自体が無いため何もしない。呼び出し側(App.tsx)で、ホーム画面が
// 最初に表示されたタイミングなど、ユーザーが文脈を理解できるタイミングで
// 1回だけ呼ぶ想定。
export async function requestTrackingPermission(): Promise<void> {
  if (Platform.OS !== 'ios') return;
  try {
    const { status } = await TrackingTransparency.getTrackingPermissionsAsync();
    if (status === 'undetermined') {
      await TrackingTransparency.requestTrackingPermissionsAsync();
    }
  } catch {
    // 許可ダイアログの表示に失敗しても、広告自体は(非パーソナライズ
    // 広告として)引き続き出せるため、アプリを止めない。
  }
}
