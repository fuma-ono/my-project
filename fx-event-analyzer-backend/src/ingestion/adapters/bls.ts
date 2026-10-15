/**
 * BLS Public Data API — ② second verification source for CPI / payrolls /
 * unemployment. Docs: https://www.bls.gov/developers/
 *
 * - v2 (BLS_API_KEY set, "registrationkey"): 500 queries/day, 50 series,
 *   20 years. v1 (no key): 25 queries/day, 25 series, 10 years.
 * - Returns CURRENT values only (no vintages): supportsPointInTime=false,
 *   so it is not used for as-of dates long after a release
 *   (officialStats.CURRENT_VINTAGE_MAX_AGE_DAYS).
 * - Footnote code "P" = preliminary.
 * - period "M01".."M12" = months; "M13" (annual average) is ignored.
 * - A month that was never published (e.g. October 2025 during the
 *   government shutdown) is simply absent — never filled.
 */
import { z } from 'zod';
import { PROVIDER_HTTP_SETTINGS } from '../config.js';
import { HttpClient, type HttpClientDeps } from '../http.js';
import type { ObservationQuery, OfficialStatsProvider } from '../providers.js';
import type { OfficialObservation, ReleaseStatus } from '../types.js';

const V1_URL = 'https://api.bls.gov/publicAPI/v1/timeseries/data/';
const V2_URL = 'https://api.bls.gov/publicAPI/v2/timeseries/data/';

const blsSchema = z.object({
  status: z.string(),
  message: z.array(z.string()).optional(),
  Results: z
    .object({
      series: z.array(
        z.object({
          seriesID: z.string(),
          data: z.array(
            z.object({
              year: z.string().regex(/^\d{4}$/),
              period: z.string(),
              value: z.string(),
              footnotes: z.array(z.object({ code: z.string().optional(), text: z.string().optional() })).optional(),
            }),
          ),
        }),
      ),
    })
    .optional(),
});

export function parseBlsResponse(body: unknown, asOfDate: string): OfficialObservation[] {
  const parsed = blsSchema.parse(body);
  if (parsed.status !== 'REQUEST_SUCCEEDED' || !parsed.Results) {
    throw new Error(`BLS: ${parsed.status} ${(parsed.message ?? []).join(' ')}`.trim());
  }
  const observations: OfficialObservation[] = [];
  for (const series of parsed.Results.series) {
    for (const point of series.data) {
      const month = /^M(0[1-9]|1[0-2])$/.exec(point.period);
      if (!month) continue;
      const value = point.value.trim() === '-' ? null : Number(point.value);
      if (value !== null && !Number.isFinite(value)) {
        throw new Error(`BLS ${series.seriesID}: unparseable value "${point.value}"`);
      }
      const preliminary = (point.footnotes ?? []).some((footnote) => footnote.code === 'P');
      const releaseStatus: ReleaseStatus = preliminary ? 'PRELIMINARY' : 'UNKNOWN';
      observations.push({
        source: 'BLS',
        seriesId: series.seriesID,
        periodStart: `${point.year}-${month[1]}-01`,
        value,
        asOfDate,
        releaseStatus,
      });
    }
  }
  return observations.sort((a, b) => (a.periodStart < b.periodStart ? -1 : 1));
}

export class BlsAdapter implements OfficialStatsProvider {
  readonly name = 'BLS' as const;
  readonly supportsPointInTime = false;
  private readonly http: HttpClient;

  constructor(
    private readonly apiKey: string | undefined,
    deps: HttpClientDeps & { today?: () => string } = {},
  ) {
    this.http = new HttpClient('bls', PROVIDER_HTTP_SETTINGS.bls, deps);
    this.today = deps.today ?? (() => new Date().toISOString().slice(0, 10));
  }

  private readonly today: () => string;

  async fetchObservations(query: ObservationQuery): Promise<OfficialObservation[]> {
    const payload: Record<string, unknown> = {
      seriesid: [query.seriesId],
      startyear: query.observationStart.slice(0, 4),
      endyear: query.observationEnd.slice(0, 4),
    };
    if (this.apiKey) payload.registrationkey = this.apiKey;
    const body = await this.http.getJson(this.apiKey ? V2_URL : V1_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return parseBlsResponse(body, this.today()).filter(
      (o) =>
        o.seriesId === query.seriesId &&
        o.periodStart >= query.observationStart &&
        o.periodStart <= query.observationEnd,
    );
  }
}
