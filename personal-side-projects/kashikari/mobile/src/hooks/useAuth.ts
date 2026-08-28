import { useCallback, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';

import { useT } from '../i18n';
import { supabase } from '../lib/supabase';
import type { Profile } from '../types';

const PROFILE_COLUMNS = 'id, display_name, avatar_emoji';

type AuthState = {
  loading: boolean;
  userId: string | null;
  profile: Profile | null;
  error: string | null;
};

export function useAuth() {
  const t = useT();
  const [state, setState] = useState<AuthState>({
    loading: true,
    userId: null,
    profile: null,
    error: null,
  });

  const loadProfile = useCallback(async (userId: string) => {
    const { data, error } = await supabase.from('profiles').select(PROFILE_COLUMNS).eq('id', userId).maybeSingle();
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
        setState((s) => ({ ...s, loading: false, error: error?.message ?? t.auth.anonymousSignInFailed }));
        return;
      }
      setState((s) => ({ ...s, loading: false, userId: data.user!.id, profile: null }));
    },
    [loadProfile, t]
  );

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (mounted) bootstrap(data.session);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (session?.user) {
        loadProfile(session.user.id);
        return;
      }
      // 「ログアウト機能が無いのはおかしい」への対応。signOut()が呼ばれると
      // ここがsession=nullで発火する。以前はここが何もしていなかったため、
      // ログアウトしても画面上は古いuserId/profileが残ったままになる
      // バグがあった。ここでstateを一度リセットしてbootstrap(null)を
      // 呼び直すことで、新しい匿名セッションを自動作成し、オンボーディング
      // 画面(名前登録前の状態)に正しく戻す。
      if (event === 'SIGNED_OUT') {
        setState({ loading: true, userId: null, profile: null, error: null });
        bootstrap(null);
      }
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [bootstrap, loadProfile]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    // 以降の状態更新はonAuthStateChange(上のSIGNED_OUTハンドラ)側で行われる。
  }, []);

  const setDisplayName = useCallback(
    async (name: string, avatarEmoji: string | null) => {
      if (!state.userId) return { error: t.auth.unauthenticated };
      const trimmed = name.trim();
      if (!trimmed) return { error: t.auth.nameRequired };
      const { data, error } = await supabase
        .from('profiles')
        .upsert({ id: state.userId, display_name: trimmed, avatar_emoji: avatarEmoji })
        .select(PROFILE_COLUMNS)
        .single();
      if (error) return { error: error.message };
      setState((s) => ({ ...s, profile: data }));
      return { error: null };
    },
    [state.userId, t]
  );

  const updateAvatar = useCallback(
    async (avatarEmoji: string) => {
      if (!state.userId) return { error: t.auth.unauthenticated };
      const { data, error } = await supabase
        .from('profiles')
        .update({ avatar_emoji: avatarEmoji })
        .eq('id', state.userId)
        .select(PROFILE_COLUMNS)
        .single();
      if (error) return { error: error.message };
      setState((s) => ({ ...s, profile: data }));
      return { error: null };
    },
    [state.userId, t]
  );

  return { ...state, setDisplayName, updateAvatar, signOut };
}
