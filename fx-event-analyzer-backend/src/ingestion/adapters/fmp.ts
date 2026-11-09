/**
 * Financial Modeling Prep economic calendar — ① candidate (SKELETON from
 * the public docs https://site.financialmodelingprep.com/developer/docs/stable/economics-calendar;
 * not run against a real key — 要確認).
 *
 * GET /stable/economic-calendar?from&to&apikey
 * [{ date: "2026-10-14 12:30:00" (UTC — 要確認), country: "US", event,
 *   currency, previous, estimate, actual, change, impact, changePercentage, unit }]
 * No event id / reference period (same limitation as Finnhub).
 */
import { z } from 'zod';
import { PROVIDER_HTTP_SETTINGS } from '../config.js';
import { HttpClient, type HttpClientDeps } from '../http.js';
import { providerIndicatorKey } from '../mappings/indicators.js';
import type { EconomicCalendarProvider } from '../providers.js';
import { utcWallStringToIso } from '../time.js';
import type { DateRange, NormalizedCalendarRelease, ProviderValue } from '../types.js';
import { parseProviderValue } from '../values.js';

export const FMP_PROVIDER = 'fmp';

const schema = z.array(
  z
    .object({
      date: z.string(),
      country: z.string(),
      event: z.string(),
      previous: z.union([z.number(), z.string()]).nullable().optional(),
      estimate: z.union([z.number(), z.string()]).nullable().optional(),
      actual: z.union([z.number(), z.string()]).nullable().optional(),
      unit: z.string().nullable().optional(),
    })
    .passthrough(),
);

export function parseFmpCalendar(body: unknown, fetchedAt: string): NormalizedCalendarRelease[] {
  return schema.parse(body).map((row) => {
    const releaseAt = utcWallStringToIso(row.date);
    const id = `${row.country}|${row.event}|${row.date}`;
    if (!releaseAt) throw new Error(`fmp ${id}: unparseable date`);
    const unit = row.unit && row.unit.trim() !== '' ? row.unit.trim() : null;
    const value = (raw: unknown, field: string): ProviderValue | null => {
      const parsed = parseProviderValue(raw, unit);
      if (parsed === undefined) throw new Error(`fmp ${id}: unparseable ${field}`);
      return parsed;
    };
    return {
      provider: FMP_PROVIDER,
      providerEventId: id,
      providerIndicatorKey: providerIndicatorKey(row.country, row.event),
      eventName: row.event,
      releaseAt,
      releaseAtPrecision: 'EXACT',
      referencePeriod: null,
      actual: value(row.actual, 'actual'),
      forecast: value(row.estimate, 'estimate'),
      previous: value(row.previous, 'previous'),
      revisedPrevious: null,
      fetchedAt,
    };
  });
}

export class FmpAdapter implements EconomicCalendarProvider {
  readonly name = FMP_PROVIDER;
  private readonly http: HttpClient;

  constructor(
    private readonly apiKey: string,
    private readonly deps: HttpClientDeps = {},
  ) {
    this.http = new HttpClient(FMP_PROVIDER, PROVIDER_HTTP_SETTINGS.fmp, deps);
  }

  async fetchCalendar(range: DateRange): Promise<NormalizedCalendarRelease[]> {
    const url = new URL('https://financialmodelingprep.com/stable/economic-calendar');
    url.searchParams.set('from', range.from);
    url.searchParams.set('to', range.to);
    url.searchParams.set('apikey', this.apiKey);
    const fetchedAt = new Date((this.deps.now ?? Date.now)()).toISOString();
    return parseFmpCalendar(await this.http.getJson(url.toString()), fetchedAt);
  }
}
