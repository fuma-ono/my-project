/**
 * Independent calendar path (HQ判断 2026-10-17): builds economic_events
 * directly from BLS's own release schedule (mappings/blsSchedule.ts) and
 * BLS's own observations — no paid calendar involved. The releases this
 * produces are fed through the SAME ingestCalendarReleases() the paid
 * calendars use (economicCalendar.ts is not changed at all): scheduling,
 * staging, revisions and the data-quality report all work unchanged.
 *
 * Unlike the paid-calendar path, there is only one source here (BLS), so
 * "official match" is not a second opinion — createBlsNativeResolver()
 * resolves the SAME BLS series used to build `actual`, which is why these
 * releases become VERIFIED by construction rather than by independent
 * corroboration. That is a real limitation, not a shortcut: this path
 * only ever tells you what BLS itself published, honestly labelled by
 * mapping.agency (BLS). It never asserts a forecast — BLS has none — and
 * it never touches indicators without a BLS official series.
 *
 * createLiveOfficialResolver (officialStats.ts) is deliberately NOT reused
 * here: it refuses values more than CURRENT_VINTAGE_MAX_AGE_DAYS old for a
 * non-point-in-time source (BLS), a safeguard that matters when BLS is
 * being used as a second opinion on a paid provider's claim about the
 * past. That concern does not apply to a release BLS's own schedule says
 * is BLS's own number, at any age — backfilling older months must not be
 * silently limited to the last 20 days.
 */
import type { OfficialStatsProvider } from '../providers.js';
import { findMappingByCode, type IndicatorMapping } from '../mappings/indicators.js';
import { BLS_SCHEDULE, type BlsScheduleEntry } from '../mappings/blsSchedule.js';
import { providerIndicatorKey } from '../mappings/indicators.js';
import { localDate, shiftMonth, zonedWallTimeToUtc } from '../time.js';
import type { NormalizedCalendarRelease } from '../types.js';
import { computeOfficialValue, observationWindow, type OfficialValueResolver } from '../verification/official.js';
import { displayUnit } from '../values.js';

export const BLS_SCHEDULE_PROVIDER = 'bls_schedule';

/**
 * Resolves a mapping's BLS official series directly, at any age — see the
 * file header for why this must not share officialStats.ts's staleness
 * guard. onError reports (never throws) a fetch failure for one period so
 * the rest of the schedule still gets processed.
 */
export function createBlsNativeResolver(
  bls: OfficialStatsProvider,
  onError: (error: unknown) => void = () => undefined,
): OfficialValueResolver {
  return {
    async resolve(mapping, period, asOfDate) {
      const ref = mapping.official.find((r) => r.source === 'BLS');
      if (!ref) return null;
      const window = observationWindow(period, ref.transform);
      let observations;
      try {
        observations = await bls.fetchObservations({
          seriesId: ref.seriesId,
          observationStart: window.start,
          observationEnd: window.end,
          asOfDate,
        });
      } catch (error) {
        onError(error);
        return null;
      }
      const value = computeOfficialValue(observations, period, ref.transform);
      if (value === null) return null;
      const asOf = observations.find((o) => o.periodStart === `${period}-01`)?.asOfDate ?? asOfDate;
      return { value, sourceRef: `${ref.source}:${ref.seriesId}@${asOf}` };
    },
  };
}

export interface BlsScheduleReleaseResult {
  releases: NormalizedCalendarRelease[];
  /** Schedule entries in the future, or whose BLS value is not published yet (never guessed). */
  notYetAvailable: BlsScheduleEntry[];
  /** Schedule entries for an indicator with no economic_indicators row / no bls_schedule mapping key. */
  unmapped: BlsScheduleEntry[];
}

/**
 * Turns BLS_SCHEDULE into NormalizedCalendarRelease rows ready for
 * ingestCalendarReleases('bls_schedule', …). A release is only produced
 * once BLS has actually published that period's value (never fabricated
 * from the schedule alone) — `official` is used for BOTH `actual` and the
 * resolver the caller passes to ingestCalendarReleases, so they always
 * agree (see file header).
 */
export async function buildBlsScheduleReleases(deps: {
  official: OfficialValueResolver;
  entries?: readonly BlsScheduleEntry[];
  mappings?: readonly IndicatorMapping[];
  now?: () => Date;
}): Promise<BlsScheduleReleaseResult> {
  const entries = deps.entries ?? BLS_SCHEDULE;
  const now = deps.now?.() ?? new Date();
  const releases: NormalizedCalendarRelease[] = [];
  const notYetAvailable: BlsScheduleEntry[] = [];
  const unmapped: BlsScheduleEntry[] = [];

  for (const entry of entries) {
    const mapping = findMappingByCode(entry.indicatorCode, deps.mappings);
    const ref = mapping?.providers.bls_schedule;
    if (!mapping || !ref) {
      unmapped.push(entry);
      continue;
    }
    const [year, month, day] = entry.releaseDate.split('-').map(Number) as [number, number, number];
    const [hour, minute] = mapping.release.localTimes[0]!.split(':').map(Number) as [number, number];
    const releaseAt = zonedWallTimeToUtc(year, month, day, hour, minute, mapping.release.timeZone);
    if (!releaseAt || releaseAt.getTime() > now.getTime()) {
      notYetAvailable.push(entry);
      continue;
    }
    const asOfDate = localDate(releaseAt, mapping.release.timeZone);
    const actual = await deps.official.resolve(mapping, entry.referencePeriod, asOfDate);
    if (!actual) {
      notYetAvailable.push(entry);
      continue;
    }
    const previousPeriod = shiftMonth(entry.referencePeriod, -1);
    const previous = await deps.official.resolve(mapping, previousPeriod, asOfDate);
    // The value is already in mapping.unit (it came straight from the BLS
    // series validateRelease verifies against), so the ProviderValue's own
    // unit must say so explicitly — allowMissingUnit is false for these
    // indicators (shared with the paid-calendar path, not changed here).
    const unit = displayUnit(mapping.unit);

    releases.push({
      provider: BLS_SCHEDULE_PROVIDER,
      providerEventId: `${BLS_SCHEDULE_PROVIDER}:${entry.indicatorCode}:${entry.referencePeriod}`,
      providerIndicatorKey: providerIndicatorKey(ref.country, ref.event),
      eventName: mapping.description,
      releaseAt: releaseAt.toISOString(),
      releaseAtPrecision: 'EXACT',
      referencePeriod: entry.referencePeriod,
      actual: { value: actual.value, unit },
      forecast: null,
      previous: previous ? { value: previous.value, unit } : null,
      revisedPrevious: previous ? { value: previous.value, unit } : null,
      fetchedAt: now.toISOString(),
    });
  }
  return { releases, notYetAvailable, unmapped };
}
