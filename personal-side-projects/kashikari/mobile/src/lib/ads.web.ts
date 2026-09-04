// react-native-google-mobile-ads・expo-tracking-transparencyはどちらも
// ネイティブ専用のため、Web版(EXPO_PUBLIC_DEMO_MODE=1でのWebプレビュー、
// Playwright検証)ではこちらのスタブが自動的に使われる(purchases.tsと
// 同じ.web.ts切り替えの仕組み。95回目)。
export const BANNER_AD_UNIT_ID = '';
export const INTERSTITIAL_AD_UNIT_ID = '';

export function initAds() {}

export async function requestTrackingPermission(): Promise<void> {}

export function preloadCelebrationAd() {}

export function showCelebrationAdIfReady(): Promise<boolean> {
  return Promise.resolve(false);
}
