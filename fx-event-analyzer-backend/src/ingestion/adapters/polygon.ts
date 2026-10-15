/**
 * Polygon.io (now Massive) forex aggregates — ③/⑤ candidate (SKELETON
 * from the public docs https://polygon.io/docs/rest/forex/aggregates/custom-bars;
 * not run against a real key — 要確認).
 *
 * GET /v2/aggs/ticker/C:USDJPY/range/1/minute/{fromMs}/{toMs}?adjusted=true&sort=asc&limit=50000&apiKey
 * { status: "OK", results: [{ t (ms, window START), o, h, l, c, v, vw, n }], resultsCount, next_url? }
 * Minutes without trades are absent (never filled).
 */
import { z } from 'zod';
import { PROVIDER_HTTP_SETTINGS } from '../config.js';
import { HttpClient, type HttpClientDeps } from '../http.js';
import { findFxPairMapping } from '../mappings/fxPairs.js';
import type { FxPriceProvider } from '../providers.js';
import type { InstantRange, NormalizedCandle } from '../types.js';

export const POLYGON_PROVIDER = 'polygon';

const schema = z.object({
  status: z.string(),
  results: z
    .array(
      z.object({
        t: z.number().int(),
        o: z.number(),
        h: z.number(),
        l: z.number(),
        c: z.number(),
        v: z.number().optional(),
      }),
    )
    .optional(),
  next_url: z.string().optional(),
  error: z.string().optional(),
});

export function parsePolygonAggregates(
  body: unknown,
  symbol: string,
): { candles: NormalizedCandle[]; nextUrl: string | null } {
  const parsed = schema.parse(body);
  if (parsed.status !== 'OK' && parsed.status !== 'DELAYED') {
    throw new Error(`polygon ${symbol}: ${parsed.status} ${parsed.error ?? ''}`.trim());
  }
  return {
    candles: (parsed.results ?? []).map((bar) => ({
      provider: POLYGON_PROVIDER,
      symbol,
      openTime: new Date(bar.t).toISOString(),
      open: bar.o,
      high: bar.h,
      low: bar.l,
      close: bar.c,
      volume: bar.v ?? null,
    })),
    nextUrl: parsed.next_url ?? null,
  };
}

export class PolygonAdapter implements FxPriceProvider {
  readonly name = POLYGON_PROVIDER;
  private readonly http: HttpClient;

  constructor(
    private readonly apiKey: string,
    deps: HttpClientDeps = {},
    private readonly baseUrl = 'https://api.polygon.io',
  ) {
    this.http = new HttpClient(POLYGON_PROVIDER, PROVIDER_HTTP_SETTINGS.polygon, deps);
  }

  async fetchOneMinuteCandles(symbol: string, range: InstantRange): Promise<NormalizedCandle[]> {
    const ticker = findFxPairMapping(symbol)?.providers.polygon;
    if (!ticker) throw new Error(`polygon: no symbol mapping for ${symbol}`);
    const from = Date.parse(range.from);
    const to = Date.parse(range.to);
    let url: string | null =
      `${this.baseUrl}/v2/aggs/ticker/${encodeURIComponent(ticker)}/range/1/minute/${from}/${to - 1}?adjusted=true&sort=asc&limit=50000`;
    const candles: NormalizedCandle[] = [];
    for (let page = 0; url && page < 20; page += 1) {
      const withKey = new URL(url);
      withKey.searchParams.set('apiKey', this.apiKey);
      const result = parsePolygonAggregates(await this.http.getJson(withKey.toString()), symbol);
      candles.push(...result.candles);
      url = result.nextUrl;
    }
    return candles.filter((c) => Date.parse(c.openTime) >= from && Date.parse(c.openTime) < to);
  }
}
