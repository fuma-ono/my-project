// 割り勘の金額をN人に均等配分する。JPY/KRWのような小数を持たない通貨は
// 1円単位で、それ以外は1セント(0.01)単位で丸め、割り切れない端数は
// 参加者リストの先頭から順に1単位ずつ多く割り当てる(実務上よくある
// 「幹事が多めに払う」ではなく「並び順の先頭が多めに払う」方式だが、
// どちらにせよ合計は必ず元の金額と一致する)。
const ZERO_DECIMAL_CURRENCIES = new Set(['JPY', 'KRW']);

export function splitAmount(total: number, n: number, currency: string): number[] {
  if (n <= 0) return [];
  const decimals = ZERO_DECIMAL_CURRENCIES.has(currency) ? 0 : 2;
  const unit = 10 ** decimals;
  const totalUnits = Math.round(total * unit);
  const base = Math.floor(totalUnits / n);
  const remainder = totalUnits - base * n;
  return Array.from({ length: n }, (_, i) => (i < remainder ? base + 1 : base) / unit);
}
