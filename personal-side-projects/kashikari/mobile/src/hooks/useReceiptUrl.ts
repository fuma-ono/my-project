import { useSignedUrl } from './useSignedUrl';

// receipts バケットは非公開(private)のため、表示のたびに署名付きURLを発行する。
// 実体はuseSignedUrl(汎用化済み)に委譲している。
export function useReceiptUrl(photoPath: string | null): string | null {
  return useSignedUrl('receipts', photoPath);
}
