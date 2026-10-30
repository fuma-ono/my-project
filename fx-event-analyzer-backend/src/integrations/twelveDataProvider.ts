/**
 * Twelve Data Adapter — Provider Abstraction方針(design.md §4.3、HQ決定
 * 2026-09-18)の`FXPriceDataProvider`。Ingestion WorkerはこのAdapter経由でのみ
 * 外部APIを呼び、Provider固有のレスポンス形式(文字列の数値・`/`区切りの
 * symbol等)をDomain層に持ち込まない。
 *
 * HQ指示(2026-10-15)「無料枠で実機の内部確認用に繋ぐ」: Twelve Dataは
 * design.md §7.3の代替候補(個人向けプランは商用の表示・再配布不可)。
 * ここで繋ぐのは社内の開発ビルド確認専用で、一般ユーザー向けの本番配信には
 * 使わない(無料・個人向けAPIを本番にそのまま使うことは要件定義書6.4節で
 * 禁止)。契約済みのProviderに差し替える際は、この1ファイルを新しい
 * Adapterに入れ替えるだけで済むよう、`FXPriceDataProvider`インターフェース
 * 以外には依存させていない。
 */

import type { Timeframe } from '../domain/dataQuality.js';

export interface FxCandle {
  /** 足の開始時刻(db-design.md §3.11、fx_prices.timestampと同じ規約)。 */
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
}

export interface FetchCandlesParams {
  /** DBのfx_pairs.symbol形式(例: "USDJPY"、"/"なし)。 */
  symbol: string;
  timeframe: Timeframe;
  /** この件数ぶん、最新から遡って取得する(Twelve Dataのoutputsize)。 */
  outputsize: number;
}

export interface FXPriceDataProvider {
  readonly name: string;
  fetchCandles(params: FetchCandlesParams): Promise<FxCandle[]>;
}

export class TwelveDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TwelveDataError';
  }
}

export interface TwelveDataConfig {
  apiKey?: string | undefined;
  /** Injectable for tests; defaults to the global fetch. */
  fetch?: typeof fetch | undefined;
}

const API_BASE_URL = 'https://api.twelvedata.com';
const REQUEST_TIMEOUT_MS = 10_000;

/** db-design.mdのtimeframe値 → Twelve Dataのinterval値。 */
const INTERVAL_BY_TIMEFRAME: Readonly<Record<Timeframe, string>> = {
  '1m': '1min',
  '5m': '5min',
  '15m': '15min',
  '30m': '30min',
  '60m': '1h',
};

/** "USDJPY" → "USD/JPY"(Twelve Dataのsymbol形式)。3文字通貨ペアのみ対応。 */
export function toTwelveDataSymbol(symbol: string): string {
  if (!/^[A-Z]{6}$/.test(symbol)) {
    throw new TwelveDataError(`Unsupported fx_pairs.symbol for Twelve Data: ${symbol}`);
  }
  return `${symbol.slice(0, 3)}/${symbol.slice(3)}`;
}

interface TwelveDataValue {
  datetime?: unknown;
  open?: unknown;
  high?: unknown;
  low?: unknown;
  close?: unknown;
  volume?: unknown;
}

interface TwelveDataTimeSeriesResponse {
  status?: unknown;
  message?: unknown;
  values?: unknown;
}

function parseNumeric(value: unknown, field: string): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(parsed)) {
    throw new TwelveDataError(`Twelve Data response has a non-numeric ${field}: ${JSON.stringify(value)}`);
  }
  return parsed;
}

function parseCandle(value: TwelveDataValue): FxCandle {
  if (typeof value.datetime !== 'string') {
    throw new TwelveDataError(`Twelve Data response is missing datetime: ${JSON.stringify(value)}`);
  }
  // timezone=UTCで要求しているので、'YYYY-MM-DD HH:mm:ss'をUTCとして解釈する。
  const timestamp = new Date(`${value.datetime.replace(' ', 'T')}Z`);
  if (Number.isNaN(timestamp.getTime())) {
    throw new TwelveDataError(`Twelve Data response has an unparseable datetime: ${value.datetime}`);
  }
  return {
    timestamp,
    open: parseNumeric(value.open, 'open'),
    high: parseNumeric(value.high, 'high'),
    low: parseNumeric(value.low, 'low'),
    close: parseNumeric(value.close, 'close'),
    volume: value.volume === undefined || value.volume === null ? null : parseNumeric(value.volume, 'volume'),
  };
}

/** `outputsize`件・1足ぶんの時系列を、古い順に並べて返す。未設定なら空配列。 */
export async function fetchTwelveDataCandles(
  params: FetchCandlesParams,
  config: TwelveDataConfig,
): Promise<FxCandle[]> {
  const { apiKey } = config;
  if (!apiKey) return [];

  const fetchImpl = config.fetch ?? fetch;
  const url = new URL(`${API_BASE_URL}/time_series`);
  url.searchParams.set('symbol', toTwelveDataSymbol(params.symbol));
  url.searchParams.set('interval', INTERVAL_BY_TIMEFRAME[params.timeframe]);
  url.searchParams.set('outputsize', String(params.outputsize));
  url.searchParams.set('timezone', 'UTC');
  url.searchParams.set('apikey', apiKey);

  const response = await fetchImpl(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!response.ok) {
    throw new TwelveDataError(`Twelve Data request failed with HTTP ${response.status}`);
  }

  const body = (await response.json()) as TwelveDataTimeSeriesResponse;
  if (body.status === 'error') {
    throw new TwelveDataError(`Twelve Data error: ${typeof body.message === 'string' ? body.message : 'unknown'}`);
  }
  if (!Array.isArray(body.values)) {
    throw new TwelveDataError(`Twelve Data response is missing values: ${JSON.stringify(body)}`);
  }

  return body.values
    .map((value) => parseCandle(value as TwelveDataValue))
    .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
}

export function createTwelveDataProvider(config: TwelveDataConfig): FXPriceDataProvider {
  return {
    name: 'twelvedata',
    fetchCandles: (params) => fetchTwelveDataCandles(params, config),
  };
}
