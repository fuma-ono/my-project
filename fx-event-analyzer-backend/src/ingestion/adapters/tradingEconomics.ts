/**
 * Trading Economics economic calendar — ① candidate (SKELETON: written
 * from the public docs https://docs.tradingeconomics.com/economic_calendar/
 * and their sample response; not yet run against a real key — 要確認).
 *
 * GET /calendar/country/{countries}/{from}/{to}?c={key}&f=json
 * Row: { CalendarId, Date (UTC, no zone suffix), Country, Category, Event,
 *   Reference ("Sep"), ReferenceDate, Source, SourceURL, Actual ("3.7%"),
 *   Previous, Forecast (consensus), TEForecast (TE's own model — NEVER used
 *   as the forecast), Revised (revised previous), DateSpan, Importance, Unit … }
 */
import { z } from 'zod';
import { PROVIDER_HTTP_SETTINGS } from '../config.js';
import { HttpClient, type HttpClientDeps } from '../http.js';
import { providerIndicatorKey } from '../mappings/indicators.js';
import type { EconomicCalendarProvider } from '../providers.js';
import { utcWallStringToIso } from '../time.js';
import type { DateRange, NormalizedCalendarRelease, ProviderValue } from '../types.js';
import { parseProviderValue } from '../values.js';

export const TRADING_ECONOMICS_PROVIDER = 'tradingeconomics';

const rowSchema = z
  .object({
    CalendarId: z.union([z.string(), z.number()]),
    Date: z.string(),
    Country: z.string(),
    Event: z.string(),
    Reference: z.string().nullable().optional(),
    ReferenceDate: z.string().nullable().optional(),
    Actual: z.union([z.string(), z.number()]).nullable().optional(),
    Previous: z.union([z.string(), z.number()]).nullable().optional(),
    Forecast: z.union([z.string(), z.number()]).nullable().optional(),
    Revised: z.union([z.string(), z.number()]).nullable().optional(),
    DateSpan: z.union([z.string(), z.number()]).nullable().optional(),
    Unit: z.string().nullable().optional(),
  })
  .passthrough();

function value(raw: unknown, unit: string | null, id: string, field: string): ProviderValue | null {
  const parsed = parseProviderValue(raw, unit);
  if (parsed === undefined) throw new Error(`tradingeconomics ${id}: unparseable ${field} "${String(raw)}"`);
  return parsed;
}

export function parseTradingEconomicsCalendar(body: unknown, fetchedAt: string): NormalizedCalendarRelease[] {
  const rows = z.array(rowSchema).parse(body);
  return rows.map((row) => {
    const id = String(row.CalendarId);
    const releaseAt = utcWallStringToIso(row.Date.replace(/\.\d+$/, ''));
    if (!releaseAt) throw new Error(`tradingeconomics ${id}: unparseable Date "${row.Date}"`);
    const unit = row.Unit && row.Unit.trim() !== '' ? row.Unit.trim() : null;
    // DateSpan "0" = a specific time; anything else = the whole day (要確認 with real data).
    const exact = String(row.DateSpan ?? '0') === '0';
    const referenceDate = row.ReferenceDate ? (/^(\d{4}-\d{2})/.exec(row.ReferenceDate)?.[1] ?? null) : null;
    return {
      provider: TRADING_ECONOMICS_PROVIDER,
      providerEventId: id,
      providerIndicatorKey: providerIndicatorKey(row.Country, row.Event),
      eventName: row.Event,
      releaseAt,
      releaseAtPrecision: exact ? 'EXACT' : 'DATE_ONLY',
      referencePeriod: referenceDate,
      actual: value(row.Actual, unit, id, 'Actual'),
      forecast: value(row.Forecast, unit, id, 'Forecast'),
      previous: value(row.Previous, unit, id, 'Previous'),
      revisedPrevious: value(row.Revised, unit, id, 'Revised'),
      fetchedAt,
    };
  });
}

export class TradingEconomicsAdapter implements EconomicCalendarProvider {
  readonly name = TRADING_ECONOMICS_PROVIDER;
  private readonly http: HttpClient;

  constructor(
    private readonly apiKey: string,
    private readonly countries: readonly string[] = ['united states'],
    private readonly deps: HttpClientDeps = {},
  ) {
    this.http = new HttpClient(TRADING_ECONOMICS_PROVIDER, PROVIDER_HTTP_SETTINGS.tradingeconomics, deps);
  }

  async fetchCalendar(range: DateRange): Promise<NormalizedCalendarRelease[]> {
    const url = new URL(
      `https://api.tradingeconomics.com/calendar/country/${encodeURIComponent(this.countries.join(','))}/${range.from}/${range.to}`,
    );
    url.searchParams.set('c', this.apiKey);
    url.searchParams.set('f', 'json');
    const fetchedAt = new Date((this.deps.now ?? Date.now)()).toISOString();
    return parseTradingEconomicsCalendar(await this.http.getJson(url.toString()), fetchedAt);
  }
}
