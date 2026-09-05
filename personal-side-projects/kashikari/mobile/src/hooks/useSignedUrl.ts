import AsyncStorage from '@react-native-async-storage/async-storage';
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
//
// 「まだ遅い」という追加報告(99回目・実機再検証)を受け、AsyncStorageにも
// 永続化するよう拡張した。メモリ上のキャッシュだけだと、アプリを
// 強制終了して開き直すたび(=JSコンテキストが作り直されるたび)に
// また往復が発生してしまう。テスト中は不具合の確認のために強制終了→
// 再起動を繰り返しがちで、そのたびに「初回扱い」になっていたのが
// 「直っていない」ように見えた一因と考えられる。
const SIGNED_URL_TTL_SEC = 60 * 60; // Supabase側に要求する有効期限
const REFRESH_MARGIN_MS = 5 * 60 * 1000; // 期限切れの5分前には再発行する
const STORAGE_PREFIX = 'kashikari:signedUrl:';

type CacheEntry = { url: string; expiresAt: number };
const cache = new Map<string, CacheEntry>();

function cacheKey(bucket: string, path: string) {
  return `${bucket}:${path}`;
}

function storageKey(bucket: string, path: string) {
  return `${STORAGE_PREFIX}${bucket}:${path}`;
}

function isValid(entry: CacheEntry | null | undefined): entry is CacheEntry {
  return !!entry && entry.expiresAt > Date.now();
}

async function readPersisted(bucket: string, path: string): Promise<CacheEntry | null> {
  try {
    const raw = await AsyncStorage.getItem(storageKey(bucket, path));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEntry;
    return isValid(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function persist(bucket: string, path: string, entry: CacheEntry) {
  AsyncStorage.setItem(storageKey(bucket, path), JSON.stringify(entry)).catch(() => {
    // 端末側の保存に失敗しても、メモリ上のキャッシュ・今回の表示自体は
    // 問題ないので握りつぶしてよい(次回また往復が発生するだけ)。
  });
}

// グループ一覧・メンバー一覧のように「複数のアイコンが一度に並ぶ」画面向け。
// 1件ずつcreateSignedUrlを個別に呼ぶ(=一覧のアイコン数だけ往復が並列発生する)
// 代わりに、createSignedUrls(複数形)でまとめて1回のリクエストにする。
// 結果はそのままモジュールのキャッシュに書き込むので、この後に各Avatar/Mark
// コンポーネントがuseSignedUrlで同じpathを引くとキャッシュヒットする
// (=一覧が表示される時点でほぼ全アイコンの往復が終わっている状態を狙う)。
// 呼び出し側は結果を待つ必要はない(fire-and-forget)。
export function prefetchSignedUrls(bucket: string, paths: (string | null | undefined)[]): void {
  const uniquePaths = Array.from(new Set(paths.filter((p): p is string => !!p)));
  const stillUncached = uniquePaths.filter((p) => !isValid(cache.get(cacheKey(bucket, p))));
  if (stillUncached.length === 0) return;

  void (async () => {
    // メモリキャッシュに無くても、端末に永続化されたものが使える場合はそちらを使う。
    const remaining: string[] = [];
    for (const p of stillUncached) {
      const persisted = await readPersisted(bucket, p);
      if (persisted) {
        cache.set(cacheKey(bucket, p), persisted);
      } else {
        remaining.push(p);
      }
    }
    if (remaining.length === 0) return;

    const { data } = await supabase.storage.from(bucket).createSignedUrls(remaining, SIGNED_URL_TTL_SEC);
    if (!data) return;
    for (const item of data) {
      if (item.signedUrl && item.path) {
        const entry = { url: item.signedUrl, expiresAt: Date.now() + SIGNED_URL_TTL_SEC * 1000 - REFRESH_MARGIN_MS };
        cache.set(cacheKey(bucket, item.path), entry);
        persist(bucket, item.path, entry);
      }
    }
  })().catch(() => {
    // 一覧表示自体は各Avatar/Markの個別フェッチにフォールバックするので、
    // ここで失敗しても致命的ではない(先読みの最適化に過ぎない)。
  });
}

export function useSignedUrl(bucket: string, path: string | null): string | null {
  const key = path ? cacheKey(bucket, path) : null;
  const cachedEntry = key ? cache.get(key) : undefined;
  const cachedValid = isValid(cachedEntry) ? cachedEntry.url : null;

  // メモリキャッシュにまだ有効なURLがあれば、初回レンダリングから
  // それを使う(=空白のフレームを挟まない)。
  const [url, setUrl] = useState<string | null>(cachedValid);

  useEffect(() => {
    let cancelled = false;
    if (!path || !key) {
      setUrl(null);
      return;
    }
    const existing = cache.get(key);
    if (isValid(existing)) {
      setUrl(existing.url);
      return;
    }
    void (async () => {
      const persisted = await readPersisted(bucket, path);
      if (persisted) {
        cache.set(key, persisted);
        if (!cancelled) setUrl(persisted.url);
        return;
      }
      const { data } = await supabase.storage.from(bucket).createSignedUrl(path, SIGNED_URL_TTL_SEC);
      if (!data?.signedUrl) return;
      const entry = { url: data.signedUrl, expiresAt: Date.now() + SIGNED_URL_TTL_SEC * 1000 - REFRESH_MARGIN_MS };
      cache.set(key, entry);
      persist(bucket, path, entry);
      if (!cancelled) setUrl(data.signedUrl);
    })();
    return () => {
      cancelled = true;
    };
  }, [bucket, path, key]);

  return url;
}
