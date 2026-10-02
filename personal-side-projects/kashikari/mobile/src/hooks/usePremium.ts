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
import { supabase } from '../lib/supabase';

// 招待インセンティブ(108回目)。join_group RPCが付与するprofiles.
// bonus_premium_untilが未来日時の間は、RevenueCatの課金とは独立に
// Premium扱いにする。
async function getBonusPremiumUntil(): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  const userId = data.user?.id;
  if (!userId) return null;
  const { data: profile } = await supabase.from('profiles').select('bonus_premium_until').eq('id', userId).maybeSingle();
  return profile?.bonus_premium_until ?? null;
}

function isBonusActive(bonusUntil: string | null): boolean {
  return !!bonusUntil && new Date(bonusUntil).getTime() > Date.now();
}

// アプリ全体で「今のユーザーがPremium加入済みかどうか」を1箇所で
// 管理するためのフック(94回目)。実体はsrc/lib/purchases.ts
// (ネイティブ)/purchases.web.ts(Webスタブ)に委譲しているので、
// このフック自体はどちらの環境でも同じコードで動く。
//
// demo=trueの場合(デモモード)は、そもそもSupabase認証すら無い
// 架空のユーザーなので、RevenueCatの初期化自体を行わず常に
// isPremium=falseにする。
export function usePremium(demo = false) {
  const [rcPremium, setRcPremium] = useState(false);
  const [bonusUntil, setBonusUntil] = useState<string | null>(null);
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
      const [info, off, bonus] = await Promise.all([getCustomerInfo(), getPremiumOffering(), getBonusPremiumUntil()]);
      if (cancelled) return;
      setRcPremium(isPremiumFromInfo(info));
      setBonusUntil(bonus);
      setOffering(off);
      setLoading(false);
    })();
    const unsubscribe = addCustomerInfoListener((info) => setRcPremium(isPremiumFromInfo(info)));
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [demo]);

  const isPremium = rcPremium || isBonusActive(bonusUntil);

  const purchase = useCallback(async () => {
    return purchasePremiumImpl();
  }, []);

  const restore = useCallback(async () => {
    const res = await restorePurchasesImpl();
    if (!res.error) setRcPremium(res.isPremium);
    return res;
  }, []);

  return { isPremium, loading, offering, purchase, restore, bonusPremiumUntil: isBonusActive(bonusUntil) ? bonusUntil : null };
}
