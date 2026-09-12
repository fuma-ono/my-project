// アカウント削除(Apple審査 Guideline 2.1/5.1.1(v)対応)。実際の削除処理
// (認証アカウントのソフトデリート・個人情報の匿名化)はsupabase/functions/
// delete-account側で行う(service_role鍵が要るためクライアントからは
// 直接できない。詳細はそちらのコメント参照)。この関数はそれを呼び、
// 成功したらローカルのセッションも破棄する。

import { supabase } from './supabase';

export async function deleteAccount(placeholderName: string): Promise<{ error: string | null }> {
  try {
    const { data, error } = await supabase.functions.invoke('delete-account', {
      body: { placeholder_name: placeholderName },
    });
    if (error) return { error: error.message };
    const ok = (data as { ok?: boolean } | null)?.ok === true;
    if (!ok) return { error: (data as { error?: string } | null)?.error ?? 'unknown error' };

    // サーバー側では既にソフトデリート済みのため、ここでのsignOutが
    // 失敗しても(例: 既にセッションが失効している等)無視してよい。
    await supabase.auth.signOut().catch(() => {});
    return { error: null };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
