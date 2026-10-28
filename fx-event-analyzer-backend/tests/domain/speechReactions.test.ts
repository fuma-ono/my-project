import { describe, expect, it } from 'vitest';
import type { MajorFxCandidatePair } from '../../src/domain/majorFxReactions.js';
import {
  computeSpeechPairReaction,
  pipSizeForSymbol,
  pipsByTimeframe,
  PRE_STATEMENT_LOOKBACK_MINUTES,
  selectPreStatementPrice,
  selectPriceAt,
  selectSpeechFxPairs,
  speechCandleRange,
  SPEECH_REACTION_TIMEFRAMES,
  SPEECH_SUMMARY_TIMEFRAMES,
  type PriceCandle,
} from '../../src/domain/speechReactions.js';

const pair = (symbol: string): MajorFxCandidatePair => ({
  fx_pair_id: `id-${symbol}`,
  symbol,
  base_currency: symbol.slice(0, 3),
  quote_currency: symbol.slice(3),
});
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
  'EURGBP',
  'EURAUD',
].map(pair);
const symbols = (pairs: { symbol: string }[]) => pairs.map((p) => p.symbol);

const STATEMENT = '2026-09-17T18:30:00Z';
const T = Date.parse(STATEMENT);
const MIN = 60_000;
const NOW = new Date('2026-10-15T00:00:00Z');

/** A 1m candle opening `offset` minutes after the statement (timestamp = open time). */
const candle = (offset: number, close: number, high = close, low = close): PriceCandle => ({
  timestamp: new Date(T + offset * MIN).toISOString(),
  high,
  low,
  close,
});

describe('pipSizeForSymbol', () => {
  it('is 0.01 for JPY-quoted pairs and 0.0001 otherwise', () => {
    expect(pipSizeForSymbol('USDJPY')).toBe(0.01);
    expect(pipSizeForSymbol('eurjpy')).toBe(0.01);
    expect(pipSizeForSymbol('EURUSD')).toBe(0.0001);
    expect(pipSizeForSymbol('EURGBP')).toBe(0.0001);
  });
});

describe('selectSpeechFxPairs', () => {
  it('USD → USDJPY, EURUSD, GBPUSD, AUDUSD', () => {
    expect(symbols(selectSpeechFxPairs(ACTIVE, 'USD'))).toEqual(['USDJPY', 'EURUSD', 'GBPUSD', 'AUDUSD']);
  });

  it('JPY → USDJPY, EURJPY, GBPJPY, AUDJPY', () => {
    expect(symbols(selectSpeechFxPairs(ACTIVE, 'JPY'))).toEqual(['USDJPY', 'EURJPY', 'GBPJPY', 'AUDJPY']);
  });

  it('EUR → EURUSD, EURJPY, EURGBP, then the rest by symbol', () => {
    expect(symbols(selectSpeechFxPairs(ACTIVE, 'EUR'))).toEqual(['EURUSD', 'EURJPY', 'EURGBP', 'EURAUD']);
  });

  it('only pairs containing the currency, at most 4; none → []', () => {
    expect(symbols(selectSpeechFxPairs(ACTIVE, 'GBP'))).toEqual(['GBPUSD', 'GBPJPY', 'EURGBP']);
    expect(selectSpeechFxPairs(ACTIVE, 'CHF')).toEqual([{ fx_pair_id: 'id-USDCHF', symbol: 'USDCHF' }]);
    expect(selectSpeechFxPairs(ACTIVE, 'SEK')).toEqual([]);
  });
});

describe('price selection', () => {
  it('speechCandleRange covers the lookback and the last candle closing at T + max', () => {
    expect(speechCandleRange(STATEMENT, 15)).toEqual({
      from: new Date(T - PRE_STATEMENT_LOOKBACK_MINUTES * MIN).toISOString(),
      to: new Date(T + 14 * MIN).toISOString(),
    });
  });

  it('pre-statement price = close of the last candle closing at or before T (the candle opened at T−1m)', () => {
    const candles = [candle(-3, 155.0), candle(-1, 155.2), candle(0, 155.5)];
    expect(selectPreStatementPrice(candles, STATEMENT)).toBe(155.2);
  });

  it('falls back to an earlier candle within the lookback, null beyond it', () => {
    expect(selectPreStatementPrice([candle(-5, 155.1), candle(0, 155.5)], STATEMENT)).toBe(155.1);
    expect(selectPreStatementPrice([candle(-16, 155.1), candle(0, 155.5)], STATEMENT)).toBeNull();
    expect(selectPreStatementPrice([], STATEMENT)).toBeNull();
  });

  it('price at T + N = close of the candle closing at T + N, null when that candle is missing', () => {
    const candles = [candle(0, 155.5), candle(4, 155.8)];
    expect(selectPriceAt(candles, T + MIN)).toBe(155.5);
    expect(selectPriceAt(candles, T + 5 * MIN)).toBe(155.8);
    expect(selectPriceAt(candles, T + 15 * MIN)).toBeNull();
  });
});

describe('computeSpeechPairReaction', () => {
  const candles = [
    candle(-1, 155.2),
    candle(0, 155.48, 155.5, 155.19),
    candle(1, 155.6, 155.62, 155.45),
    candle(2, 155.55),
    candle(3, 155.4),
    candle(4, 155.3, 155.35, 155.1),
    // nothing closing at T + 15m
  ];

  it('DELIVERED: pips from real closes (JPY ×100), max excursion over the window, missing → DATA_UNAVAILABLE', () => {
    const result = computeSpeechPairReaction({
      status: 'DELIVERED',
      statementDatetime: STATEMENT,
      symbol: 'USDJPY',
      candles,
      timeframes: SPEECH_SUMMARY_TIMEFRAMES,
      now: NOW,
    });
    expect(result.pre_release_price).toBe(155.2);
    expect(result.reactions[0]).toEqual({
      timeframe: '1m',
      post_release_price: 155.48,
      movement: 0.28,
      pips: 28,
      change_percent: 0.1804,
      max_upward: 0.3,
      max_downward: -0.01,
      max_upward_pips: 30,
      max_downward_pips: -1,
      analysis_status: 'READY',
    });
    expect(result.reactions[1]).toMatchObject({
      timeframe: '5m',
      post_release_price: 155.3,
      pips: 10,
      max_upward_pips: 42,
      max_downward_pips: -10,
      analysis_status: 'READY',
    });
    expect(result.reactions[2]).toMatchObject({
      timeframe: '15m',
      post_release_price: null,
      pips: null,
      max_upward_pips: null,
      analysis_status: 'DATA_UNAVAILABLE',
    });
    expect(pipsByTimeframe(result)).toEqual({ '1m': 28, '5m': 10, '15m': null });
  });

  it('non-JPY pairs use ×10000', () => {
    const result = computeSpeechPairReaction({
      status: 'DELIVERED',
      statementDatetime: STATEMENT,
      symbol: 'EURUSD',
      candles: [candle(-1, 1.0852), candle(0, 1.08477)],
      timeframes: ['1m'],
      now: NOW,
    });
    expect(result.reactions[0]).toMatchObject({ pips: -4.3, movement: -0.00043, analysis_status: 'READY' });
  });

  it('no pre-statement candle → every timeframe null / DATA_UNAVAILABLE', () => {
    const result = computeSpeechPairReaction({
      status: 'DELIVERED',
      statementDatetime: STATEMENT,
      symbol: 'USDJPY',
      candles: candles.slice(1),
      timeframes: SPEECH_SUMMARY_TIMEFRAMES,
      now: NOW,
    });
    expect(result.pre_release_price).toBeNull();
    expect(result.reactions.every((row) => row.pips === null && row.analysis_status === 'DATA_UNAVAILABLE')).toBe(true);
  });

  it('a timeframe ending after now is DATA_PENDING', () => {
    const result = computeSpeechPairReaction({
      status: 'DELIVERED',
      statementDatetime: STATEMENT,
      symbol: 'USDJPY',
      candles,
      timeframes: SPEECH_SUMMARY_TIMEFRAMES,
      now: new Date(T + 3 * MIN),
    });
    expect(result.reactions.map((row) => row.analysis_status)).toEqual(['READY', 'DATA_PENDING', 'DATA_PENDING']);
  });

  it('a publication-time-only speech (podcast, HQ判断 2026-10-28) → NOT_ANALYZABLE even when DELIVERED with candles', () => {
    const podcast = computeSpeechPairReaction({
      status: 'DELIVERED',
      timePrecision: 'PUBLICATION_TIME',
      statementDatetime: STATEMENT,
      symbol: 'USDJPY',
      candles,
      timeframes: SPEECH_REACTION_TIMEFRAMES,
      now: NOW,
    });
    expect(podcast.pre_release_price).toBeNull();
    expect(podcast.reactions.every((row) => row.pips === null && row.analysis_status === 'NOT_ANALYZABLE')).toBe(true);
    // EXACT(既定)は今までどおり計算する
    const exact = computeSpeechPairReaction({
      status: 'DELIVERED',
      timePrecision: 'EXACT',
      statementDatetime: STATEMENT,
      symbol: 'USDJPY',
      candles,
      timeframes: ['1m'],
      now: NOW,
    });
    expect(exact.reactions[0]!.analysis_status).not.toBe('NOT_ANALYZABLE');
  });

  it('SCHEDULED → all null / DATA_PENDING, CANCELLED → NOT_ANALYZABLE, even with candles', () => {
    const scheduled = computeSpeechPairReaction({
      status: 'SCHEDULED',
      statementDatetime: STATEMENT,
      symbol: 'USDJPY',
      candles,
      timeframes: SPEECH_REACTION_TIMEFRAMES,
      now: NOW,
    });
    expect(scheduled.pre_release_price).toBeNull();
    expect(scheduled.reactions).toHaveLength(5);
    expect(scheduled.reactions.every((row) => row.pips === null && row.analysis_status === 'DATA_PENDING')).toBe(true);

    const cancelled = computeSpeechPairReaction({
      status: 'CANCELLED',
      statementDatetime: STATEMENT,
      symbol: 'USDJPY',
      candles,
      timeframes: ['1m'],
      now: NOW,
    });
    expect(cancelled.reactions[0]).toMatchObject({ pips: null, analysis_status: 'NOT_ANALYZABLE' });
  });
});
