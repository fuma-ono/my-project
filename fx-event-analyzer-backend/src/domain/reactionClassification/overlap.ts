import type { OverlapImportance } from './params.js';
import { MS_PER_MINUTE } from './time.js';

/**
 * Other scheduled items that overlap a window (owner decision B: label + overlap flag + list). A label is returned
 * even when something overlaps; the list is a fact ("another item was scheduled inside the window"), not a verdict
 * that it caused the move. "No overlap" means none in the recorded calendars, which are not exhaustive.
 */
export interface OverlapCandidate {
  kind: 'EVENT' | 'SPEECH';
  id: string;
  name?: string;
  datetimeMs: number;
  currency: string;
  importance: 'LOW' | 'MEDIUM' | 'HIGH';
  /** True when the scheduled time itself is not firm (non-EXACT event time, or a speech known only by its publication time). */
  timeUncertain: boolean;
  /** economic_events.id of an EVENT candidate; candidates in the target's own simultaneous-release group are excluded (same path). */
  eventId?: string;
}

export interface OverlapItem {
  kind: 'EVENT' | 'SPEECH';
  id: string;
  name?: string;
  datetime: string;
  currency: string;
  importance: 'MEDIUM' | 'HIGH';
  offset_minutes: number;
  time_uncertain: boolean;
}

const RANK: Record<string, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 };

function toItem(c: OverlapCandidate, releaseMs: number): OverlapItem {
  return {
    kind: c.kind,
    id: c.id,
    ...(c.name === undefined ? {} : { name: c.name }),
    datetime: new Date(c.datetimeMs).toISOString(),
    currency: c.currency,
    importance: c.importance === 'HIGH' ? 'HIGH' : 'MEDIUM',
    offset_minutes: Math.round((c.datetimeMs - releaseMs) / MS_PER_MINUTE),
    time_uncertain: c.timeUncertain,
  };
}

function byTimeThenId(a: OverlapItem, b: OverlapItem): number {
  return a.datetime < b.datetime ? -1 : a.datetime > b.datetime ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Candidates that matter for the pair: currency is one of the pair's, importance at least `minImportance`, not in the target's own group. */
export function relevantCandidates(
  candidates: readonly OverlapCandidate[],
  pairCurrencies: readonly string[],
  minImportance: OverlapImportance,
  excludeEventIds: ReadonlySet<string>,
): OverlapCandidate[] {
  return candidates.filter(
    (c) =>
      pairCurrencies.includes(c.currency) &&
      (RANK[c.importance] ?? 0) >= (RANK[minImportance] ?? 0) &&
      !(c.eventId !== undefined && excludeEventIds.has(c.eventId)),
  );
}

/** Items inside (T, T + minutes]: strictly after the release, up to and including the window end. */
export function overlapsInWindow(
  candidates: readonly OverlapCandidate[],
  releaseMs: number,
  minutes: number,
): OverlapItem[] {
  const endMs = releaseMs + minutes * MS_PER_MINUTE;
  return candidates
    .filter((c) => c.datetimeMs > releaseMs && c.datetimeMs <= endMs)
    .map((c) => toItem(c, releaseMs))
    .sort(byTimeThenId);
}

/** Items inside (T - lookbackMinutes, T): they can contaminate the baseline window sigma_own. */
export function overlapsBeforeRelease(
  candidates: readonly OverlapCandidate[],
  releaseMs: number,
  lookbackMinutes: number,
): OverlapItem[] {
  const startMs = releaseMs - lookbackMinutes * MS_PER_MINUTE;
  return candidates
    .filter((c) => c.datetimeMs > startMs && c.datetimeMs < releaseMs)
    .map((c) => toItem(c, releaseMs))
    .sort(byTimeThenId);
}
