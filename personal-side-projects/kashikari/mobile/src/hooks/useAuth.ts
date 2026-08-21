import { useCallback, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';

import { supabase } from '../lib/supabase';
import type { Profile } from '../types';

type AuthState = {
  loading: boolean;
  userId: string | null;
  profile: Profile | null;
  error: string | null;
};

export function useAuth() {
  const [state, setState] = useState<AuthState>({
    loading: true,
    userId: null,
    profile: null,
    error: null,
  });

  const loadProfile = useCallback(async (userId: string) => {
    const { data, error } = await supabase.from('profiles').select('id, display_name').eq('id', userId).maybeSingle();
    if (error) {
      setState((s) => ({ ...s, loading: false, error: error.message }));
      return;
    }
    setState((s) => ({ ...s, loading: false, userId, profile: data, error: null }));
  }, []);

  const bootstrap = useCallback(
    async (session: Session | null) => {
      if (session?.user) {
        await loadProfile(session.user.id);
        return;
      }
      // まだ誰もサインインしていない端末: 匿名で自動サインインする。
      // メール/パスワードの入力を一切求めない設計(Supabase側で
      // Anonymous Sign-Ins を有効化しておく必要がある。README参照)。
      const { data, error } = await supabase.auth.signInAnonymously();
      if (error || !data.user) {
        setState((s) => ({ ...s, loading: false, error: error?.message ?? '匿名サインインに失敗しました' }));
        return;
      }
      setState((s) => ({ ...s, loading: false, userId: data.user!.id, profile: null }));
    },
    [loadProfile]
  );

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (mounted) bootstrap(data.session);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) loadProfile(session.user.id);
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [bootstrap, loadProfile]);

  const setDisplayName = useCallback(
    async (name: string) => {
      if (!state.userId) return { error: '未認証です' };
      const trimmed = name.trim();
      if (!trimmed) return { error: '名前を入力してください' };
      const { data, error } = await supabase
        .from('profiles')
        .upsert({ id: state.userId, display_name: trimmed })
        .select('id, display_name')
        .single();
      if (error) return { error: error.message };
      setState((s) => ({ ...s, profile: data }));
      return { error: null };
    },
    [state.userId]
  );

  return { ...state, setDisplayName };
}
