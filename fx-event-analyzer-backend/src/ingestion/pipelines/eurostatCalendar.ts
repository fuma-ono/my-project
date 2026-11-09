/**
 * Euro-area calendar path (HQ承認 2026-10-30「ユーロ圏経済指標 第1弾」): builds economic_events
 * from Eurostat's own release calendar (mappings/eurostatSchedule.ts) and Eurostat's own values —
 * no paid calendar, no key. Same design as the BLS path (blsCalendar.ts): the releases are fed
 * through the SAME ingestCalendarReleases() (scheduling, staging, revisions, data-quality report
 * unchanged), and `actual` and the resolver come from the same Eurostat fetch, so VERIFIED here
 * means "matches Eurostat itself" (SELF_MATCH in the quality report), not a second opinion.
 *
 * Differences from BLS, all from HQ判断 2026-10-30:
 * - Release time: 11:00 Europe/Luxembourg as APPROXIMATE (mapping.release.precision) — stored as
 *   APPROXIMATE, so 1-minute reactions are not computed (dataQuality.availableTimeframes).
 * - Previous: the period before the reference period by the period's own form
 *   (previousReferencePeriod), from the indicator's previous-value series (HICP flash: the
 *   previous month's FINAL HICP). Never "one month before the release date".
 * - A LATEST_ONLY series (unemployment) is built only within FIRST_RELEASE_WINDOW_HOURS of the
 *   release: later, Eurostat may already show a revised number, so nothing is created or
 *   published from it (`outsideFirstReleaseWindow`; the job reports those still unpublished).
 * - Never a forecast (Eurostat publishes none).
 */
import type { OfficialStatsProvider } from '../providers.js';
import {
  EUROSTAT_INDICATOR_SCHEDULES,
  EUROSTAT_SCHEDULE,
  FIRST_RELEASE_WINDOW_HOURS,
  type EurostatIndicatorSchedule,
  type EurostatScheduleEntry,
} from '../mappings/eurostatSchedule.js';
import {
  findMappingByCode,
  INDICATOR_MAPPINGS,
  providerIndicatorKey,
  type IndicatorMapping,
} from '../mappings/indicators.js';
import { monthStart, previousReferencePeriod, shiftMonth, zonedWallTimeToUtc } from '../time.js';
import type { NormalizedCalendarRelease, OfficialObservation } from '../types.js';
import { computeOfficialValue, type OfficialValueResolver } from '../verification/official.js';
import { displayUnit } from '../values.js';
import { OVERDUE_AFTER_DAYS } from './blsCalendar.js';

export const EUROSTAT_SCHEDULE_PROVIDER = 'eurostat_schedule';

/** economic_events.provider_event_id of a schedule entry. */
export function eurostatScheduleEventId(
  entry: Pick<EurostatScheduleEntry, 'indicatorCode' | 'referencePeriod'>,
): string {
  return `${EUROSTAT_SCHEDULE_PROVIDER}:${entry.indicatorCode}:${entry.referencePeriod}`;
}

/** [start, end] ('YYYY-MM-DD') covering every period the entries need — each previous period through the latest. */
export function eurostatObservationRange(entries: readonly EurostatScheduleEntry[] = EUROSTAT_SCHEDULE): {
  start: string;
  end: string;
} {
  const periods = entries.map((e) => e.referencePeriod);
  const min = periods.reduce((a, b) => (a < b ? a : b));
  const max = periods.reduce((a, b) => (a > b ? a : b));
  return { start: monthStart(shiftMonth(min, -1)), end: monthStart(max) };
}

/** The Eurostat series an indicator's actual comes from (its first EUROSTAT official ref). */
function actualSeriesId(mapping: IndicatorMapping): string | null {
  return mapping.official.find((ref) => ref.source === 'EUROSTAT')?.seriesId ?? null;
}

/** Every series the path reads: each mapped indicator's own series and its previous-value series. */
export function eurostatScheduleSeriesIds(
  mappings: readonly IndicatorMapping[] = INDICATOR_MAPPINGS,
  schedules: Readonly<Record<string, EurostatIndicatorSchedule>> = EUROSTAT_INDICATOR_SCHEDULES,
): string[] {
  const ids = new Set<string>();
  for (const mapping of mappings) {
    if (!mapping.providers.eurostat_schedule) continue;
    const own = actualSeriesId(mapping);
    if (own) ids.add(own);
    const previous = schedules[mapping.code]?.previousSeriesId;
    if (previous) ids.add(previous);
  }
  return [...ids].sort();
}

/**
 * Fetches each series ONCE for the whole range and serves every lookup from that set. A failed
 * fetch is reported through onError (never thrown) and yields no observations, so that series'
 * entries simply get no value this run (they stay SCHEDULED and are tried again next run).
 */
export function createEurostatSeriesCache(
  provider: OfficialStatsProvider,
  range: { start: string; end: string },
  onError: (seriesId: string, error: unknown) => void = () => undefined,
): (seriesId: string) => Promise<OfficialObservation[]> {
  const cache = new Map<string, Promise<OfficialObservation[]>>();
  return (seriesId) => {
    let pending = cache.get(seriesId);
    if (!pending) {
      pending = provider
        .fetchObservations({ seriesId, observationStart: range.start, observationEnd: range.end })
        .catch((error: unknown) => {
          onError(seriesId, error);
          return [];
        });
      cache.set(seriesId, pending);
    }
    return pending;
  };
}

/** The value of `seriesId` for monthly `period`, as the latest fetch shows it (LEVEL), or null. */
async function valueOf(
  series: (seriesId: string) => Promise<OfficialObservation[]>,
  seriesId: string,
  period: string,
): Promise<{ value: number; sourceRef: string } | null> {
  const observations = await series(seriesId);
  const value = computeOfficialValue(observations, period, 'LEVEL');
  if (value === null) return null;
  const asOf = observations.find((o) => o.periodStart === monthStart(period))?.asOfDate ?? '';
  return { value, sourceRef: `EUROSTAT:${seriesId}@${asOf}` };
}

/**
 * The resolver ingestCalendarReleases verifies `actual` with — the indicator's own Eurostat
 * series through the same cache, so actual and official are the same fetch (see file header).
 */
export function createEurostatNativeResolver(
  series: (seriesId: string) => Promise<OfficialObservation[]>,
): OfficialValueResolver {
  return {
    async resolve(mapping, period) {
      const ref = mapping.official.find((r) => r.source === 'EUROSTAT');
      if (!ref) return null;
      const observations = await series(ref.seriesId);
      const value = computeOfficialValue(observations, period, ref.transform);
      if (value === null) return null;
      const asOf = observations.find((o) => o.periodStart === monthStart(period))?.asOfDate ?? '';
      return { value, sourceRef: `EUROSTAT:${ref.seriesId}@${asOf}` };
    },
  };
}

export interface EurostatScheduleReleaseResult {
  releases: NormalizedCalendarRelease[];
  /** Past entries whose value Eurostat does not show yet (never guessed). */
  notYetAvailable: EurostatScheduleEntry[];
  /** Subset of notYetAvailable OVERDUE_AFTER_DAYS or more past the date — the table may be stale. */
  overdue: EurostatScheduleEntry[];
  /** LATEST_ONLY entries more than FIRST_RELEASE_WINDOW_HOURS past the release — not built. */
  outsideFirstReleaseWindow: EurostatScheduleEntry[];
  /** Entries with no mapping / no eurostat_schedule key / no schedule settings / no series. */
  unmapped: EurostatScheduleEntry[];
}

function releaseInstant(entry: EurostatScheduleEntry, mapping: IndicatorMapping): Date | null {
  const [year, month, day] = entry.releaseDate.split('-').map(Number) as [number, number, number];
  const [hour, minute] = mapping.release.localTimes[0]!.split(':').map(Number) as [number, number];
  return zonedWallTimeToUtc(year, month, day, hour, minute, mapping.release.timeZone);
}

/** The UTC instant of an entry's release (null: unmapped / the wall time does not exist). */
export function eurostatScheduleReleaseAt(
  entry: EurostatScheduleEntry,
  mappings: readonly IndicatorMapping[] = INDICATOR_MAPPINGS,
): Date | null {
  const mapping = findMappingByCode(entry.indicatorCode, mappings);
  return mapping?.providers.eurostat_schedule ? releaseInstant(entry, mapping) : null;
}

/**
 * Turns the schedule into NormalizedCalendarRelease rows for
 * ingestCalendarReleases('eurostat_schedule', …):
 * - future entry: a SCHEDULED row (actual/forecast null);
 * - past entry with a value: actual = Eurostat's value for the reference period, previous =
 *   the previous period's value from the previous-value series (null if Eurostat has none).
 */
export async function buildEurostatScheduleReleases(deps: {
  series: (seriesId: string) => Promise<OfficialObservation[]>;
  entries?: readonly EurostatScheduleEntry[];
  mappings?: readonly IndicatorMapping[];
  schedules?: Readonly<Record<string, EurostatIndicatorSchedule>>;
  now?: () => Date;
}): Promise<EurostatScheduleReleaseResult> {
  const entries = deps.entries ?? EUROSTAT_SCHEDULE;
  const schedules = deps.schedules ?? EUROSTAT_INDICATOR_SCHEDULES;
  const now = deps.now?.() ?? new Date();
  const result: EurostatScheduleReleaseResult = {
    releases: [],
    notYetAvailable: [],
    overdue: [],
    outsideFirstReleaseWindow: [],
    unmapped: [],
  };

  for (const entry of entries) {
    const mapping = findMappingByCode(entry.indicatorCode, deps.mappings);
    const ref = mapping?.providers.eurostat_schedule;
    const schedule = schedules[entry.indicatorCode];
    const ownSeries = mapping ? actualSeriesId(mapping) : null;
    const releaseAt = mapping ? releaseInstant(entry, mapping) : null;
    if (!mapping || !ref || !schedule || !ownSeries || !releaseAt) {
      result.unmapped.push(entry);
      continue;
    }
    const sinceRelease = now.getTime() - releaseAt.getTime();
    const published = sinceRelease >= 0;
    if (published && schedule.valueVintage === 'LATEST_ONLY' && sinceRelease > FIRST_RELEASE_WINDOW_HOURS * 3_600_000) {
      result.outsideFirstReleaseWindow.push(entry);
      continue;
    }

    const actual = published ? await valueOf(deps.series, ownSeries, entry.referencePeriod) : null;
    if (published && !actual) {
      result.notYetAvailable.push(entry);
      if (sinceRelease >= OVERDUE_AFTER_DAYS * 86_400_000) result.overdue.push(entry);
      continue;
    }
    const previousPeriod = previousReferencePeriod(entry.referencePeriod);
    const previous = await valueOf(deps.series, schedule.previousSeriesId ?? ownSeries, previousPeriod);
    const unit = displayUnit(mapping.unit);
    result.releases.push({
      provider: EUROSTAT_SCHEDULE_PROVIDER,
      providerEventId: eurostatScheduleEventId(entry),
      providerIndicatorKey: providerIndicatorKey(ref.country, ref.event),
      eventName: mapping.description,
      releaseAt: releaseAt.toISOString(),
      releaseAtPrecision: mapping.release.precision ?? 'EXACT',
      referencePeriod: entry.referencePeriod,
      actual: actual ? { value: actual.value, unit } : null,
      forecast: null,
      previous: previous ? { value: previous.value, unit } : null,
      revisedPrevious: previous ? { value: previous.value, unit } : null,
      fetchedAt: now.toISOString(),
    });
  }
  return result;
}
