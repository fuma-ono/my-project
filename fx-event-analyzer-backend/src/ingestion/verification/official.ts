/**
 * Cross-verification against free official statistics (②). Computes the
 * value an agency published from raw series observations (YoY / MoM /
 * change / level) and compares it with the paid provider's number after
 * rounding both to the agency's published decimals.
 */
import type { IndicatorMapping, OfficialSeriesRef, OfficialTransform } from '../mappings/indicators.js';
import type { OfficialObservation } from '../types.js';
import { monthStart, shiftMonth } from '../time.js';
import { roundTo } from '../values.js';

/**
 * The comparable value for monthly `period` ('YYYY-MM') from a series'
 * observations, or null when any needed observation is missing (never
 * guessed — e.g. Oct 2025 CPI was never published).
 */
export function computeOfficialValue(
  observations: readonly OfficialObservation[],
  period: string,
  transform: OfficialTransform,
): number | null {
  const byPeriod = new Map<string, number | null>();
  for (const observation of observations) byPeriod.set(observation.periodStart, observation.value);
  const at = (p: string): number | null => byPeriod.get(monthStart(p)) ?? null;

  const current = at(period);
  if (current === null) return null;
  switch (transform) {
    case 'LEVEL':
      return current;
    case 'DIFF': {
      const prior = at(shiftMonth(period, -1));
      return prior === null ? null : roundTo(current - prior, 6);
    }
    case 'MOM_PCT': {
      const prior = at(shiftMonth(period, -1));
      return prior === null || prior === 0 ? null : (current / prior - 1) * 100;
    }
    case 'YOY_PCT': {
      const prior = at(shiftMonth(period, -12));
      return prior === null || prior === 0 ? null : (current / prior - 1) * 100;
    }
  }
}

export interface OfficialComparison {
  match: boolean;
  paidRounded: number;
  officialRounded: number;
  /** paidRounded − officialRounded. */
  difference: number;
}

/** Rounding-aware comparison: both sides rounded to `decimals`, then |diff| ≤ tolerance. */
export function compareWithOfficial(
  paid: number,
  official: number,
  decimals: number,
  tolerance: number,
): OfficialComparison {
  const paidRounded = roundTo(paid, decimals);
  const officialRounded = roundTo(official, decimals);
  const difference = roundTo(paidRounded - officialRounded, decimals + 2);
  return { match: Math.abs(difference) <= tolerance + 1e-9, paidRounded, officialRounded, difference };
}

export interface ResolvedOfficialValue {
  value: number;
  /** e.g. "FRED:CPIAUCNS@2026-10-14" */
  sourceRef: string;
}

/**
 * Looks up the official value for an indicator/period. Implementations:
 * live adapters (eval / ingest:official) or stored official_observations.
 */
export interface OfficialValueResolver {
  resolve(mapping: IndicatorMapping, period: string, asOfDate: string): Promise<ResolvedOfficialValue | null>;
}

export type ObservationFetcher = (
  ref: OfficialSeriesRef,
  period: string,
  asOfDate: string,
) => Promise<OfficialObservation[]>;

/**
 * Tries the mapping's official series in priority order; the first one
 * that yields a value wins. A fetch failure for one source falls through
 * to the next (and is reported via onError) rather than failing the run.
 */
export function createOfficialResolver(
  fetchObservations: ObservationFetcher,
  onError: (ref: OfficialSeriesRef, error: unknown) => void = () => undefined,
): OfficialValueResolver {
  return {
    async resolve(mapping, period, asOfDate) {
      for (const ref of mapping.official) {
        let observations: OfficialObservation[];
        try {
          observations = await fetchObservations(ref, period, asOfDate);
        } catch (error) {
          onError(ref, error);
          continue;
        }
        const value = computeOfficialValue(observations, period, ref.transform);
        if (value !== null) {
          const asOf = observations.find((o) => o.periodStart === monthStart(period))?.asOfDate ?? asOfDate;
          return { value, sourceRef: `${ref.source}:${ref.seriesId}@${asOf}` };
        }
      }
      return null;
    },
  };
}

/** Observation window needed to compute `transform` for `period`: [start, end] as 'YYYY-MM-DD'. */
export function observationWindow(period: string, transform: OfficialTransform): { start: string; end: string } {
  const back = transform === 'YOY_PCT' ? 12 : transform === 'LEVEL' ? 0 : 1;
  return { start: monthStart(shiftMonth(period, -back)), end: monthStart(period) };
}
