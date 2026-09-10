import { Platform } from 'react-native';
import Purchases, { type CustomerInfo, type PurchasesOffering } from 'react-native-purchases';

// RevenueCatを使って、App Store/Google Playのサブスクリプション課金を
// 1つのAPIで扱う(生のStoreKit/Play Billingをそれぞれ実装するより
// 大幅に楽なため。94回目)。
//
// 「premium」というエンタイトルメントIDを、iOS/Androidどちらの課金
// 商品でもRevenueCatダッシュボード側で共通の目印として紐付けておく
// 想定(オーナー側の設定。README参照)。アプリ側はこのIDが有効かどうか
// だけを見ればよく、ストアごとの商品IDの違いを意識しなくてよい。
export const PREMIUM_ENTITLEMENT_ID = 'premium';

let configured = false;

// RevenueCatのAPIキーが.envに設定されていない状態(オーナーがまだ
// アカウント作成前)でも、アプリ全体を起動できなくするのは避けたい。
// 未設定の場合はconfigured=falseのままにし、以降の関数は「常に
// 無課金」として振る舞う(例外を投げてアプリをクラッシュさせない)。
function ensureConfigured() {
  if (configured) return;
  const apiKey =
    Platform.OS === 'ios'
      ? process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY
      : process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY;
  if (!apiKey) return;
  Purchases.configure({ apiKey });
  configured = true;
}

export function initPurchases() {
  ensureConfigured();
}

export function isPremiumFromInfo(info: CustomerInfo | null | undefined): boolean {
  return !!info?.entitlements.active[PREMIUM_ENTITLEMENT_ID];
}

export async function getCustomerInfo(): Promise<CustomerInfo | null> {
  ensureConfigured();
  if (!configured) return null;
  try {
    return await Purchases.getCustomerInfo();
  } catch {
    return null;
  }
}

// CustomerInfoの変化(購入完了・更新・解約・他端末での購入の反映など)を
// リアルタイムに受け取るリスナー。呼び出し側はunsubscribe関数を
// useEffectのクリーンアップで呼ぶこと。
export function addCustomerInfoListener(cb: (info: CustomerInfo) => void): () => void {
  ensureConfigured();
  if (!configured) return () => {};
  Purchases.addCustomerInfoUpdateListener(cb);
  return () => Purchases.removeCustomerInfoUpdateListener(cb);
}

export async function getPremiumOffering(): Promise<PurchasesOffering | null> {
  ensureConfigured();
  if (!configured) return null;
  try {
    const offerings = await Purchases.getOfferings();
    return offerings.current ?? null;
  } catch {
    return null;
  }
}

export async function purchasePremium(): Promise<{ error: string | null; cancelled?: boolean }> {
  ensureConfigured();
  if (!configured) return { error: '購入機能が準備できていません。時間をおいて再度お試しください。' };
  try {
    const offering = await getPremiumOffering();
    const pkg = offering?.availablePackages[0];
    if (!pkg) return { error: '購入可能なプランが見つかりませんでした。時間をおいて再度お試しください。' };
    await Purchases.purchasePackage(pkg);
    return { error: null };
  } catch (e) {
    const err = e as { userCancelled?: boolean; message?: string };
    if (err?.userCancelled) return { error: null, cancelled: true };
    return { error: err?.message ?? '購入に失敗しました' };
  }
}

export async function restorePurchases(): Promise<{ error: string | null; isPremium: boolean }> {
  ensureConfigured();
  if (!configured) return { error: '購入機能が準備できていません。', isPremium: false };
  try {
    const info = await Purchases.restorePurchases();
    return { error: null, isPremium: isPremiumFromInfo(info) };
  } catch (e) {
    const err = e as { message?: string };
    return { error: err?.message ?? '復元に失敗しました', isPremium: false };
  }
}
