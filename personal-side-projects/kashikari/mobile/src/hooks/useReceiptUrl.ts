import { useEffect, useState } from 'react';

import { supabase } from '../lib/supabase';

// receipts バケットは非公開(private)のため、表示のたびに署名付きURLを発行する。
export function useReceiptUrl(photoPath: string | null): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!photoPath) {
      setUrl(null);
      return;
    }
    supabase.storage
      .from('receipts')
      .createSignedUrl(photoPath, 60 * 60)
      .then(({ data }) => {
        if (!cancelled) setUrl(data?.signedUrl ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, [photoPath]);

  return url;
}
