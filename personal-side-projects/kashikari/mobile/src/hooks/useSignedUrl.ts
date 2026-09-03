import { useEffect, useState } from 'react';

import { supabase } from '../lib/supabase';

// 非公開バケット(receipts・avatars)の中身を表示するための、汎用の
// 署名付きURL発行フック。useReceiptUrl.tsが元々receipts専用で持っていた
// ものを、avatars(アイコン写真)でも使えるよう汎用化した。
export function useSignedUrl(bucket: string, path: string | null): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!path) {
      setUrl(null);
      return;
    }
    supabase.storage
      .from(bucket)
      .createSignedUrl(path, 60 * 60)
      .then(({ data }) => {
        if (!cancelled) setUrl(data?.signedUrl ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, [bucket, path]);

  return url;
}
