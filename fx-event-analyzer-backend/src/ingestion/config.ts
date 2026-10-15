import { z } from 'zod';
import type { ProviderHttpSettings } from './http.js';

/**
 * Per-provider HTTP settings (rate limit / timeout / retry). Code-reviewed
 * config rather than env vars: a wrong value here can get a key banned.
 * Intervals are kept at or below each provider's documented free-tier
 * limit (data-sources.md §2 — paid-plan limits are 要確認 until signed).
 */
export const PROVIDER_HTTP_SETTINGS = {
  // FRED: 120 requests / minute per key.
  fred: { minIntervalMs: 600, timeoutMs: 15_000, maxRetries: 3, backoffMs: 1_000 },
  // BLS: v2 (with key) 500 queries/day, v1 (no key) 25 queries/day.
  bls: { minIntervalMs: 1_500, timeoutMs: 20_000, maxRetries: 2, backoffMs: 2_000 },
  // federalreserve.gov / ecb.europa.eu: public websites — be polite.
  frb: { minIntervalMs: 2_000, timeoutMs: 20_000, maxRetries: 2, backoffMs: 2_000 },
  ecb: { minIntervalMs: 2_000, timeoutMs: 20_000, maxRetries: 2, backoffMs: 2_000 },
  // Paid candidates (limits depend on plan — 要確認).
  tradingeconomics: { minIntervalMs: 1_000, timeoutMs: 20_000, maxRetries: 3, backoffMs: 1_000 },
  finnhub: { minIntervalMs: 1_100, timeoutMs: 15_000, maxRetries: 3, backoffMs: 1_000 },
  fmp: { minIntervalMs: 300, timeoutMs: 15_000, maxRetries: 3, backoffMs: 1_000 },
  // Twelve Data free: 8 requests / minute.
  twelvedata: { minIntervalMs: 8_000, timeoutMs: 20_000, maxRetries: 3, backoffMs: 2_000 },
  // Polygon (Massive) free: 5 requests / minute.
  polygon: { minIntervalMs: 12_500, timeoutMs: 20_000, maxRetries: 3, backoffMs: 2_000 },
} as const satisfies Record<string, ProviderHttpSettings>;

export type ProviderId = keyof typeof PROVIDER_HTTP_SETTINGS;

/** Accuracy thresholds that are not per indicator (per-indicator ones live in mappings/indicators.ts). */
export const INGESTION_SETTINGS = {
  /** A ③ vs ⑤ minute whose close differs by more than this many pips is UNVERIFIED. */
  fxCrossCheckMaxDiffPips: 3,
  /** A minute whose close jumps more than this many pips from the previous minute is UNVERIFIED (still stored, never filled). */
  fxMaxJumpPips: 500,
  /** An actual whose release instant is more than this far in the future at fetch time is rejected (FUTURE_DATED_ACTUAL). */
  futureActualToleranceMs: 60_000,
  /** ingest:official fetches this many months of observations back from today. */
  officialLookbackMonths: 15,
} as const;

function optionalKey() {
  return z.preprocess((value) => (value === '' ? undefined : value), z.string().min(1).optional());
}

/**
 * Provider API keys — all optional. A job only uses the providers whose
 * key is set; nothing here is ever logged. Names are listed in
 * .env.example; values go in .env (never committed).
 */
const ingestionEnvSchema = z.object({
  FRED_API_KEY: optionalKey(),
  BLS_API_KEY: optionalKey(),
  TRADING_ECONOMICS_API_KEY: optionalKey(),
  FINNHUB_API_KEY: optionalKey(),
  FMP_API_KEY: optionalKey(),
  TWELVE_DATA_API_KEY: optionalKey(),
  POLYGON_API_KEY: optionalKey(),
});

export type IngestionEnv = z.infer<typeof ingestionEnvSchema>;

export function loadIngestionEnv(source: NodeJS.ProcessEnv = process.env): IngestionEnv {
  return ingestionEnvSchema.parse(source);
}
