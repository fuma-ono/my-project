import { useCallback, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';

import { useT } from '../i18n';
import { uploadIconPhoto } from '../lib/iconPhoto';
import { unregisterPushNotifications } from '../lib/pushNotifications';
import { supabase } from '../lib/supabase';
import type { Profile } from '../types';

const PROFILE_COLUMNS = 'id, display_name, avatar_emoji, avatar_photo_path, notifications_seen_at';

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
    // この端末のプッシュ通知トークンの削除は、セッションが切れる(=RLS上
    // 自分の行だと証明できなくなる)より前に行う必要があるため、
    // signOut本体より先に呼ぶ。
    await unregisterPushNotifications();
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
      // 写真とは排他のため、絵文字を選んだらavatar_photo_pathを明示的に
      // クリアする(「アイコンで自分の写真を使えるようにしてほしい」への
      // 対応で追加。以前アップロード済みの写真ファイル自体はstorageに
      // 残るが、参照が外れるだけで実害は無いため削除まではしていない)。
      const { data, error } = await supabase
        .from('profiles')
        .update({ avatar_emoji: avatarEmoji, avatar_photo_path: null })
        .eq('id', state.userId)
        .select(PROFILE_COLUMNS)
        .single();
      if (error) return { error: error.message };
      setState((s) => ({ ...s, profile: data }));
      return { error: null };
    },
    [state.userId, t]
  );

  // 「アイコンで自分の写真を使えるようにしてほしい」への対応。
  const updateAvatarPhoto = useCallback(
    async (photoUri: string) => {
      if (!state.userId) return { error: t.auth.unauthenticated };
      const uploadRes = await uploadIconPhoto('users', state.userId, photoUri, t);
      if (uploadRes.error) return { error: uploadRes.error };
      const { data, error } = await supabase
        .from('profiles')
        .update({ avatar_photo_path: uploadRes.path, avatar_emoji: null })
        .eq('id', state.userId)
        .select(PROFILE_COLUMNS)
        .single();
      if (error) return { error: error.message };
      setState((s) => ({ ...s, profile: data }));
      return { error: null };
    },
    [state.userId, t]
  );

  // 通知ベルの未読マーク用。「今の時刻より前のnotification_logは既読」
  // という単純な仕組みなので、通知ページを開いたタイミングでこれを
  // 呼んで基準時刻を更新するだけでよい(既読/未読を1件ずつ管理しない)。
  const markNotificationsSeen = useCallback(async () => {
    if (!state.userId) return;
    const now = new Date().toISOString();
    // 楽観的に即座にベルの表示へ反映する(サーバーの応答を待たない)。
    setState((s) => (s.profile ? { ...s, profile: { ...s.profile, notifications_seen_at: now } } : s));
    await supabase.from('profiles').update({ notifications_seen_at: now }).eq('id', state.userId);
  }, [state.userId]);

  return { ...state, setDisplayName, updateAvatar, updateAvatarPhoto, signOut, markNotificationsSeen };
}
