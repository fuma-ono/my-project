import { createContext, useContext, type ReactNode } from 'react';

import { usePremium } from '../hooks/usePremium';

// isPremiumは広告の出し分け・CSV出力・履歴の閲覧範囲など、離れた
// 複数の画面から参照する必要があるため、props経由でバケツリレーせず
// Contextにした(94回目)。App.tsx/DemoApp.tsxのルートで1回だけ
// PremiumProviderを被せれば、どの画面でもusePremiumContext()で
// 参照できる。
type PremiumContextValue = ReturnType<typeof usePremium>;

const PremiumContext = createContext<PremiumContextValue | null>(null);

export function PremiumProvider({ demo = false, children }: { demo?: boolean; children: ReactNode }) {
  const value = usePremium(demo);
  return <PremiumContext.Provider value={value}>{children}</PremiumContext.Provider>;
}

export function usePremiumContext(): PremiumContextValue {
  const ctx = useContext(PremiumContext);
  if (!ctx) throw new Error('usePremiumContext must be used within a PremiumProvider');
  return ctx;
}
