// 【一時的な検証用スタブ】101回目。TestFlightでの起動時フリーズが
// RevenueCat(react-native-purchases)によるものかを切り分けるため、
// package.jsonからreact-native-purchasesを完全に削除した状態でビルド
// して検証する。単にPurchases.configure()等の呼び出しを止めるだけでは
// ネイティブモジュール自体はビルドに残ってしまうため、パッケージその
// ものを依存関係から外し、このファイルはpurchases.web.ts(元々のWeb版
// スタブ)と同じ「常に無課金」として振る舞うだけの実装に置き換える。
//
// 元の実装(react-native-purchasesを実際に呼ぶ本物のコード)は
// git履歴に残っている。検証が終わったら元に戻すこと
// (`git log`でこの変更の直前のコミットを確認して復元する)。
export const PREMIUM_ENTITLEMENT_ID = 'premium';

// react-native-purchases無しでも型だけ必要な箇所(usePremium.ts等)向けの、
// 最小限の構造的な型。本物のCustomerInfo/PurchasesOfferingの完全な型
// ではなく、このプロジェクトが実際に参照しているプロパティだけを
// カバーしている。
export type CustomerInfo = {
  entitlements: { active: Record<string, unknown> };
};

export type PurchasesOffering = {
  availablePackages: { product: { priceString: string } }[];
};

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

export async function getPremiumOffering(): Promise<PurchasesOffering | null> {
  return null;
}

export async function purchasePremium(): Promise<{ error: string | null; cancelled?: boolean }> {
  return { error: '検証用ビルドのため購入機能は無効化されています。' };
}

export async function restorePurchases(): Promise<{ error: string | null; isPremium: boolean }> {
  return { error: '検証用ビルドのため利用できません。', isPremium: false };
}
