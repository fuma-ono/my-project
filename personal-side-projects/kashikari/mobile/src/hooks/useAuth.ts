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

// 「サインイン前提で作成してくれない?」という指摘への対応。以前は
// セッションが無い端末で自動的に匿名サインインしていた(=ノーアカウント
// でも即使える設計)が、以下の理由で撤廃した。
// - 匿名のまま使い続けると、機種変更・アプリ再インストールで
//   グループのデータへ二度とアクセスできなくなる事故が起きうる
// - 「ログイン方法を後から追加できる」形にしても、追加を忘れる/後回し
//   にする人がいる限りこのリスクは消えない
// 今は、セッションが無い(=誰もサインインしていない)場合はuserId/profile
// ともnullのまま止まり、OnboardingScreen側がGoogle/Apple/LINE/メールでの
// サインインを要求する画面を表示する(スキップする手段は無い)。
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
      // 誰もサインインしていない: サインイン待ちの状態にするだけで、
      // ここでは何も作らない(以前あった匿名の自動サインインを撤廃)。
      setState((s) => ({ ...s, loading: false, userId: null, profile: null, error: null }));
    },
    [loadProfile]
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
      // ログアウト後(event === 'SIGNED_OUT')も含め、セッションが無く
      // なったら素直にサインイン待ちの状態へ戻す。以前はここが何もして
      // おらず、ログアウトしても画面上に古いuserId/profileが残ったままに
      // なるバグがあったため、あわせて修正している。
      setState({ loading: false, userId: null, profile: null, error: null });
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [bootstrap, loadProfile]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    // 以降の状態更新はonAuthStateChange(上のハンドラ)側で行われる。
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
