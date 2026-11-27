import { type BarCloses, computeBaseline, type BaselineResult } from './baseline.js';
import {
  type ClassifyResult,
  classifyWindow,
  type ClassLabel,
  pathCloses,
  type UndeterminedReason,
} from './classify.js';
import type { ReactionParams } from './params.js';
import { MS_PER_MINUTE } from './time.js';

/**
 * Pure analysis of one (event, pair): baseline, initial move and the per-window status / label / evidence.
 * No I/O. `bars` holds the 1-minute closes keyed by minute index (see baseline.ts); a missing bar is absent.
 */
export type ClassificationStatus = 'CLASSIFIED' | 'UNDETERMINED' | 'REFERENCE_ONLY' | 'PENDING';
export type ReferenceOnlyReason = 'WINDOW_TOO_SHORT' | 'WINDOW_EXCLUDED_BY_PARAMS';

export interface Evidence {
  initial_z: number;
  peak_offset_pips: number;
  worst_pullback_pips: number;
  worst_pullback_ratio: number;
  final_offset_pips: number;
  final_retracement_ratio: number;
  final_offset_in_noise_units: number;
  borderline: boolean;
}

export interface WindowAnalysis {
  minutes: number;
  classification_status: ClassificationStatus;
  label: ClassLabel | 'UNDETERMINED' | null;
  reason: UndeterminedReason | ReferenceOnlyReason | null;
  evidence: Evidence | null;
}

export interface InitialMove {
  window_minutes: number;
  signed_pips: number | null;
  direction: 'UP' | 'DOWN' | 'FLAT' | null;
  z0: number | null;
}

export interface EventAnalysis {
  baseline: BaselineResult;
  sigmaPips: { sigma: number | null; own: number | null; typical: number | null };
  initial: InitialMove;
  /** c_0: close of the bar that ends exactly at the release time. */
  preReleasePrice: number | null;
  /** End of the newest 1-minute bar used by the path (ms), or null when none exists. */
  barsAsOfMs: number | null;
  windows: WindowAnalysis[];
}

export interface AnalyzeInput {
  releaseMs: number;
  /** release_datetime_precision === 'EXACT'. Otherwise no window is classified (RELEASE_TIME_NOT_EXACT). */
  timeExact: boolean;
  bars: BarCloses;
  params: ReactionParams;
  pipSize: number;
  /** When set, a classified window not yet closed (end + finality > now) is PENDING. Past samples leave it unset. */
  nowMs?: number;
  finalityMs?: number;
}

const minuteOf = (ms: number): number => Math.floor(ms / MS_PER_MINUTE);

function evidenceOf(r: ClassifyResult, pipSize: number): Evidence {
  return {
    initial_z: r.z0!,
    peak_offset_pips: r.M! / pipSize,
    worst_pullback_pips: r.worstPullback! / pipSize,
    worst_pullback_ratio: r.Rmax!,
    final_offset_pips: r.F! / pipSize,
    final_retracement_ratio: r.Rf!,
    final_offset_in_noise_units: r.Fz!,
    borderline: r.borderline!,
  };
}

export function analyzeEvent(input: AnalyzeInput): EventAnalysis {
  const { releaseMs, timeExact, params, pipSize } = input;
  const tMin = minuteOf(releaseMs);
  const maxWindow = Math.max(...params.windows);
  const bars = timeExact ? input.bars : new Map<number, number>();
  const baseline = computeBaseline(bars, tMin, params);
  const path = pathCloses(bars, tMin, maxWindow);
  const sigma = baseline.sigma;
  const c0 = path[0] ?? null;
  const cInitial = path[params.w0] ?? null;

  let initial: InitialMove = { window_minutes: params.w0, signed_pips: null, direction: null, z0: null };
  if (c0 !== null && cInitial !== null) {
    const move = cInitial - c0;
    const flat = Math.abs(move) <= params.eps * Math.max(1, Math.abs(c0));
    initial = {
      window_minutes: params.w0,
      signed_pips: move / pipSize,
      direction: flat ? 'FLAT' : move > 0 ? 'UP' : 'DOWN',
      z0: sigma !== null && sigma > 0 ? Math.abs(move) / (sigma * Math.sqrt(params.w0)) : null,
    };
  }

  let lastIndex = -1;
  path.forEach((v, i) => {
    if (v !== null) lastIndex = i;
  });
  const barsAsOfMs = lastIndex < 0 ? null : (tMin + lastIndex) * MS_PER_MINUTE;

  const windows: WindowAnalysis[] = params.windows.map((minutes) => {
    const base = { minutes, evidence: null };
    if (!params.classified_windows.includes(minutes)) {
      const reason: ReferenceOnlyReason = minutes <= params.w0 ? 'WINDOW_TOO_SHORT' : 'WINDOW_EXCLUDED_BY_PARAMS';
      return { ...base, classification_status: 'REFERENCE_ONLY', label: null, reason };
    }
    if (!timeExact) {
      return {
        ...base,
        classification_status: 'UNDETERMINED',
        label: 'UNDETERMINED',
        reason: 'RELEASE_TIME_NOT_EXACT',
      };
    }
    if (input.nowMs !== undefined) {
      const closedAtMs = releaseMs + minutes * MS_PER_MINUTE + (input.finalityMs ?? 0);
      if (closedAtMs > input.nowMs) {
        return { ...base, classification_status: 'PENDING', label: null, reason: null };
      }
    }
    const result = classifyWindow(path, sigma, minutes, params, timeExact);
    if (result.label === 'UNDETERMINED') {
      return { ...base, classification_status: 'UNDETERMINED', label: 'UNDETERMINED', reason: result.reason };
    }
    return {
      minutes,
      classification_status: 'CLASSIFIED',
      label: result.label,
      reason: null,
      evidence: evidenceOf(result, pipSize),
    };
  });

  return {
    baseline,
    sigmaPips: {
      sigma: sigma === null ? null : sigma / pipSize,
      own: baseline.own === null ? null : baseline.own / pipSize,
      typical: baseline.typical === null ? null : baseline.typical / pipSize,
    },
    initial,
    preReleasePrice: c0,
    barsAsOfMs,
    windows,
  };
}
