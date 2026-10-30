/**
 * Validation rules for one paid-calendar release (data-sources.md §6).
 * Every rule that fails yields an issue code; any BLOCKING issue keeps the
 * value out of event_snapshots (it goes to ingestion_staged_values as
 * PENDING_REVIEW and the Read API keeps showing DATA_PENDING).
 */
import type { IndicatorMapping } from '../mappings/indicators.js';
import type { NormalizedCalendarRelease, ProviderValue } from '../types.js';
import { localDate, shiftMonth, wallClockParts } from '../time.js';
import { roundTo, toMappedUnit } from '../values.js';

export type ReleaseIssueCode =
  /** Provider unit/suffix cannot be the mapped unit (e.g. "%" for a thousands series). */
  | 'UNIT_MISMATCH'
  /** Value outside the mapping's expected magnitude range. */
  | 'OUT_OF_EXPECTED_RANGE'
  /** |actual − previous| above the mapping's threshold. */
  | 'OUTLIER_VS_PREVIOUS'
  /** Provider gave no exact release time. */
  | 'MISSING_EXACT_TIME'
  /** Release time differs from the agency's scheduled local time. */
  | 'RELEASE_TIME_UNEXPECTED'
  /** An actual for a release that is still in the future at fetch time. */
  | 'FUTURE_DATED_ACTUAL'
  /** Same indicator + period appears more than once in one fetch. */
  | 'DUPLICATE_IN_BATCH'
  /** No reference period → cannot be verified against official data. */
  | 'REFERENCE_PERIOD_MISSING'
  /** Paid actual ≠ official value after rounding. */
  | 'OFFICIAL_MISMATCH';

export interface NormalizedValues {
  actual: number | null;
  forecast: number | null;
  previous: number | null;
  revisedPrevious: number | null;
}

export interface ReleaseValidationResult {
  values: NormalizedValues;
  issues: ReleaseIssueCode[];
}

function convert(value: ProviderValue | null, mapping: IndicatorMapping, issues: Set<ReleaseIssueCode>): number | null {
  if (value === null) return null;
  const converted = toMappedUnit(value, mapping.unit, mapping.allowMissingUnit);
  if (converted === null) {
    issues.add('UNIT_MISMATCH');
    return null;
  }
  if (converted < mapping.expectedRange.min || converted > mapping.expectedRange.max) {
    issues.add('OUT_OF_EXPECTED_RANGE');
  }
  return roundTo(converted, 4);
}

/** HH:mm of `iso` in the mapping's release time zone. */
export function localReleaseTime(iso: string, timeZone: string): string {
  const { hour, minute } = wallClockParts(new Date(iso), timeZone);
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export function validateRelease(
  release: NormalizedCalendarRelease,
  mapping: IndicatorMapping,
  options: { futureActualToleranceMs: number },
): ReleaseValidationResult {
  const issues = new Set<ReleaseIssueCode>();
  const values: NormalizedValues = {
    actual: convert(release.actual, mapping, issues),
    forecast: convert(release.forecast, mapping, issues),
    previous: convert(release.previous, mapping, issues),
    revisedPrevious: convert(release.revisedPrevious, mapping, issues),
  };

  if (release.releaseAtPrecision !== 'EXACT') {
    // HQ判断(2026-10-30): an indicator whose agency time is approximate by design
    // (mapping.release.precision) is not held for it — it is stored as APPROXIMATE.
    const expectedApproximate =
      mapping.release.precision === 'APPROXIMATE' && release.releaseAtPrecision === 'APPROXIMATE';
    if (!expectedApproximate) issues.add('MISSING_EXACT_TIME');
  } else if (!mapping.release.localTimes.includes(localReleaseTime(release.releaseAt, mapping.release.timeZone))) {
    issues.add('RELEASE_TIME_UNEXPECTED');
  }

  if (
    release.actual !== null &&
    Date.parse(release.releaseAt) > Date.parse(release.fetchedAt) + options.futureActualToleranceMs
  ) {
    issues.add('FUTURE_DATED_ACTUAL');
  }

  if (values.actual !== null && values.previous !== null) {
    if (Math.abs(values.actual - values.previous) > mapping.maxAbsChangeFromPrevious) issues.add('OUTLIER_VS_PREVIOUS');
  }

  if (release.actual !== null && release.referencePeriod === null) issues.add('REFERENCE_PERIOD_MISSING');

  return { values, issues: [...issues] };
}

/**
 * Finds releases that map to the same indicator and reference period but
 * carry different provider ids (a provider-side duplicate). Returns the
 * set of providerEventIds that must be held for review.
 */
export function findDuplicateReleases(
  releases: readonly { release: NormalizedCalendarRelease; mapping: IndicatorMapping }[],
): Set<string> {
  const byKey = new Map<string, Set<string>>();
  for (const { release, mapping } of releases) {
    if (release.referencePeriod === null) continue;
    const key = `${mapping.code}|${release.referencePeriod}`;
    const ids = byKey.get(key) ?? new Set<string>();
    ids.add(release.providerEventId);
    byKey.set(key, ids);
  }
  const duplicates = new Set<string>();
  for (const ids of byKey.values()) {
    if (ids.size > 1) for (const id of ids) duplicates.add(id);
  }
  return duplicates;
}

/**
 * The release with a reference period: the provider's own, or — when it
 * gives none — the release month in the agency's time zone minus the
 * mapping's lag (inferred = true; such a value is only ever published
 * after it matches the official series for that period).
 */
export function withReferencePeriod(
  release: NormalizedCalendarRelease,
  mapping: IndicatorMapping,
): { release: NormalizedCalendarRelease; inferred: boolean } {
  if (release.referencePeriod !== null) return { release, inferred: false };
  const releaseMonth = localDate(new Date(release.releaseAt), mapping.release.timeZone).slice(0, 7);
  return {
    release: { ...release, referencePeriod: shiftMonth(releaseMonth, -mapping.referencePeriodLagMonths) },
    inferred: true,
  };
}

/** Issues that are informational only (do not block publication). Currently none — accuracy first. */
export const NON_BLOCKING_ISSUES: ReadonlySet<ReleaseIssueCode> = new Set();
