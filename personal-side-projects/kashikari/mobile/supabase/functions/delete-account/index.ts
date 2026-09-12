// アカウント削除。Appleの審査(Guideline 2.1 Information Needed /
// 5.1.1(v) Account Deletion)で「アカウント作成に対応するアプリは、
// アプリ内にアカウント削除の導線が必要」と指摘されたことへの対応。
//
// なぜEdge Functionが必要か: 実際に認証アカウントを消す(=ログイン不能に
// する)には、Supabaseの管理者API(auth.admin.deleteUser)を叩く必要が
// あり、これはservice_role鍵を持つサーバー側でしか呼べない(クライアント
// からは呼べない)。line-signin・send-pushと同じ理由で、この操作だけ
// Edge Functionに切り出している。
//
// 設計上の判断(なぜ「ソフトデリート」なのか):
// public.entries.from_user/to_user/created_by等はpublic.profiles(id)への
// 外部キーだが、on delete cascadeを付けていない(=貸し借りの記録は、
// 相手のアカウントが消えても勝手に消えてほしくない。グループの他の
// メンバーの台帳・残高計算が壊れてしまうため)。一方
// public.profiles.idはauth.users(id)にon delete cascadeを付けている。
// もしauth.users行を本当に削除すると、profiles行が連鎖削除されようと
// して、上記entries等の外部キー制約に違反しトランザクション全体が
// エラーになる(=退会したくてもentriesがある限り退会できない、という
// 詰み状態になる)。
//
// そのため、Supabase公式が推奨する「ソフトデリート」
// (admin.deleteUser(id, true))を使う。これはauth.users行自体は残した
// まま、GoTrue側でメール/電話番号をスクランブルし、以後そのアカウントで
// 二度とログインできなくする(=Appleが求める「アカウントの削除」を
// 満たす)。auth.users行が残るため、profiles行へのcascade削除は発火せず、
// entries等の外部キー制約にも違反しない。
//
// profiles行自体は「個人を特定できる情報を消した状態」で残す
// (display_name→プレースホルダー、avatar_emoji/avatar_photo_path→null)。
// これにより、グループの他のメンバーから見た台帳・残高計算は壊れず、
// 退会した相手は「(退会したユーザー)」のような表示になる。
//
// 副作用として、退会したユーザーが管理者(groups.created_by)だった
// グループは、以後そのグループの管理者専用操作(メンバー削除・グループ
// 削除・会費設定)ができなくなる(created_by = auth.uid()の比較が、
// 二度とログインできない=auth.uid()を得られないユーザーとは一致し
// 得ないため)。閲覧・記録の追加・精算等の通常操作には影響しない。
// 将来的に「管理者の移譲」機能を用意すれば解消できるが、現時点では
// 未対応(Apple審査の要求はあくまで「アカウントを削除できること」で
// あり、この副作用の解消は必須ではないため)。

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
}

type RequestBody = { placeholder_name?: string };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return jsonResponse({ error: 'missing authorization' }, 401);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // 呼び出したユーザー自身の権限で動くクライアント。「本人からの
    // リクエストか」の確認だけに使う(send-pushと同じパターン)。
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await callerClient.auth.getUser();
    if (userError || !userData.user) return jsonResponse({ error: 'unauthorized' }, 401);
    const userId = userData.user.id;

    const body = (await req.json().catch(() => ({}))) as RequestBody;
    const placeholderName =
      typeof body.placeholder_name === 'string' && body.placeholder_name.trim().length > 0
        ? body.placeholder_name.trim().slice(0, 20)
        : '退会したユーザー';

    const admin = createClient(supabaseUrl, serviceRoleKey);

    // 1. アバター写真があれば先に取得しておき、後でstorageから削除する。
    const profileRes = await admin.from('profiles').select('avatar_photo_path').eq('id', userId).maybeSingle();
    const avatarPath = profileRes.data?.avatar_photo_path as string | null | undefined;

    // 2. プロフィールの個人識別情報を消す(行自体は残す。理由は上記コメント参照)。
    const { error: profileError } = await admin
      .from('profiles')
      .update({ display_name: placeholderName, avatar_emoji: null, avatar_photo_path: null, deleted_at: new Date().toISOString() })
      .eq('id', userId);
    if (profileError) {
      console.error('delete-account: profile anonymize failed', profileError);
      return jsonResponse({ error: profileError.message }, 500);
    }

    if (avatarPath) {
      const { error: storageError } = await admin.storage.from('avatars').remove([avatarPath]);
      if (storageError) console.error('delete-account: avatar remove failed', storageError);
    }

    // 3. プッシュ通知トークン・グループ参加状態は削除する(退会後は
    //    通知を受け取らない・「参加中」のメンバーとして出続けない)。
    //    entries等の記録自体は消さない(1のコメント参照)。
    await admin.from('push_tokens').delete().eq('user_id', userId);
    await admin.from('group_members').delete().eq('user_id', userId);

    // 4. 認証アカウントをソフトデリートする(shouldSoftDelete: true)。
    //    auth.users行自体は残るため、profiles行へのcascade削除は
    //    発火しない(必ずtrueで呼ぶこと。falseにするとentriesの外部
    //    キー制約違反でここが失敗し、1〜3が中途半端に適用された状態に
    //    なってしまう)。
    const { error: deleteError } = await admin.auth.admin.deleteUser(userId, true);
    if (deleteError) {
      console.error('delete-account: auth.admin.deleteUser failed', deleteError);
      return jsonResponse({ error: deleteError.message }, 500);
    }

    return jsonResponse({ ok: true });
  } catch (e) {
    console.error('delete-account: unexpected error', e);
    return jsonResponse({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
