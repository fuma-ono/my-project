/**
 * FRED / ALFRED (Federal Reserve Bank of St. Louis) — ② verification
 * source. API docs: https://fred.stlouisfed.org/docs/api/fred/
 *
 * - fred/series/observations with realtime_start = realtime_end = as-of
 *   date returns the values as they were known that day (point-in-time),
 *   so a first release is compared with the first release, not with a
 *   later revision.
 * - fred/release/dates (include_release_dates_with_no_data=true also
 *   returns scheduled future dates) — release-date cross-check.
 * - Missing observations are "." → value null.
 *
 * Terms (data-sources.md §2): API key required; the app must show
 * "This product uses the FRED® API but is not endorsed or certified by the
 * Federal Reserve Bank of St. Louis."; third-party series keep their own
 * copyright (the BLS/Census series used here are US-government works).
 */
import { z } from 'zod';
import { PROVIDER_HTTP_SETTINGS } from '../config.js';
import { HttpClient, type HttpClientDeps } from '../http.js';
import type { ObservationQuery, OfficialStatsProvider } from '../providers.js';
import type { OfficialObservation } from '../types.js';

const BASE_URL = 'https://api.stlouisfed.org/fred';

const observationsSchema = z.object({
  realtime_start: z.string(),
  realtime_end: z.string(),
  observations: z.array(
    z.object({
      realtime_start: z.string(),
      realtime_end: z.string(),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      value: z.string(),
    }),
  ),
});

const releaseDatesSchema = z.object({
  release_dates: z.array(z.object({ release_id: z.number().int(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })),
});

const seriesReleaseSchema = z.object({
  releases: z.array(z.object({ id: z.number().int(), name: z.string() })),
});

/** Parses a fred/series/observations JSON body. */
export function parseFredObservations(body: unknown, seriesId: string): OfficialObservation[] {
  const parsed = observationsSchema.parse(body);
  return parsed.observations.map((observation) => {
    const numeric = observation.value.trim() === '.' ? null : Number(observation.value);
    if (numeric !== null && !Number.isFinite(numeric)) {
      throw new Error(`FRED ${seriesId}: unparseable value "${observation.value}" for ${observation.date}`);
    }
    return {
      source: 'FRED',
      seriesId,
      periodStart: observation.date,
      value: numeric,
      // With realtime_start = realtime_end = D this is D ("as known on D").
      asOfDate: observation.realtime_end === '9999-12-31' ? parsed.realtime_end : observation.realtime_end,
      releaseStatus: 'UNKNOWN',
    };
  });
}

export function parseFredReleaseDates(body: unknown): string[] {
  return releaseDatesSchema.parse(body).release_dates.map((entry) => entry.date);
}

export class FredAdapter implements OfficialStatsProvider {
  readonly name = 'FRED' as const;
  readonly supportsPointInTime = true;
  private readonly http: HttpClient;

  constructor(
    private readonly apiKey: string,
    deps: HttpClientDeps = {},
  ) {
    this.http = new HttpClient('fred', PROVIDER_HTTP_SETTINGS.fred, deps);
  }

  private url(path: string, params: Record<string, string>): string {
    const url = new URL(`${BASE_URL}/${path}`);
    for (const [name, value] of Object.entries({ ...params, api_key: this.apiKey, file_type: 'json' })) {
      url.searchParams.set(name, value);
    }
    return url.toString();
  }

  async fetchObservations(query: ObservationQuery): Promise<OfficialObservation[]> {
    const params: Record<string, string> = {
      series_id: query.seriesId,
      observation_start: query.observationStart,
      observation_end: query.observationEnd,
    };
    if (query.asOfDate) {
      params.realtime_start = query.asOfDate;
      params.realtime_end = query.asOfDate;
    }
    return parseFredObservations(await this.http.getJson(this.url('series/observations', params)), query.seriesId);
  }

  /** Release dates ('YYYY-MM-DD', US Eastern calendar dates) in [from, to], including scheduled future ones. */
  async fetchReleaseDates(releaseId: number, from: string, to: string): Promise<string[]> {
    const body = await this.http.getJson(
      this.url('release/dates', {
        release_id: String(releaseId),
        realtime_start: from,
        realtime_end: '9999-12-31',
        include_release_dates_with_no_data: 'true',
        sort_order: 'asc',
      }),
    );
    return parseFredReleaseDates(body).filter((date) => date >= from && date <= to);
  }

  /** The release a series belongs to — used by eval:providers to re-check FRED_RELEASE_IDS. */
  async fetchSeriesRelease(seriesId: string): Promise<{ id: number; name: string } | null> {
    const body = await this.http.getJson(this.url('series/release', { series_id: seriesId }));
    return seriesReleaseSchema.parse(body).releases[0] ?? null;
  }
}
