import type { CustomerInfo } from 'react-native-purchases';

// react-native-purchasesはネイティブ専用のモジュールで、Web版
// (EXPO_PUBLIC_DEMO_MODE=1でのWebプレビュー、Playwright検証)では
// そもそも動かない。Metroはファイル名の.web.tsサフィックスを見て、
// Webビルド時だけこちらを自動的に使う(purchases.tsのネイティブ実装が
// バンドルに含まれることはない)ので、ここでは常に「無課金」として
// 振る舞うだけのスタブにしてある。94回目。
export const PREMIUM_ENTITLEMENT_ID = 'premium';

export function initPurchases() {}

export function isPremiumFromInfo(_info?: CustomerInfo | null): boolean {
  return false;
}

export async function getCustomerInfo(): Promise<CustomerInfo | null> {
  return null;
}

export function addCustomerInfoListener(_cb: (info: CustomerInfo) => void): () => void {
  return () => {};
}

export async function getPremiumOffering() {
  return null;
}

export async function purchasePremium(): Promise<{ error: string | null; cancelled?: boolean }> {
  return { error: 'Web版では購入できません。実機のアプリからお試しください。' };
}

export async function restorePurchases(): Promise<{ error: string | null; isPremium: boolean }> {
  return { error: 'Web版では利用できません。', isPremium: false };
}
