import { Platform } from 'react-native';

import { supabase } from './supabase';
import appJson from '../../app.json';

// リリース運用の仕組み(99回目): アプリ内の「ご意見・不具合報告」フォームから
// 送信された内容をfeedbackテーブルに書き込む。詳細はschema.sqlのコメント参照
// (投稿は本人のみ可、閲覧はservice role経由のみ)。
export async function submitFeedback(userId: string, message: string): Promise<{ error: string | null }> {
  const trimmed = message.trim();
  if (!trimmed) return { error: null };
  const { error } = await supabase.from('feedback').insert({
    user_id: userId,
    message: trimmed,
    app_version: appJson.expo.version,
    platform: `${Platform.OS} ${Platform.Version ?? ''}`,
  });
  return { error: error?.message ?? null };
}
