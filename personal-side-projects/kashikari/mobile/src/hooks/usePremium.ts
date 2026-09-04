import { useCallback, useEffect, useState } from 'react';
import type { PurchasesOffering } from 'react-native-purchases';

import {
  addCustomerInfoListener,
  getCustomerInfo,
  getPremiumOffering,
  initPurchases,
  isPremiumFromInfo,
  purchasePremium as purchasePremiumImpl,
  restorePurchases as restorePurchasesImpl,
} from '../lib/purchases';

// アプリ全体で「今のユーザーがPremium加入済みかどうか」を1箇所で
// 管理するためのフック(94回目)。実体はsrc/lib/purchases.ts
// (ネイティブ)/purchases.web.ts(Webスタブ)に委譲しているので、
// このフック自体はどちらの環境でも同じコードで動く。
//
// demo=trueの場合(デモモード)は、そもそもSupabase認証すら無い
// 架空のユーザーなので、RevenueCatの初期化自体を行わず常に
// isPremium=falseにする。
export function usePremium(demo = false) {
  const [isPremium, setIsPremium] = useState(false);
  const [loading, setLoading] = useState(!demo);
  const [offering, setOffering] = useState<PurchasesOffering | null>(null);

  useEffect(() => {
    if (demo) {
      setLoading(false);
      return;
    }
    initPurchases();
    let cancelled = false;
    (async () => {
      const [info, off] = await Promise.all([getCustomerInfo(), getPremiumOffering()]);
      if (cancelled) return;
      setIsPremium(isPremiumFromInfo(info));
      setOffering(off);
      setLoading(false);
    })();
    const unsubscribe = addCustomerInfoListener((info) => setIsPremium(isPremiumFromInfo(info)));
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [demo]);

  const purchase = useCallback(async () => {
    return purchasePremiumImpl();
  }, []);

  const restore = useCallback(async () => {
    const res = await restorePurchasesImpl();
    if (!res.error) setIsPremium(res.isPremium);
    return res;
  }, []);

  return { isPremium, loading, offering, purchase, restore };
}
