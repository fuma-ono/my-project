import { useEffect, useState } from 'react';

import { supabase } from '../lib/supabase';

// 非公開バケット(receipts・avatars)の中身を表示するための、汎用の
// 署名付きURL発行フック。useReceiptUrl.tsが元々receipts専用で持っていた
// ものを、avatars(アイコン写真)でも使えるよう汎用化した。
//
// 「アイコンを開くたびに一瞬ラグが出る(何も表示されない→写真が
// 出てくる)」という指摘への対応(99回目)。原因は2つ:
// ①署名付きURLをマウントの度に毎回発行し直しており、表示前に
//   Supabaseへの往復(認証つきAPI呼び出し)が挟まっていた
// ②createSignedUrlは呼ぶたびに違うトークン付きURLを返すため、
//   同じ写真でもURL文字列が毎回変わり、<Image>側のキャッシュが
//   絶対にヒットしない(バイト列は同じでも毎回フルダウンロード)
// 対策として、(bucket, path)をキーにモジュールレベルでURLをキャッシュし、
// 有効期限内は使い回す。アイコン写真のパスは変更のたびに新しいUUIDが
// 割り当てられる(uploadIconPhoto参照)ため、古い写真のURLが
// キャッシュに残っていても新しい写真と取り違える心配はない。
const SIGNED_URL_TTL_SEC = 60 * 60; // Supabase側に要求する有効期限
const REFRESH_MARGIN_MS = 5 * 60 * 1000; // 期限切れの5分前には再発行する

type CacheEntry = { url: string; expiresAt: number };
const cache = new Map<string, CacheEntry>();

function cacheKey(bucket: string, path: string) {
  return `${bucket}:${path}`;
}

export function useSignedUrl(bucket: string, path: string | null): string | null {
  const key = path ? cacheKey(bucket, path) : null;
  const cached = key ? cache.get(key) : undefined;
  const cachedValid = cached && cached.expiresAt > Date.now() ? cached.url : null;

  // キャッシュにまだ有効なURLがあれば、初回レンダリングから
  // それを使う(=空白のフレームを挟まない)。
  const [url, setUrl] = useState<string | null>(cachedValid);

  useEffect(() => {
    let cancelled = false;
    if (!path || !key) {
      setUrl(null);
      return;
    }
    const existing = cache.get(key);
    if (existing && existing.expiresAt > Date.now()) {
      setUrl(existing.url);
      return;
    }
    supabase.storage
      .from(bucket)
      .createSignedUrl(path, SIGNED_URL_TTL_SEC)
      .then(({ data }) => {
        if (!data?.signedUrl) return;
        cache.set(key, { url: data.signedUrl, expiresAt: Date.now() + SIGNED_URL_TTL_SEC * 1000 - REFRESH_MARGIN_MS });
        if (!cancelled) setUrl(data.signedUrl);
      });
    return () => {
      cancelled = true;
    };
  }, [bucket, path, key]);

  return url;
}
