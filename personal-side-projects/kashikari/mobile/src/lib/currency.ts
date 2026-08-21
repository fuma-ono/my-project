export const CURRENCIES = [
  { code: 'JPY', label: '¥ JPY' },
  { code: 'USD', label: '$ USD' },
  { code: 'EUR', label: '€ EUR' },
  { code: 'GBP', label: '£ GBP' },
  { code: 'KRW', label: '₩ KRW' },
  { code: 'CNY', label: '¥ CNY' },
  { code: 'TWD', label: 'NT$ TWD' },
  { code: 'THB', label: '฿ THB' },
  { code: 'AUD', label: 'A$ AUD' },
] as const;

export type CurrencyCode = (typeof CURRENCIES)[number]['code'];

export function formatMoney(amount: number, code: string | null | undefined): string {
  const c = code || 'JPY';
  let formatted: string;
  try {
    formatted = new Intl.NumberFormat(undefined, { style: 'currency', currency: c }).format(amount);
  } catch {
    formatted = `¥${Math.round(amount).toLocaleString('ja-JP')}`;
  }
  return c === 'JPY' ? formatted : `${formatted} ${c}`;
}
