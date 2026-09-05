import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { en, ja, type Strings } from './strings';

export type Lang = 'ja' | 'en';

const STORAGE_KEY = 'kashikari:lang';
const DICTS: Record<Lang, Strings> = { ja, en };

type Ctx = {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: Strings;
};

const LanguageContext = createContext<Ctx | null>(null);

// 設定画面から切り替えられる、アプリ全体の言語設定。AsyncStorageに保存する
// ことで次回起動時も引き継ぐ。デフォルトは日本語(このアプリの主な利用者に
// 合わせる)。
export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>('ja');

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((saved) => {
      if (saved === 'ja' || saved === 'en') setLangState(saved);
    });
  }, []);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {});
  }, []);

  const value = useMemo<Ctx>(() => ({ lang, setLang, t: DICTS[lang] }), [lang, setLang]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

// 文言オブジェクトだけが欲しい呼び出し側向け(`const t = useT(); t.groups.empty`)。
export function useT(): Strings {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useT() must be used within a LanguageProvider');
  return ctx.t;
}

// 言語の現在値・切り替え関数も欲しい場合(設定画面)向け。
export function useLanguage(): Ctx {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useLanguage() must be used within a LanguageProvider');
  return ctx;
}
