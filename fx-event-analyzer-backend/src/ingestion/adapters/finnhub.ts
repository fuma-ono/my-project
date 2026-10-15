/**
 * Finnhub economic calendar — ① candidate (SKELETON from the public docs
 * https://finnhub.io/docs/api/economic-calendar; not run against a real
 * key — 要確認). Premium endpoint.
 *
 * GET /api/v1/calendar/economic?from&to&token
 * { economicCalendar: [{ actual, country: "US", estimate, event, impact,
 *   prev, time: "2026-10-14 12:30:00" (UTC — 要確認), unit }] }
 * No event id and no reference period are provided: the id is derived
 * from country + event + time, and the period is unknown (null), so these
 * rows can never pass verification on their own (REFERENCE_PERIOD_MISSING).
 */
import { z } from 'zod';
import { PROVIDER_HTTP_SETTINGS } from '../config.js';
import { HttpClient, type HttpClientDeps } from '../http.js';
import { providerIndicatorKey } from '../mappings/indicators.js';
import type { EconomicCalendarProvider } from '../providers.js';
import { utcWallStringToIso } from '../time.js';
import type { DateRange, NormalizedCalendarRelease, ProviderValue } from '../types.js';
import { parseProviderValue } from '../values.js';

export const FINNHUB_PROVIDER = 'finnhub';

const schema = z.object({
  economicCalendar: z.array(
    z
      .object({
        actual: z.union([z.number(), z.string()]).nullable().optional(),
        country: z.string(),
        estimate: z.union([z.number(), z.string()]).nullable().optional(),
        event: z.string(),
        prev: z.union([z.number(), z.string()]).nullable().optional(),
        time: z.string(),
        unit: z.string().nullable().optional(),
      })
      .passthrough(),
  ),
});

export function parseFinnhubCalendar(body: unknown, fetchedAt: string): NormalizedCalendarRelease[] {
  return schema.parse(body).economicCalendar.map((row) => {
    const releaseAt = utcWallStringToIso(row.time);
    const id = `${row.country}|${row.event}|${row.time}`;
    if (!releaseAt) throw new Error(`finnhub ${id}: unparseable time`);
    const unit = row.unit && row.unit.trim() !== '' ? row.unit.trim() : null;
    const value = (raw: unknown, field: string): ProviderValue | null => {
      const parsed = parseProviderValue(raw, unit);
      if (parsed === undefined) throw new Error(`finnhub ${id}: unparseable ${field}`);
      return parsed;
    };
    return {
      provider: FINNHUB_PROVIDER,
      providerEventId: id,
      providerIndicatorKey: providerIndicatorKey(row.country, row.event),
      eventName: row.event,
      releaseAt,
      releaseAtPrecision: 'EXACT',
      referencePeriod: null,
      actual: value(row.actual, 'actual'),
      forecast: value(row.estimate, 'estimate'),
      previous: value(row.prev, 'prev'),
      revisedPrevious: null,
      fetchedAt,
    };
  });
}

export class FinnhubAdapter implements EconomicCalendarProvider {
  readonly name = FINNHUB_PROVIDER;
  private readonly http: HttpClient;

  constructor(
    private readonly apiKey: string,
    private readonly deps: HttpClientDeps = {},
  ) {
    this.http = new HttpClient(FINNHUB_PROVIDER, PROVIDER_HTTP_SETTINGS.finnhub, deps);
  }

  async fetchCalendar(range: DateRange): Promise<NormalizedCalendarRelease[]> {
    const url = new URL('https://finnhub.io/api/v1/calendar/economic');
    url.searchParams.set('from', range.from);
    url.searchParams.set('to', range.to);
    url.searchParams.set('token', this.apiKey);
    const fetchedAt = new Date((this.deps.now ?? Date.now)()).toISOString();
    return parseFinnhubCalendar(await this.http.getJson(url.toString()), fetchedAt);
  }
}
