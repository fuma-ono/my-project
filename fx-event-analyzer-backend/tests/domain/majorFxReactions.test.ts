import { describe, expect, it } from 'vitest';
import {
  buildMajorFxReactions,
  MAJOR_FX_REACTIONS_MAX,
  selectMajorFxPairs,
  type MajorFxCandidatePair,
} from '../../src/domain/majorFxReactions.js';

const pair = (symbol: string): MajorFxCandidatePair => ({
  fx_pair_id: `id-${symbol}`,
  symbol,
  base_currency: symbol.slice(0, 3),
  quote_currency: symbol.slice(3),
});
// Same set as supabase/seed.sql plus USDCAD/NZDUSD, deliberately unordered.
const ACTIVE = [
  'GBPJPY',
  'EURJPY',
  'NZDUSD',
  'AUDUSD',
  'USDJPY',
  'CADJPY',
  'EURUSD',
  'USDCHF',
  'AUDJPY',
  'GBPUSD',
  'USDCAD',
].map(pair);
const related = (...symbols: string[]) =>
  symbols.map((symbol, index) => ({ fx_pair_id: `id-${symbol}`, symbol, priority: index + 1 }));
const symbols = (pairs: { symbol: string }[]) => pairs.map((p) => p.symbol);

describe('selectMajorFxPairs (SCR-007 主要通貨ペアの値動き)', () => {
  it('puts related pairs first, then the fixed major order, capped at 4 (US CPI)', () => {
    expect(MAJOR_FX_REACTIONS_MAX).toBe(4);
    expect(symbols(selectMajorFxPairs(ACTIVE, related('USDJPY', 'EURUSD'), 'USD'))).toEqual([
      'USDJPY',
      'EURUSD',
      'GBPUSD',
      'AUDUSD',
    ]);
  });

  it('orders related pairs by priority, not by input order', () => {
    const shuffled = [
      { fx_pair_id: 'id-EURUSD', symbol: 'EURUSD', priority: 2 },
      { fx_pair_id: 'id-USDCHF', symbol: 'USDCHF', priority: 1 },
    ];
    expect(symbols(selectMajorFxPairs(ACTIVE, shuffled, 'USD'))).toEqual(['USDCHF', 'EURUSD', 'USDJPY', 'GBPUSD']);
  });

  it('uses the major order with no related pairs, and symbol order for pairs outside it', () => {
    expect(symbols(selectMajorFxPairs(ACTIVE, [], 'JPY'))).toEqual(['USDJPY', 'EURJPY', 'GBPJPY', 'AUDJPY']);
    expect(symbols(selectMajorFxPairs(ACTIVE, [], 'NZD'))).toEqual(['NZDUSD']);
    const unknown = [pair('NZDJPY'), pair('CHFJPY'), pair('CADJPY')];
    expect(symbols(selectMajorFxPairs(unknown, [], 'JPY'))).toEqual(['CADJPY', 'CHFJPY', 'NZDJPY']);
  });

  it('matches the event currency on either side of the pair', () => {
    expect(symbols(selectMajorFxPairs(ACTIVE, [], 'CHF'))).toEqual(['USDCHF']);
    expect(symbols(selectMajorFxPairs(ACTIVE, [], 'CAD'))).toEqual(['USDCAD', 'CADJPY']);
  });

  it('skips related pairs that do not contain the event currency (or are inactive)', () => {
    const relatedWithForeign = related('EURJPY', 'USDJPY');
    expect(symbols(selectMajorFxPairs(ACTIVE, relatedWithForeign, 'USD'))).toEqual([
      'USDJPY',
      'EURUSD',
      'GBPUSD',
      'AUDUSD',
    ]);
    const withoutUsdJpy = ACTIVE.filter((p) => p.symbol !== 'USDJPY');
    expect(symbols(selectMajorFxPairs(withoutUsdJpy, related('USDJPY', 'EURUSD'), 'USD'))).toEqual([
      'EURUSD',
      'GBPUSD',
      'AUDUSD',
      'USDCHF',
    ]);
  });

  it('falls back to the related pairs when no active pair contains the event currency', () => {
    expect(selectMajorFxPairs(ACTIVE, related('USDJPY', 'EURUSD'), 'CNY')).toEqual([
      { fx_pair_id: 'id-USDJPY', symbol: 'USDJPY' },
      { fx_pair_id: 'id-EURUSD', symbol: 'EURUSD' },
    ]);
    expect(selectMajorFxPairs(ACTIVE, related('A', 'B', 'C', 'D', 'E'), 'CNY')).toHaveLength(4);
    expect(selectMajorFxPairs(ACTIVE, [], 'CNY')).toEqual([]);
    expect(selectMajorFxPairs([], [], 'USD')).toEqual([]);
  });

  it('returns only fx_pair_id and symbol', () => {
    expect(selectMajorFxPairs([pair('USDJPY')], [], 'USD')).toEqual([{ fx_pair_id: 'id-USDJPY', symbol: 'USDJPY' }]);
  });
});

describe('buildMajorFxReactions', () => {
  const pairs = [
    { fx_pair_id: 'id-USDJPY', symbol: 'USDJPY' },
    { fx_pair_id: 'id-EURUSD', symbol: 'EURUSD' },
  ];
  const row = (
    fxPairId: string,
    timeframe: string,
    pips: number | null,
    changePercent: number | null,
    status: string,
  ) => ({
    fx_pair_id: fxPairId,
    timeframe,
    pips,
    change_percent: changePercent,
    data_status: status,
  });

  it('maps stored rows to 1m/5m/15m per pair, in pair order', () => {
    const rows = [
      row('id-USDJPY', '15m', -41.3, -0.2775, 'AVAILABLE'),
      row('id-USDJPY', '1m', -8.2, -0.0551, 'AVAILABLE'),
      row('id-USDJPY', '5m', -24.5, -0.1646, 'AVAILABLE'),
      row('id-EURUSD', '5m', null, null, 'UNAVAILABLE'),
    ];
    expect(buildMajorFxReactions(pairs, rows, 'EXACT')).toEqual([
      {
        fx_pair_id: 'id-USDJPY',
        symbol: 'USDJPY',
        reactions: [
          { timeframe: '1m', pips: -8.2, change_percent: -0.0551, analysis_status: 'READY' },
          { timeframe: '5m', pips: -24.5, change_percent: -0.1646, analysis_status: 'READY' },
          { timeframe: '15m', pips: -41.3, change_percent: -0.2775, analysis_status: 'READY' },
        ],
      },
      {
        fx_pair_id: 'id-EURUSD',
        symbol: 'EURUSD',
        reactions: [
          { timeframe: '1m', pips: null, change_percent: null, analysis_status: 'DATA_PENDING' },
          { timeframe: '5m', pips: null, change_percent: null, analysis_status: 'DATA_UNAVAILABLE' },
          { timeframe: '15m', pips: null, change_percent: null, analysis_status: 'DATA_PENDING' },
        ],
      },
    ]);
  });

  it('reports DATA_PENDING with null values before release (no rows)', () => {
    const [usdjpy] = buildMajorFxReactions(pairs, [], 'EXACT');
    expect(usdjpy!.reactions.map((r) => [r.pips, r.change_percent, r.analysis_status])).toEqual([
      [null, null, 'DATA_PENDING'],
      [null, null, 'DATA_PENDING'],
      [null, null, 'DATA_PENDING'],
    ]);
  });

  it('marks timeframes excluded by release_datetime_precision NOT_ANALYZABLE even with a stored row', () => {
    const rows = [row('id-USDJPY', '1m', 5, 0.03, 'AVAILABLE'), row('id-USDJPY', '15m', 9, 0.06, 'AVAILABLE')];
    const [approx] = buildMajorFxReactions(pairs, rows, 'APPROXIMATE');
    expect(approx!.reactions.map((r) => r.analysis_status)).toEqual(['NOT_ANALYZABLE', 'DATA_PENDING', 'READY']);
    const [dateOnly] = buildMajorFxReactions(pairs, rows, 'DATE_ONLY');
    expect(dateOnly!.reactions.map((r) => r.analysis_status)).toEqual(['NOT_ANALYZABLE', 'NOT_ANALYZABLE', 'READY']);
  });

  it('returns [] for no pairs', () => {
    expect(buildMajorFxReactions([], [], 'EXACT')).toEqual([]);
  });
});
