import { Platform } from 'react-native';
import * as TrackingTransparency from 'expo-tracking-transparency';
import mobileAds, { AdEventType, InterstitialAd, TestIds } from 'react-native-google-mobile-ads';

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

// 「精算完了」のようなお祝いの瞬間に挟む、軽いインタースティシャル広告
// (バナーとは別枠。ユーザーからの提案・98回目)。
export const INTERSTITIAL_AD_UNIT_ID =
  (Platform.OS === 'ios' ? process.env.EXPO_PUBLIC_ADMOB_INTERSTITIAL_IOS : process.env.EXPO_PUBLIC_ADMOB_INTERSTITIAL_ANDROID) ||
  TestIds.INTERSTITIAL;

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

// 「精算が完了して、貸し借りが0件になった瞬間」のような、お祝いの
// タイミングに挟む軽いインタースティシャル広告(98回目)。バナーと違い
// 画面全体を覆うため、①頻度をお祝いの瞬間だけに絞る(呼び出し側=
// GroupScreen.tsxの精算完了フックでのみ呼ぶ)、②読み込みが間に合って
// いない時は絶対にユーザーを待たせない(読み込み中なら何もしない)、
// の2点を徹底して「軽さ」を保つ。isPremiumのユーザーには呼び出し側で
// そもそも呼ばないこと。
let interstitial: InterstitialAd | null = null;
let interstitialLoaded = false;

function loadNextInterstitial() {
  const ad = InterstitialAd.createForAdRequest(INTERSTITIAL_AD_UNIT_ID);
  interstitial = ad;
  interstitialLoaded = false;
  const unsubscribeLoaded = ad.addAdEventListener(AdEventType.LOADED, () => {
    interstitialLoaded = true;
  });
  const unsubscribeClosed = ad.addAdEventListener(AdEventType.CLOSED, () => {
    unsubscribeLoaded();
    unsubscribeClosed();
    // 1回表示し終わったら、次のお祝いの瞬間に間に合うよう裏で読み込み
    // 直しておく(インタースティシャルは1回表示すると使い捨てのため)。
    loadNextInterstitial();
  });
  ad.load();
}

// アプリ側でお祝いの瞬間が来る前に、あらかじめ読み込みを始めておく
// (GroupScreen.tsxのマウント時に1回呼ぶ想定)。何度呼んでもよい。
export function preloadCelebrationAd() {
  if (interstitial) return;
  loadNextInterstitial();
}

// 読み込みが間に合っていれば表示し、閉じられたら解決する。間に合って
// いなければユーザーを待たせずfalseで即座に解決する(呼び出し側は
// そのまま次の演出・ダイアログに進めばよい)。
export function showCelebrationAdIfReady(): Promise<boolean> {
  if (!interstitial || !interstitialLoaded) return Promise.resolve(false);
  const ad = interstitial;
  return new Promise((resolve) => {
    const unsubscribeClosed = ad.addAdEventListener(AdEventType.CLOSED, () => {
      unsubscribeClosed();
      resolve(true);
    });
    ad.show();
  });
}
