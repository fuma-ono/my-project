import { HOME_FX_PAIRS_MAX } from '../schemas/settings.js';

/** SCR-026 ホーム通貨ペア編集: 未設定 (home.fx_pairs = null) のときの表示順。 */
export const DEFAULT_HOME_FX_PAIR_SYMBOLS = ['USDJPY', 'EURUSD', 'EURJPY'] as const;

/**
 * Picks the pairs GET /home `major_fx` shows (api-design.md §12), at most
 * HOME_FX_PAIRS_MAX of them.
 *
 * - `saved` set: exactly those pairs, in the saved order. A saved symbol
 *   that is no longer active is skipped; if none is left, falls back to
 *   the default below so Home never shows an empty section.
 * - `saved` null: DEFAULT_HOME_FX_PAIR_SYMBOLS first (in that order), then
 *   any other active pair by symbol, so a DB missing one of the defaults
 *   still fills up to the limit in a stable order.
 */
export function selectHomeFxPairs<T extends { symbol: string }>(
  activePairs: readonly T[],
  saved: readonly string[] | null,
): T[] {
  const bySymbol = new Map(activePairs.map((pair) => [pair.symbol, pair]));

  if (saved && saved.length > 0) {
    const picked = saved.flatMap((symbol) => bySymbol.get(symbol) ?? []).slice(0, HOME_FX_PAIRS_MAX);
    if (picked.length > 0) return picked;
  }

  const defaults: readonly string[] = DEFAULT_HOME_FX_PAIR_SYMBOLS;
  const preferred = defaults.flatMap((symbol) => bySymbol.get(symbol) ?? []);
  const others = activePairs
    .filter((pair) => !defaults.includes(pair.symbol))
    .sort((a, b) => (a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0));
  return [...preferred, ...others].slice(0, HOME_FX_PAIRS_MAX);
}
