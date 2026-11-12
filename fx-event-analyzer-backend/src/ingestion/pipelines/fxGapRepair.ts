/**
 * FX gap repair planning (data-sources.md §6.4) — PURE functions only; the
 * I/O lives in pipelines/fxPrices.ts (ingestFxWithGapRepair).
 *
 * Each run looks at every open-market minute of the last
 * `repairHorizonDays` (not only "after the newest stored candle"), so a
 * hole anywhere in the past week is found again on every run until it is
 * filled. Closed-market minutes (marketHours.ts) and minutes newer than
 * now − finalityLagMinutes are never "missing". Request windows:
 *   - never contain a closed-market minute (split at weekends / closed days),
 *   - span at most maxWindowMinutes (response never truncated),
 *   - merge neighbouring gaps of the same session (fewer credits),
 *   - per pair: FORWARD (newest data, ending now) first, then REPAIR
 *     windows newest-first; pairs take turns (round-robin) up to
 *     min(perRunRequestCap, credits left today).
 * Nothing that cannot be fetched now is dropped silently: it is reported as
 * "unrecovered" with a reason. No reason means "permanently missing" — every
 * label is 未回収 (not yet recovered / not confirmed).
 */
import type { FxFetchSettings } from '../config.js';
import { CreditBudgetExceededError, HttpError } from '../http.js';
import { floorMinute, isFxMarketOpen, MINUTE_MS, missingMarketIntervals, type MinuteInterval } from '../marketHours.js';
import type { FxIngestionLogSample } from '../store.js';

const DAY_MS = 86_400_000;

export type FetchKind = 'FORWARD' | 'REPAIR';
/** OK, or why the request window did not deliver (BUDGET = not sent). */
export type RequestOutcome = 'OK' | 'RATE_LIMITED' | 'TIMEOUT' | 'API_ERROR' | 'BUDGET';
export type UnrecoveredReason =
  'BEYOND_HORIZON' | 'BUDGET' | 'RATE_LIMITED' | 'TIMEOUT' | 'API_ERROR' | 'NO_DATA_UNCONFIRMED';

/** Display labels (Japanese). None of them means "permanently unrecoverable". */
/** 表示名(HQ判断 2026-10-16)。データ品質レポート(quality/report.ts の MISSING_CAUSE_LABELS)と同じ文言。「回収不能」とは書かない。 */
export const UNRECOVERED_REASON_LABELS: Record<UnrecoveredReason, string> = {
  BEYOND_HORIZON: '未回収(回収期間外・7日超)',
  BUDGET: '未回収(クレジット上限)',
  RATE_LIMITED: '未回収(レート制限)',
  TIMEOUT: '未回収(タイムアウト)',
  API_ERROR: '未回収(APIエラー)',
  NO_DATA_UNCONFIRMED: '取得元にデータなしの可能性(未確認)',
};

export interface PlannedRequest {
  symbol: string;
  kind: FetchKind;
  /** ms, inclusive (minute aligned). */
  from: number;
  /** ms, exclusive. */
  to: number;
}

/** "This interval was fetched OK on `day` (UTC) and still had no data." */
export interface NoDataRecord extends MinuteInterval {
  day: string;
}

export interface PairPlanInput {
  symbol: string;
  /** Earliest stored 1m minute (ingestion start), or null on the very first run. */
  firstMinute: number | null;
  /** Stored 1m minutes over presentReadRange(). */
  present: ReadonlySet<number>;
  noDataHistory?: readonly NoDataRecord[];
}

export interface PlanInput {
  now: number;
  pairs: readonly PairPlanInput[];
  /** min(perRunRequestCap, credits left today). ≤ 0 → no requests at all. */
  maxRequests: number;
  settings: FxFetchSettings;
  /** Manual override of the FORWARD window (capped at maxWindowMinutes). */
  forwardMinutes?: number;
}

export interface PairPlan {
  symbol: string;
  /** Missing minutes are looked for in [horizonStart, finalEnd). */
  horizonStart: number;
  finalEnd: number;
  /** Missing intervals older than the horizon (reported only). */
  beyond: MinuteInterval[];
  /** NO_DATA_UNCONFIRMED minutes not requested this run (retried enough / already tried today). */
  held: ReadonlySet<number>;
  /** Prior UTC days on which each minute came back empty. */
  noDataDays: ReadonlyMap<number, ReadonlySet<string>>;
  windows: PlannedRequest[];
}

export interface FxFetchPlan {
  /** In execution order (round-robin across pairs). */
  requests: PlannedRequest[];
  /** Planned but over the request limit of this run (→ BUDGET). */
  unscheduled: PlannedRequest[];
  pairs: Map<string, PairPlan>;
}

export function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Range over which the job reads stored 1m minutes of a pair (horizon + the BEYOND_HORIZON report band). */
export function presentReadRange(now: number, firstMinute: number | null, settings: FxFetchSettings): MinuteInterval {
  const to = floorMinute(now);
  const from = to - (settings.repairHorizonDays + settings.beyondHorizonReportDays) * DAY_MS;
  return { from: firstMinute === null ? to : Math.max(from, floorMinute(firstMinute)), to };
}

/** Contiguous open-market ranges in [fromMs, toMs). */
export function openSessions(fromMs: number, toMs: number): MinuteInterval[] {
  const sessions: MinuteInterval[] = [];
  let current: MinuteInterval | null = null;
  for (let ms = floorMinute(fromMs); ms < floorMinute(toMs); ms += MINUTE_MS) {
    if (!isFxMarketOpen(ms)) {
      current = null;
      continue;
    }
    if (current) current.to = ms + MINUTE_MS;
    else {
      current = { from: ms, to: ms + MINUTE_MS };
      sessions.push(current);
    }
  }
  return sessions;
}

function sessionIndex(sessions: readonly MinuteInterval[], ms: number): number {
  let lo = 0;
  let hi = sessions.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const s = sessions[mid]!;
    if (ms < s.from) hi = mid - 1;
    else if (ms >= s.to) lo = mid + 1;
    else return mid;
  }
  return -1;
}

function noDataDaysByMinute(history: readonly NoDataRecord[]): Map<number, Set<string>> {
  const days = new Map<number, Set<string>>();
  const seen = new Set<string>();
  for (const record of history) {
    const key = `${record.from}|${record.to}|${record.day}`;
    if (seen.has(key)) continue;
    seen.add(key);
    for (let ms = record.from; ms < record.to; ms += MINUTE_MS) {
      const set = days.get(ms) ?? new Set<string>();
      set.add(record.day);
      days.set(ms, set);
    }
  }
  return days;
}

interface OpenWindow extends PlannedRequest {
  session: number;
}

/**
 * Greedy, newest-first: one window grows backwards over older gaps of the
 * same session while its span stays ≤ maxMs; a longer gap is split.
 */
function buildWindows(
  symbol: string,
  missing: readonly MinuteInterval[],
  forward: PlannedRequest | null,
  sessions: readonly MinuteInterval[],
  maxMs: number,
): PlannedRequest[] {
  const windows: PlannedRequest[] = [];
  let cur: OpenWindow | null = forward ? { ...forward, session: sessionIndex(sessions, forward.from) } : null;
  const close = () => {
    if (cur) windows.push({ symbol, kind: cur.kind, from: cur.from, to: cur.to });
    cur = null;
  };
  for (let i = missing.length - 1; i >= 0; i -= 1) {
    const interval = missing[i]!;
    const session = sessionIndex(sessions, interval.from);
    let end = interval.to;
    while (end > interval.from) {
      if (cur && cur.session !== session) close();
      if (!cur) {
        const from = Math.max(interval.from, end - maxMs);
        cur = { symbol, kind: 'REPAIR', from, to: end, session };
        end = from;
        continue;
      }
      if (end > cur.from) {
        end = cur.from;
        continue;
      }
      const lowest = cur.to - maxMs;
      if (lowest < end) {
        cur.from = Math.max(interval.from, lowest);
        end = cur.from;
      } else {
        close();
      }
    }
  }
  close();
  return windows;
}

export function planFxFetches(input: PlanInput): FxFetchPlan {
  const { settings } = input;
  const nowMin = floorMinute(input.now);
  const finalEnd = floorMinute(input.now - settings.finalityLagMinutes * MINUTE_MS);
  const horizonFloor = nowMin - settings.repairHorizonDays * DAY_MS;
  const maxMs = settings.maxWindowMinutes * MINUTE_MS;
  const forwardMs = Math.min(input.forwardMinutes ?? settings.forwardMinutes, settings.maxWindowMinutes) * MINUTE_MS;
  const today = utcDay(input.now);
  const sessions = openSessions(Math.min(horizonFloor, nowMin - forwardMs), nowMin);

  // FORWARD: the newest part of [now − forward, now) inside one open session.
  let forwardRange: MinuteInterval | null = null;
  for (let i = sessions.length - 1; i >= 0; i -= 1) {
    const s = sessions[i]!;
    if (s.to <= nowMin - forwardMs) break;
    if (s.from < nowMin) {
      forwardRange = { from: Math.max(nowMin - forwardMs, s.from), to: Math.min(nowMin, s.to) };
      break;
    }
  }

  const pairs = new Map<string, PairPlan>();
  for (const pair of input.pairs) {
    const forward: PlannedRequest | null = forwardRange
      ? { symbol: pair.symbol, kind: 'FORWARD', ...forwardRange }
      : null;
    if (pair.firstMinute === null) {
      // First run ever for this pair: nothing before it is "missing" (it is before ingestion start).
      pairs.set(pair.symbol, {
        symbol: pair.symbol,
        horizonStart: forward?.from ?? nowMin,
        finalEnd,
        beyond: [],
        held: new Set(),
        noDataDays: new Map(),
        windows: forward ? [forward] : [],
      });
      continue;
    }
    const first = floorMinute(pair.firstMinute);
    const horizonStart = Math.max(horizonFloor, first);
    const read = presentReadRange(input.now, first, settings);
    const beyond = first < horizonFloor ? missingMarketIntervals(read.from, horizonFloor, pair.present) : [];

    const noDataDays = noDataDaysByMinute(pair.noDataHistory ?? []);
    const held = new Set<number>();
    for (const [ms, days] of noDataDays) {
      if (days.size >= 1 + settings.noDataRetryDays || days.has(today)) held.add(ms);
    }
    const known = held.size === 0 ? pair.present : new Set([...pair.present, ...held]);
    const missing = missingMarketIntervals(horizonStart, finalEnd, known);
    pairs.set(pair.symbol, {
      symbol: pair.symbol,
      horizonStart,
      finalEnd,
      beyond,
      held,
      noDataDays,
      windows: buildWindows(pair.symbol, missing, forward, sessions, maxMs),
    });
  }

  const requests: PlannedRequest[] = [];
  const unscheduled: PlannedRequest[] = [];
  const queues = [...pairs.values()].map((p) => p.windows);
  const rounds = Math.max(0, ...queues.map((q) => q.length));
  for (let round = 0; round < rounds; round += 1) {
    for (const queue of queues) {
      const window = queue[round];
      if (!window) continue;
      if (requests.length < input.maxRequests) requests.push(window);
      else unscheduled.push(window);
    }
  }
  return { requests, unscheduled, pairs };
}

/** What a failed fetch means for the window. */
export function classifyFetchError(error: unknown): Exclude<RequestOutcome, 'OK'> {
  if (error instanceof CreditBudgetExceededError) return 'BUDGET';
  if (error instanceof HttpError) {
    if (error.status === 429) return 'RATE_LIMITED';
    if (error.kind === 'TIMEOUT') return 'TIMEOUT';
    return 'API_ERROR';
  }
  // Twelve Data reports quota errors as HTTP 200 { status: "error", code: 429 } (adapters/twelveData.ts).
  const message = error instanceof Error ? error.message : String(error);
  if (/^twelvedata \S+: 429\b/.test(message)) return 'RATE_LIMITED';
  return 'API_ERROR';
}

export interface ExecutedWindow {
  request: PlannedRequest;
  outcome: RequestOutcome;
}

export interface UnrecoveredInterval {
  symbol: string;
  from: string;
  to: string;
  minutes: number;
  reason: UnrecoveredReason;
}

function mergeMinutes(
  symbol: string,
  minutes: readonly { ms: number; reason: UnrecoveredReason }[],
): UnrecoveredInterval[] {
  const result: UnrecoveredInterval[] = [];
  let current: { from: number; to: number; reason: UnrecoveredReason; minutes: number } | null = null;
  const flush = () => {
    if (current) {
      result.push({
        symbol,
        from: new Date(current.from).toISOString(),
        to: new Date(current.to).toISOString(),
        minutes: current.minutes,
        reason: current.reason,
      });
    }
  };
  for (const { ms, reason } of minutes) {
    if (current && current.to === ms && current.reason === reason) {
      current.to = ms + MINUTE_MS;
      current.minutes += 1;
    } else {
      flush();
      current = { from: ms, to: ms + MINUTE_MS, reason, minutes: 1 };
    }
  }
  flush();
  return result;
}

/**
 * Every minute still missing after the run gets exactly one reason:
 * older than the horizon → BEYOND_HORIZON; inside a window that was sent →
 * the window's outcome (OK but still empty → NO_DATA_UNCONFIRMED); held back
 * because of earlier empty answers → NO_DATA_UNCONFIRMED; otherwise not
 * requested (over the limit / stopped) → BUDGET.
 */
export function classifyUnrecovered(
  plan: PairPlan,
  presentAfter: ReadonlySet<number>,
  executed: readonly ExecutedWindow[],
): UnrecoveredInterval[] {
  const result: UnrecoveredInterval[] = [];
  for (const interval of plan.beyond) {
    result.push({
      symbol: plan.symbol,
      from: new Date(interval.from).toISOString(),
      to: new Date(interval.to).toISOString(),
      minutes: (interval.to - interval.from) / MINUTE_MS,
      reason: 'BEYOND_HORIZON',
    });
  }
  const minutes: { ms: number; reason: UnrecoveredReason }[] = [];
  for (const interval of missingMarketIntervals(plan.horizonStart, plan.finalEnd, presentAfter)) {
    for (let ms = interval.from; ms < interval.to; ms += MINUTE_MS) {
      const window = executed.find((w) => w.request.from <= ms && ms < w.request.to);
      let reason: UnrecoveredReason;
      if (window) reason = window.outcome === 'OK' ? 'NO_DATA_UNCONFIRMED' : window.outcome;
      else reason = plan.held.has(ms) ? 'NO_DATA_UNCONFIRMED' : 'BUDGET';
      minutes.push({ ms, reason });
    }
  }
  result.push(...mergeMinutes(plan.symbol, minutes));
  return result;
}

export interface NoDataInterval {
  from: string;
  to: string;
  minutes: number;
  /** How many UTC days (this one included) the interval has come back empty. */
  attempt: number;
}

/** Minutes still missing inside the windows that came back OK in this run. */
export function noDataAfterRun(
  plan: PairPlan,
  presentAfter: ReadonlySet<number>,
  executed: readonly ExecutedWindow[],
): NoDataInterval[] {
  const result: NoDataInterval[] = [];
  for (const { request, outcome } of executed) {
    if (outcome !== 'OK') continue;
    const end = Math.min(request.to, plan.finalEnd);
    for (const interval of missingMarketIntervals(request.from, end, presentAfter)) {
      let attempt = 1;
      for (let ms = interval.from; ms < interval.to; ms += MINUTE_MS) {
        attempt = Math.max(attempt, 1 + (plan.noDataDays.get(ms)?.size ?? 0));
      }
      result.push({
        from: new Date(interval.from).toISOString(),
        to: new Date(interval.to).toISOString(),
        minutes: (interval.to - interval.from) / MINUTE_MS,
        attempt,
      });
    }
  }
  return result;
}

/** details.no_data_unconfirmed of earlier ingest:fx-prices logs → per-symbol history (malformed entries ignored). */
export function noDataHistoryFromLogs(logs: readonly FxIngestionLogSample[]): Map<string, NoDataRecord[]> {
  const history = new Map<string, NoDataRecord[]>();
  for (const log of logs) {
    const started = Date.parse(log.started_at);
    const value = log.details.no_data_unconfirmed;
    if (Number.isNaN(started) || !value || typeof value !== 'object' || Array.isArray(value)) continue;
    const day = utcDay(started);
    for (const [symbol, list] of Object.entries(value as Record<string, unknown>)) {
      if (!Array.isArray(list)) continue;
      for (const item of list as unknown[]) {
        const { from, to } = (item ?? {}) as { from?: unknown; to?: unknown };
        const fromMs = typeof from === 'string' ? Date.parse(from) : NaN;
        const toMs = typeof to === 'string' ? Date.parse(to) : NaN;
        if (Number.isNaN(fromMs) || Number.isNaN(toMs) || toMs <= fromMs) continue;
        const records = history.get(symbol) ?? [];
        records.push({ from: floorMinute(fromMs), to: floorMinute(toMs), day });
        history.set(symbol, records);
      }
    }
  }
  return history;
}
