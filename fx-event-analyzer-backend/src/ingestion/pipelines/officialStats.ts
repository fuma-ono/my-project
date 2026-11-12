/**
 * ② Official statistics (FRED / BLS): stores observations of every mapped
 * official series in official_observations (audit trail of what the
 * verification compared against), and builds the live resolver the
 * calendar pipeline and the re-verification use.
 */
import { INGESTION_SETTINGS } from '../config.js';
import { INDICATOR_MAPPINGS, type IndicatorMapping, type OfficialSeriesRef } from '../mappings/indicators.js';
import type { OfficialStatsProvider } from '../providers.js';
import type { JobCounters } from '../runner.js';
import type { IngestionStore } from '../store.js';
import { monthStart, shiftMonth } from '../time.js';
import type { OfficialObservation, OfficialSource } from '../types.js';
import { createOfficialResolver, observationWindow, type OfficialValueResolver } from '../verification/official.js';

export interface OfficialProviders {
  FRED?: OfficialStatsProvider;
  BLS?: OfficialStatsProvider;
}

/**
 * The provider for a mapping's official source. Only FRED / BLS — the sources official_observations
 * stores (its check constraint). EUROSTAT is read live by its own schedule path only
 * (pipelines/eurostatCalendar.ts) and never goes through ingest:official.
 */
function providerFor(providers: OfficialProviders, source: OfficialSource): OfficialStatsProvider | undefined {
  return source === 'FRED' || source === 'BLS' ? providers[source] : undefined;
}

/** Unique official series referenced by the mappings, limited to providers that are configured. */
export function officialSeriesToFetch(
  providers: OfficialProviders,
  mappings: readonly IndicatorMapping[] = INDICATOR_MAPPINGS,
): OfficialSeriesRef[] {
  const seen = new Map<string, OfficialSeriesRef>();
  for (const mapping of mappings) {
    for (const ref of mapping.official) {
      if (providerFor(providers, ref.source)) seen.set(`${ref.source}:${ref.seriesId}`, ref);
    }
  }
  return [...seen.values()];
}

export async function ingestOfficialObservations(
  deps: {
    store: IngestionStore;
    providers: OfficialProviders;
    mappings?: readonly IndicatorMapping[];
    now?: () => Date;
  },
  counters: JobCounters,
): Promise<void> {
  const now = deps.now?.() ?? new Date();
  const today = now.toISOString().slice(0, 10);
  const currentMonth = today.slice(0, 7);
  const start = monthStart(shiftMonth(currentMonth, -INGESTION_SETTINGS.officialLookbackMonths));
  for (const ref of officialSeriesToFetch(deps.providers, deps.mappings)) {
    const provider = providerFor(deps.providers, ref.source);
    if (!provider) continue;
    try {
      const observations = await provider.fetchObservations({
        seriesId: ref.seriesId,
        observationStart: start,
        observationEnd: today,
        asOfDate: today,
      });
      counters.fetched += observations.length;
      const stored = await deps.store.upsertOfficialObservations(
        observations.flatMap((observation) =>
          observation.source === 'EUROSTAT'
            ? []
            : [
                {
                  source: observation.source,
                  series_id: observation.seriesId,
                  period_start: observation.periodStart,
                  as_of_date: observation.asOfDate,
                  value: observation.value,
                  release_status: observation.releaseStatus,
                  fetched_at: now.toISOString(),
                },
              ],
        ),
      );
      counters.success += stored;
    } catch (error) {
      counters.error(`${ref.source}:${ref.seriesId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

/**
 * A source without vintages (BLS) only returns today's values. Those equal
 * the values "as of" the release only shortly after it (the next release
 * revises the prior months), so such a source is not used for as-of dates
 * older than this.
 */
export const CURRENT_VINTAGE_MAX_AGE_DAYS = 20;

/**
 * Resolver that fetches the needed window live (point-in-time for FRED),
 * cached per series + period + as-of date for the duration of one job.
 */
export function createLiveOfficialResolver(
  providers: OfficialProviders,
  onError?: (ref: OfficialSeriesRef, error: unknown) => void,
  now: () => Date = () => new Date(),
): OfficialValueResolver {
  const cache = new Map<string, Promise<OfficialObservation[]>>();
  return createOfficialResolver((ref, period, asOfDate) => {
    const provider = providerFor(providers, ref.source);
    if (!provider) return Promise.resolve([]);
    const ageDays = (now().getTime() - Date.parse(`${asOfDate}T00:00:00Z`)) / 86_400_000;
    if (!provider.supportsPointInTime && ageDays > CURRENT_VINTAGE_MAX_AGE_DAYS) return Promise.resolve([]);
    const window = observationWindow(period, ref.transform);
    const cacheKey = `${ref.source}:${ref.seriesId}:${period}:${ref.transform}:${asOfDate}`;
    let pending = cache.get(cacheKey);
    if (!pending) {
      pending = provider.fetchObservations({
        seriesId: ref.seriesId,
        observationStart: window.start,
        observationEnd: window.end,
        asOfDate,
      });
      cache.set(cacheKey, pending);
    }
    return pending;
  }, onError);
}
