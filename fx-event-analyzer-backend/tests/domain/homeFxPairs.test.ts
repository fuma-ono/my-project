import { describe, expect, it } from 'vitest';
import { DEFAULT_HOME_FX_PAIR_SYMBOLS, selectHomeFxPairs } from '../../src/domain/homeFxPairs.js';

const pair = (symbol: string) => ({ id: `id-${symbol}`, symbol });
// Deliberately not in symbol order — the DB query has no ORDER BY.
const ACTIVE = ['GBPJPY', 'EURJPY', 'AUDUSD', 'USDJPY', 'CADJPY', 'EURUSD', 'USDCHF', 'AUDJPY', 'GBPUSD'].map(pair);
const symbols = (pairs: { symbol: string }[]) => pairs.map((p) => p.symbol);

describe('selectHomeFxPairs (SCR-026)', () => {
  it('defaults to USDJPY, EURUSD, EURJPY', () => {
    expect(DEFAULT_HOME_FX_PAIR_SYMBOLS).toEqual(['USDJPY', 'EURUSD', 'EURJPY']);
    expect(symbols(selectHomeFxPairs(ACTIVE, null))).toEqual(['USDJPY', 'EURUSD', 'EURJPY']);
  });

  it('fills the default with other active pairs by symbol when a default pair is missing', () => {
    const withoutEurusd = ACTIVE.filter((p) => p.symbol !== 'EURUSD');
    expect(symbols(selectHomeFxPairs(withoutEurusd, null))).toEqual(['USDJPY', 'EURJPY', 'AUDJPY']);
    expect(symbols(selectHomeFxPairs([pair('GBPUSD'), pair('AUDUSD')], null))).toEqual(['AUDUSD', 'GBPUSD']);
    expect(selectHomeFxPairs([], null)).toEqual([]);
  });

  it('returns exactly the saved pairs in the saved order', () => {
    expect(selectHomeFxPairs(ACTIVE, ['GBPJPY', 'AUDUSD', 'USDJPY'])).toEqual([
      pair('GBPJPY'),
      pair('AUDUSD'),
      pair('USDJPY'),
    ]);
    expect(symbols(selectHomeFxPairs(ACTIVE, ['CADJPY']))).toEqual(['CADJPY']);
  });

  it('skips saved pairs that are no longer active, falling back to the default when none is left', () => {
    expect(symbols(selectHomeFxPairs(ACTIVE, ['XXXYYY', 'EURJPY']))).toEqual(['EURJPY']);
    expect(symbols(selectHomeFxPairs(ACTIVE, ['XXXYYY']))).toEqual(['USDJPY', 'EURUSD', 'EURJPY']);
    expect(symbols(selectHomeFxPairs(ACTIVE, []))).toEqual(['USDJPY', 'EURUSD', 'EURJPY']);
  });

  it('never returns more than 3 pairs', () => {
    expect(selectHomeFxPairs(ACTIVE, ['GBPJPY', 'AUDUSD', 'USDJPY', 'EURJPY'])).toHaveLength(3);
  });
});
