// 「アイコンで自分の写真を使えるようにしてほしい。グループのアイコンも
// 同じ」への対応。自分のアバター写真・グループのアイコン写真、どちらも
// storageの同じ`avatars`バケットにアップロードする共通処理(useGroupData.ts
// のuploadReceiptと同じ考え方)。保存パスの規約(schema.sql参照):
//   - 自分のアバター写真: "users/<user_id>/<uuid>.jpg"
//   - グループのアイコン写真: "groups/<group_id>/<uuid>.jpg"
import * as Crypto from 'expo-crypto';
import * as ImageManipulator from 'expo-image-manipulator';

import { supabase } from './supabase';
import type { Strings } from '../i18n/strings';

// アイコンは24〜44px程度の円形でしか表示しないのに、以前はカメラ/アルバムから
// 選んだ写真をリサイズせずそのままアップロードしていた(数MBになりうる)。
// 「アイコンの表示が遅い」という指摘(署名付きURLのキャッシュ化=99回目、
// では解決しきらなかった)の実質的な原因はこちら側で、毎回この大きな
// ファイルをダウンロードし直すこと自体がボトルネックだった。表示に必要な
// 解像度まで縮小してからアップロードする(選択元でaspect:[1,1]指定済み
// なのでほぼ正方形。512x512もあれば十分)。
const ICON_MAX_DIMENSION = 512;

export async function uploadIconPhoto(
  kind: 'users' | 'groups',
  scopeId: string,
  photoUri: string,
  t: Strings
): Promise<{ path: string | null; error: string | null }> {
  try {
    const resized = await ImageManipulator.manipulateAsync(
      photoUri,
      [{ resize: { width: ICON_MAX_DIMENSION, height: ICON_MAX_DIMENSION } }],
      { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG }
    );
    const response = await fetch(resized.uri);
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
