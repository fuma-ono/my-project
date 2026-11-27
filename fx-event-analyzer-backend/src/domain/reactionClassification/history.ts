import type { ClassLabel } from './classify.js';
import type { ReactionParams } from './params.js';
import { roundTo } from './stats.js';

/**
 * Past comparison of one window: the same indicator x same pair x same window, up to `history.max_samples` earlier
 * RELEASED events with an EXACT time (newest first), all of them counted (a past event without 1-minute bars is a
 * sample that is UNDETERMINED / NO_PRICE_DATA; dropping it silently would make the sample look better than it is).
 *
 * Owner decision C: a share table and a most-common label are produced only when at least `history.min_determined`
 * samples were determined; below that only the raw counts and the sample list are returned. sample_count,
 * min_required, max_samples and status are always returned.
 *
 * NOT planLimits.history_events_max: that is a per-plan display cap of the comparison endpoints (null = no fixed cap
 * for FREE in 1.0, PRO 20), so using it would make the same analysis depend on the user's plan and, in 1.0, unbounded
 * (each sample costs about 700 minute-bar reads). The sample size is an analysis parameter (rx-v1: 10 / 3), the same
 * idea as the fixed STRATEGY_SAMPLE_WINDOW / STRATEGY_MINIMUM_SAMPLES of strategy-analysis. A plan-based limit, if ever
 * wanted, belongs to the entitlement layer, not here.
 */
export type HistoryStatus = 'OK' | 'INSUFFICIENT_SAMPLE' | 'NO_HISTORY';

export const CLASS_LABELS = [
  'CONTINUATION',
  'PULLBACK',
  'FULL_RETRACE',
  'REVERSAL',
] as const satisfies readonly ClassLabel[];

export interface HistorySampleInput {
  event_id: string;
  release_datetime: string;
  label: ClassLabel | 'UNDETERMINED';
  reason: string | null;
  has_overlap: boolean;
}

export interface WindowHistory {
  minutes: number;
  status: HistoryStatus;
  sample_count: number;
  min_required: number;
  max_samples: number;
  determined_count: number;
  undetermined_count: number;
  undetermined_by_reason: Record<string, number>;
  overlap_count: number;
  class_counts: Record<ClassLabel, number>;
  shares: Record<ClassLabel, number> | null;
  dominant_label: ClassLabel | null;
  samples: HistorySampleInput[];
}

const SHARE_DECIMALS = 4;

export function buildWindowHistory(
  minutes: number,
  allSamples: readonly HistorySampleInput[],
  params: ReactionParams,
): WindowHistory {
  const samples = allSamples.slice(0, params.history.max_samples);
  const classCounts: Record<ClassLabel, number> = { CONTINUATION: 0, PULLBACK: 0, FULL_RETRACE: 0, REVERSAL: 0 };
  const byReason: Record<string, number> = {};
  let undetermined = 0;
  for (const s of samples) {
    if (s.label === 'UNDETERMINED') {
      undetermined += 1;
      const reason = s.reason ?? 'UNKNOWN';
      byReason[reason] = (byReason[reason] ?? 0) + 1;
    } else {
      classCounts[s.label] += 1;
    }
  }
  const determined = samples.length - undetermined;
  const status: HistoryStatus =
    samples.length === 0 ? 'NO_HISTORY' : determined >= params.history.min_determined ? 'OK' : 'INSUFFICIENT_SAMPLE';

  let shares: Record<ClassLabel, number> | null = null;
  let dominant: ClassLabel | null = null;
  if (status === 'OK') {
    shares = {
      CONTINUATION: roundTo(classCounts.CONTINUATION / determined, SHARE_DECIMALS),
      PULLBACK: roundTo(classCounts.PULLBACK / determined, SHARE_DECIMALS),
      FULL_RETRACE: roundTo(classCounts.FULL_RETRACE / determined, SHARE_DECIMALS),
      REVERSAL: roundTo(classCounts.REVERSAL / determined, SHARE_DECIMALS),
    };
    const top = Math.max(...CLASS_LABELS.map((l) => classCounts[l]));
    const leaders = CLASS_LABELS.filter((l) => classCounts[l] === top);
    // A tie for the most common label has no single answer: null (the counts and shares are still there).
    dominant = leaders.length === 1 ? leaders[0]! : null;
  }

  return {
    minutes,
    status,
    sample_count: samples.length,
    min_required: params.history.min_determined,
    max_samples: params.history.max_samples,
    determined_count: determined,
    undetermined_count: undetermined,
    undetermined_by_reason: byReason,
    overlap_count: samples.filter((s) => s.has_overlap).length,
    class_counts: classCounts,
    shares,
    dominant_label: dominant,
    samples: [...samples],
  };
}
