/**
 * Twelve Data FX 1-minute candles — ③ candidate.
 * Docs: https://twelvedata.com/docs#time-series
 *
 * GET /time_series?symbol=USD/JPY&interval=1min&timezone=UTC&start_date&end_date&order=ASC&outputsize=5000&apikey
 * { meta: {...}, values: [{ datetime: "2026-10-15 08:30:00", open, high, low, close }], status: "ok" }
 * Recorded with the public "demo" key on 2026-10-15: without timezone=UTC
 * the same candle came back as "2026-10-15 19:30:00" (exchange time zone,
 * UTC+11 — Australia/Sydney), so timezone=UTC is ALWAYS sent. datetime is
 * the candle's open time. The newest candle can still be forming — the
 * pipeline drops candles whose minute has not fully passed.
 * Errors come back as HTTP 200 { status: "error", code, message }.
 * Commercial display/redistribution needs a business plan + data license (要確認).
 */
import { z } from 'zod';
import { PROVIDER_HTTP_SETTINGS } from '../config.js';
import { HttpClient, type HttpClientDeps } from '../http.js';
import { findFxPairMapping } from '../mappings/fxPairs.js';
import type { FxPriceProvider } from '../providers.js';
import { utcWallStringToIso } from '../time.js';
import type { InstantRange, NormalizedCandle } from '../types.js';

export const TWELVE_DATA_PROVIDER = 'twelvedata';

const numeric = z.union([z.string(), z.number()]).transform((value, ctx) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    ctx.addIssue({ code: 'custom', message: `not a number: ${String(value)}` });
    return z.NEVER;
  }
  return parsed;
});

const okSchema = z.object({
  status: z.literal('ok'),
  values: z.array(
    z.object({
      datetime: z.string(),
      open: numeric,
      high: numeric,
      low: numeric,
      close: numeric,
      volume: numeric.optional(),
    }),
  ),
});
const errorSchema = z.object({
  status: z.literal('error'),
  code: z.number().optional(),
  message: z.string().optional(),
});

export function parseTwelveDataSeries(body: unknown, symbol: string): NormalizedCandle[] {
  const error = errorSchema.safeParse(body);
  if (error.success)
    throw new Error(`twelvedata ${symbol}: ${error.data.code ?? ''} ${error.data.message ?? ''}`.trim());
  return okSchema.parse(body).values.map((value) => {
    const openTime = utcWallStringToIso(value.datetime);
    if (!openTime) throw new Error(`twelvedata ${symbol}: unparseable datetime "${value.datetime}"`);
    return {
      provider: TWELVE_DATA_PROVIDER,
      symbol,
      openTime,
      open: value.open,
      high: value.high,
      low: value.low,
      close: value.close,
      volume: value.volume ?? null,
    };
  });
}

function wall(iso: string): string {
  return iso.slice(0, 19).replace('T', ' ');
}

export class TwelveDataAdapter implements FxPriceProvider {
  readonly name = TWELVE_DATA_PROVIDER;
  private readonly http: HttpClient;

  constructor(
    private readonly apiKey: string,
    deps: HttpClientDeps = {},
  ) {
    this.http = new HttpClient(TWELVE_DATA_PROVIDER, PROVIDER_HTTP_SETTINGS.twelvedata, deps);
  }

  async fetchOneMinuteCandles(symbol: string, range: InstantRange): Promise<NormalizedCandle[]> {
    const providerSymbol = findFxPairMapping(symbol)?.providers.twelvedata;
    if (!providerSymbol) throw new Error(`twelvedata: no symbol mapping for ${symbol}`);
    const url = new URL('https://api.twelvedata.com/time_series');
    url.searchParams.set('symbol', providerSymbol);
    url.searchParams.set('interval', '1min');
    url.searchParams.set('timezone', 'UTC');
    url.searchParams.set('start_date', wall(range.from));
    // end_date is inclusive at Twelve Data; ask up to the last minute before `to`.
    url.searchParams.set('end_date', wall(new Date(Date.parse(range.to) - 60_000).toISOString()));
    url.searchParams.set('order', 'ASC');
    url.searchParams.set('outputsize', '5000');
    url.searchParams.set('apikey', this.apiKey);
    const candles = parseTwelveDataSeries(await this.http.getJson(url.toString()), symbol);
    const from = Date.parse(range.from);
    const to = Date.parse(range.to);
    return candles.filter((c) => Date.parse(c.openTime) >= from && Date.parse(c.openTime) < to);
  }
}
