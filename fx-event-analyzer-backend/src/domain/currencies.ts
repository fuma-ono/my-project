/**
 * Static Code -> Name mapping (api-design.md §23.1, A-5). No `currencies`
 * DB table — deliberately not reintroduced. Covers the MVP FX pair set
 * (requirements.md §7).
 */
export const CURRENCY_NAMES: Record<string, string> = {
  USD: 'US Dollar',
  EUR: 'Euro',
  JPY: 'Japanese Yen',
  GBP: 'British Pound',
  AUD: 'Australian Dollar',
  NZD: 'New Zealand Dollar',
  CHF: 'Swiss Franc',
  CAD: 'Canadian Dollar',
};

export interface CurrencySearchResult {
  code: string;
  name: string;
}

export function searchCurrencies(query: string): CurrencySearchResult[] {
  const needle = query.toLowerCase();
  return Object.entries(CURRENCY_NAMES)
    .filter(([code, name]) => code.toLowerCase().includes(needle) || name.toLowerCase().includes(needle))
    .map(([code, name]) => ({ code, name }));
}
