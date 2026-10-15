/**
 * FX pair ↔ provider symbol mapping (CODE-REVIEWED CONFIG, data-sources.md
 * §3). `pipSize` / `pricePrecision` must equal fx_pairs.pip_size /
 * price_precision — the pipeline refuses a pair whose DB values differ
 * (pips are defined by the Backend, design.md §5.7, so a mismatch here
 * would silently change every pips number).
 */
export interface FxPairMapping {
  /** fx_pairs.symbol */
  symbol: string;
  pipSize: number;
  pricePrecision: number;
  providers: {
    twelvedata?: string;
    polygon?: string;
  };
}

export const FX_PAIR_MAPPINGS: readonly FxPairMapping[] = [
  { symbol: 'USDJPY', pipSize: 0.01, pricePrecision: 3, providers: { twelvedata: 'USD/JPY', polygon: 'C:USDJPY' } },
  { symbol: 'EURUSD', pipSize: 0.0001, pricePrecision: 5, providers: { twelvedata: 'EUR/USD', polygon: 'C:EURUSD' } },
  { symbol: 'EURJPY', pipSize: 0.01, pricePrecision: 3, providers: { twelvedata: 'EUR/JPY', polygon: 'C:EURJPY' } },
  { symbol: 'GBPUSD', pipSize: 0.0001, pricePrecision: 5, providers: { twelvedata: 'GBP/USD', polygon: 'C:GBPUSD' } },
  { symbol: 'GBPJPY', pipSize: 0.01, pricePrecision: 3, providers: { twelvedata: 'GBP/JPY', polygon: 'C:GBPJPY' } },
  { symbol: 'AUDUSD', pipSize: 0.0001, pricePrecision: 5, providers: { twelvedata: 'AUD/USD', polygon: 'C:AUDUSD' } },
  { symbol: 'AUDJPY', pipSize: 0.01, pricePrecision: 3, providers: { twelvedata: 'AUD/JPY', polygon: 'C:AUDJPY' } },
  { symbol: 'USDCHF', pipSize: 0.0001, pricePrecision: 5, providers: { twelvedata: 'USD/CHF', polygon: 'C:USDCHF' } },
  { symbol: 'CADJPY', pipSize: 0.01, pricePrecision: 3, providers: { twelvedata: 'CAD/JPY', polygon: 'C:CADJPY' } },
];

export function findFxPairMapping(symbol: string): FxPairMapping | undefined {
  return FX_PAIR_MAPPINGS.find((mapping) => mapping.symbol === symbol);
}

/** Price difference expressed in pips of the pair (no rounding). */
export function toPips(priceDifference: number, pipSize: number): number {
  return priceDifference / pipSize;
}
