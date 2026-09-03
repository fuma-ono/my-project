// 「アイコンで自分の写真を使えるようにしてほしい。グループのアイコンも
// 同じ」への対応。自分のアバター写真・グループのアイコン写真、どちらも
// storageの同じ`avatars`バケットにアップロードする共通処理(useGroupData.ts
// のuploadReceiptと同じ考え方)。保存パスの規約(schema.sql参照):
//   - 自分のアバター写真: "users/<user_id>/<uuid>.jpg"
//   - グループのアイコン写真: "groups/<group_id>/<uuid>.jpg"
import * as Crypto from 'expo-crypto';

import { supabase } from './supabase';
import type { Strings } from '../i18n/strings';

export async function uploadIconPhoto(
  kind: 'users' | 'groups',
  scopeId: string,
  photoUri: string,
  t: Strings
): Promise<{ path: string | null; error: string | null }> {
  try {
    const response = await fetch(photoUri);
    const arrayBuffer = await response.arrayBuffer();
    const path = `${kind}/${scopeId}/${Crypto.randomUUID()}.jpg`;
    const { error: uploadError } = await supabase.storage
      .from('avatars')
      .upload(path, arrayBuffer, { contentType: 'image/jpeg', upsert: true });
    if (uploadError) return { path: null, error: t.groupData.photoUploadFailed(uploadError.message) };
    return { path, error: null };
  } catch {
    return { path: null, error: t.groupData.photoProcessFailed };
  }
}
