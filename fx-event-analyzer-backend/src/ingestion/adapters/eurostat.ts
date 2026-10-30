/**
 * Eurostat dissemination API (JSON-stat 2.0) — the official source of the euro-area
 * indicators (HQ承認 2026-10-30「ユーロ圏経済指標 第1弾」). No key, no registration:
 *   https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/{dataset}?{dimension=value…}&format=JSON
 *
 * - seriesId = "{dataset}?{dimension=value&…}" (mappings/indicators.ts EUROSTAT_SERIES). Every
 *   dimension except `time` must come back with exactly one value — a response with more (a typo
 *   in a dimension value, or a dimension Eurostat added) throws instead of picking one by guess.
 * - Returns the CURRENT values only: "The Eurostat database always contains the latest version of
 *   the datasets, meaning that there is no versioning" (API docs). supportsPointInTime = false.
 *   Which values are still "as published" is decided per indicator by the schedule path
 *   (mappings/eurostatSchedule.ts valueVintage), not here.
 * - Monthly periods only ('YYYY-MM'); other time codes are ignored.
 * - status "e" (estimated) / "p" (provisional) → PRELIMINARY. A period without a value is absent.
 *
 * Reuse conditions (https://ec.europa.eu/eurostat/web/main/help/copyright-notice, read 2026-10-30):
 * commercial reuse is authorised provided the source is acknowledged; modifications must be stated;
 * a disclaimer of Eurostat's non-responsibility must be included (domain/attribution.ts
 * EUROSTAT_ATTRIBUTION). Data for non-EU/EFTA countries are excepted — not used here.
 */
import { z } from 'zod';
import { PROVIDER_HTTP_SETTINGS } from '../config.js';
import { HttpClient, type HttpClientDeps } from '../http.js';
import type { ObservationQuery, OfficialStatsProvider } from '../providers.js';
import type { OfficialObservation, ReleaseStatus } from '../types.js';

export const EUROSTAT_API_BASE = 'https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/';

const categorySchema = z.object({
  index: z.union([z.record(z.string(), z.number()), z.array(z.string())]),
});

const jsonStatSchema = z.object({
  id: z.array(z.string()),
  size: z.array(z.number().int().nonnegative()),
  value: z.union([z.record(z.string(), z.number().nullable()), z.array(z.number().nullable())]),
  status: z.union([z.record(z.string(), z.string()), z.array(z.string().nullable())]).optional(),
  dimension: z.record(z.string(), z.object({ category: categorySchema })),
});

/** "{dataset}?{a=1&b=2}" → dataset and the dimension filters. */
export function parseEurostatSeriesId(seriesId: string): { dataset: string; filters: [string, string][] } {
  const [dataset, query = ''] = seriesId.split('?', 2) as [string, string | undefined];
  if (!/^[a-z0-9_]+$/i.test(dataset)) throw new Error(`Eurostat: invalid dataset in series "${seriesId}"`);
  const filters = [...new URLSearchParams(query).entries()];
  if (filters.length === 0) throw new Error(`Eurostat: series "${seriesId}" has no dimension filters`);
  return { dataset, filters };
}

export function eurostatUrl(seriesId: string, range: { start: string; end: string }): string {
  const { dataset, filters } = parseEurostatSeriesId(seriesId);
  const params = new URLSearchParams(filters);
  params.set('sinceTimePeriod', range.start.slice(0, 7));
  params.set('untilTimePeriod', range.end.slice(0, 7));
  params.set('format', 'JSON');
  params.set('lang', 'EN');
  return `${EUROSTAT_API_BASE}${dataset}?${params.toString()}`;
}

function orderedCodes(index: Record<string, number> | string[]): string[] {
  if (Array.isArray(index)) return index;
  return Object.entries(index)
    .sort((a, b) => a[1] - b[1])
    .map(([code]) => code);
}

function releaseStatusOf(status: string | null | undefined): ReleaseStatus {
  return status === 'e' || status === 'p' ? 'PRELIMINARY' : 'UNKNOWN';
}

/** One JSON-stat response for one series → monthly observations (sorted by period). */
export function parseEurostatResponse(body: unknown, seriesId: string, asOfDate: string): OfficialObservation[] {
  const data = jsonStatSchema.parse(body);
  if (data.id.length !== data.size.length) throw new Error(`Eurostat ${seriesId}: id/size length differ`);
  const timeAxis = data.id.indexOf('time');
  if (timeAxis === -1) throw new Error(`Eurostat ${seriesId}: no time dimension`);
  data.id.forEach((dimension, axis) => {
    if (axis !== timeAxis && data.size[axis] !== 1) {
      throw new Error(`Eurostat ${seriesId}: dimension "${dimension}" has ${data.size[axis]} values (expected 1)`);
    }
  });
  const timeCodes = orderedCodes(data.dimension.time!.category.index);
  // With every other dimension of size 1, the flat index of a cell is its position on the time axis.
  const valueAt = (i: number): number | null | undefined =>
    Array.isArray(data.value) ? data.value[i] : data.value[String(i)];
  const statusAt = (i: number): string | null | undefined =>
    data.status === undefined ? undefined : Array.isArray(data.status) ? data.status[i] : data.status[String(i)];

  const observations: OfficialObservation[] = [];
  timeCodes.forEach((code, i) => {
    const month = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(code);
    if (!month) return;
    const value = valueAt(i);
    if (value === undefined || value === null) return;
    if (!Number.isFinite(value)) throw new Error(`Eurostat ${seriesId}: unparseable value at ${code}`);
    observations.push({
      source: 'EUROSTAT',
      seriesId,
      periodStart: `${code}-01`,
      value,
      asOfDate,
      releaseStatus: releaseStatusOf(statusAt(i)),
    });
  });
  return observations.sort((a, b) => (a.periodStart < b.periodStart ? -1 : 1));
}

export class EurostatAdapter implements OfficialStatsProvider {
  readonly name = 'EUROSTAT' as const;
  readonly supportsPointInTime = false;
  private readonly http: HttpClient;
  private readonly today: () => string;

  constructor(deps: HttpClientDeps & { today?: () => string } = {}) {
    this.http = new HttpClient('eurostat', PROVIDER_HTTP_SETTINGS.eurostat, deps);
    this.today = deps.today ?? (() => new Date().toISOString().slice(0, 10));
  }

  async fetchObservations(query: ObservationQuery): Promise<OfficialObservation[]> {
    const body = await this.http.getJson(
      eurostatUrl(query.seriesId, { start: query.observationStart, end: query.observationEnd }),
    );
    return parseEurostatResponse(body, query.seriesId, this.today()).filter(
      (o) => o.periodStart >= query.observationStart && o.periodStart <= query.observationEnd,
    );
  }
}
