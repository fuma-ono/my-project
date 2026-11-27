import { createHash } from 'node:crypto';

/**
 * Versioned parameter sets of the event reaction classification (owner decision 2026-11-27: parameters are
 * provisional, versioned, and changeable without touching the classifier; no magic numbers in classify.ts /
 * baseline.ts). A set is an immutable object registered under an id; an existing id is never edited (a change is a
 * NEW id, e.g. 'rx-v2', adopted only after a reclassification report shows the label transitions).
 * `paramsHash` fingerprints the content: a test pins the hash of 'rx-v1', so changing a value without a new id fails.
 */
export interface BaselineParams {
  kind: 'MAX_OWN_TYPICAL_NY';
  /** Length (minutes) of the pre-release window whose 1-minute close changes give sigma. */
  lookback_minutes: number;
  /** Minimum number of valid close-to-close changes in that window (missing bars drop both neighbouring changes). */
  min_valid_changes: number;
  /** At most this many past NY weekday sessions are pooled into the typical sigma. */
  typical_max_sessions: number;
  /** The typical sigma needs at least this many valid sessions. */
  typical_min_sessions: number;
  /** Sessions are searched this many calendar days back. */
  typical_lookback_days: number;
  /** The wall clock that aligns "the same time of day" (DST handled by the IANA database). */
  clock: 'America/New_York';
}

export type OverlapImportance = 'MEDIUM' | 'HIGH';

export interface ReactionParams {
  param_set_id: string;
  status: 'PROVISIONAL' | 'VALIDATED';
  /** Windows (minutes) whose values are reported. */
  windows: readonly number[];
  /** Windows that get a classification label; the others are REFERENCE_ONLY. */
  classified_windows: readonly number[];
  /** Initial-move window (minutes). */
  w0: number;
  /** Initial move below k_small x sigma x sqrt(w0) is SMALL_INITIAL. */
  k_small: number;
  /** A pullback shallower than k_pb x sigma x sqrt(w0) counts as none. */
  k_pb: number;
  /** Deepest pullback ratio at or above this is PULLBACK. */
  r_push: number;
  /** Final retracement ratio at or above this is FULL_RETRACE. */
  r_full: number;
  /** REVERSAL needs the window end beyond P0 on the other side by rho x sigma x sqrt(n) ... */
  rho: number;
  /** ... and by at least phi x peak. */
  phi: number;
  /** The window end is the median of the last this-many closes. */
  end_median_bars: number;
  /** Missing 1-minute bars tolerated inside a window. Only 0 is supported (bars are never interpolated). */
  missing_bars_tolerated_in_window: number;
  /** Tolerance of the comparisons against the thresholds. */
  eps: number;
  /** A value within this relative distance of a threshold is flagged `borderline`. */
  borderline_tolerance: number;
  baseline: BaselineParams;
  overlap: { min_importance: OverlapImportance };
  history: { max_samples: number; min_determined: number };
}

export const CLASSIFIER_VERSION = '1.0.0';
export const DEFAULT_PARAM_SET_ID = 'rx-v1';

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const v of Object.values(value)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
}

/** Parameter set rx-v1 (provisional; owner decisions 2026-11-27: w0 = 2 min, k_small = 2.0, rho = 1.0, 5-minute window excluded). */
export const RX_V1: ReactionParams = deepFreeze({
  param_set_id: 'rx-v1',
  status: 'PROVISIONAL',
  windows: [1, 5, 15, 30, 60],
  classified_windows: [15, 30, 60],
  w0: 2,
  k_small: 2.0,
  k_pb: 2.0,
  r_push: 0.5,
  r_full: 0.85,
  rho: 1.0,
  phi: 0.25,
  end_median_bars: 3,
  missing_bars_tolerated_in_window: 0,
  eps: 1e-9,
  borderline_tolerance: 0.1,
  baseline: {
    kind: 'MAX_OWN_TYPICAL_NY',
    lookback_minutes: 60,
    min_valid_changes: 40,
    typical_max_sessions: 10,
    typical_min_sessions: 5,
    typical_lookback_days: 21,
    clock: 'America/New_York',
  },
  overlap: { min_importance: 'MEDIUM' },
  history: { max_samples: 10, min_determined: 3 },
} satisfies ReactionParams);

export const REACTION_PARAM_SETS: Readonly<Record<string, ReactionParams>> = deepFreeze({
  [RX_V1.param_set_id]: RX_V1,
});

export function getParamSet(id: string): ReactionParams {
  const found = REACTION_PARAM_SETS[id];
  if (!found) throw new RangeError(`unknown reaction parameter set: ${id}`);
  return found;
}

export type ParamOverrides = Partial<Omit<ReactionParams, 'baseline' | 'overlap' | 'history'>> & {
  baseline?: Partial<BaselineParams>;
  overlap?: Partial<ReactionParams['overlap']>;
  history?: Partial<ReactionParams['history']>;
};

export function validateParams(p: ReactionParams): void {
  if (p.missing_bars_tolerated_in_window !== 0) {
    throw new RangeError('missing_bars_tolerated_in_window: only 0 is supported (missing bars are never interpolated)');
  }
  if (!p.classified_windows.every((n) => p.windows.includes(n))) {
    throw new RangeError('classified_windows must be a subset of windows');
  }
  if (p.w0 < 1 || p.end_median_bars < 1) throw new RangeError('w0 and end_median_bars must be at least 1');
  if (p.history.min_determined < 1 || p.history.max_samples < p.history.min_determined) {
    throw new RangeError('history: max_samples must be >= min_determined >= 1');
  }
}

/** A new (unregistered) set derived from `base` (used by the reclassification report and tests). Validates the result. */
export function deriveParams(base: ReactionParams, overrides: ParamOverrides): ReactionParams {
  const derived: ReactionParams = {
    ...base,
    ...overrides,
    baseline: { ...base.baseline, ...overrides.baseline },
    overlap: { ...base.overlap, ...overrides.overlap },
    history: { ...base.history, ...overrides.history },
  };
  validateParams(derived);
  return deepFreeze(derived);
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** 'sha256:<hex>' of the canonical (key-sorted) JSON of the whole set, id and status included. */
export function paramsHash(p: ReactionParams): string {
  return `sha256:${createHash('sha256').update(canonical(p)).digest('hex')}`;
}

/** The `params` object of the API response: the set without its id / status (those are separate meta fields). */
export function publicParams(p: ReactionParams): Omit<ReactionParams, 'param_set_id' | 'status'> {
  const { param_set_id: _id, status: _status, ...rest } = p;
  return rest;
}
