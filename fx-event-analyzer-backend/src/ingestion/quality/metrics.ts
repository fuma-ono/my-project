/**
 * Data-quality metrics (HQ判断 2026-10-16: 取得率・欠損率・照合一致率・時刻ずれを
 * 実データで測る)。PURE functions only — no I/O, no clock: the job
 * (src/jobs/reportDataQuality.ts) reads the rows (quality/reader.ts) and
 * passes `now` in, so every number here is reproducible in unit tests.
 *
 * Times are epoch milliseconds (UTC) internally; fx_prices.timestamp is
 * the candle OPEN time (db-design.md §3.11). Periods are half-open
 * [from, to) and minute-aligned.
 *
 * Market hours come from ../marketHours.ts (New York 17:00 Sun → 17:00 Fri,
 * DST-aware, Dec 25 / Jan 1 closed) — the same definition the gap repair
 * uses, so "missing" means the same thing in both.
 *
 * Zero denominators are returned as null (never as 0 %); the renderer
 * shows them as 「—(理由)」. "No data" and "the check never ran" are
 * reported as states, not as zero counts (HQ 2026-10-16 C-5/C-6).
 */
import { floorMinute, isFxMarketOpen, marketMinutes, missingMarketIntervals, MINUTE_MS } from '../marketHours.js';
import type { MinuteInterval } from '../marketHours.js';
import type { FxPriceRow, IngestionLogRow, StagedVerificationStatus } from '../store.js';

/** Minutes around a release that reactions need: open times [T − 5 min, T + 60 min). */
export const RELEASE_WINDOW_MINUTES = { before: 5, after: 60 } as const;

/** ingest:fx-prices fetches (at least) the last 120 minutes on every run (src/jobs/ingestFxPrices.ts). */
export const FX_INGEST_WINDOW_MINUTES = 120;

export const FX_INGEST_JOB = 'ingest:fx-prices';
/** ingest:official and ingest:official:reverify — the jobs that compare economic values with official statistics. */
export const OFFICIAL_JOB_PREFIX = 'ingest:official';

/** Twelve Data Basic (free) plan: 800 requests per UTC day. */
export const API_DAILY_LIMIT = 800;
/** Our own daily budget below the plan limit, used when the logs do not record budget.daily. */
export const API_DAILY_BUDGET_DEFAULT = 700;

export interface Period {
  from: number;
  to: number;
}

const ratio = (numerator: number, denominator: number): number | null =>
  denominator === 0 ? null : numerator / denominator;

// ---------------------------------------------------------------------------
// ingestion_logs.details parsing (every key optional — older rows lack them)
// ---------------------------------------------------------------------------

/** The ingestion_logs columns the report reads (job is null in rows from before migration 20261015000003). */
export interface IngestionLogSample {
  job: string | null;
  provider: string;
  data_type: IngestionLogRow['data_type'];
  started_at: string;
  completed_at: string | null;
  status: IngestionLogRow['status'];
  details: Record<string, unknown> | null;
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const asNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

/** ISO string or epoch ms → ms; anything else → null. */
function asTime(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

interface SymbolInterval extends MinuteInterval {
  symbol: string;
  reason: string | null;
}

function parseInterval(entry: unknown, symbol: string | null): SymbolInterval | null {
  const record = asRecord(entry);
  if (!record) return null;
  const sym = symbol ?? (typeof record.symbol === 'string' ? record.symbol : null);
  const from = asTime(record.from);
  const to = asTime(record.to);
  if (sym === null || from === null || to === null || to <= from) return null;
  return { symbol: sym, from, to, reason: typeof record.reason === 'string' ? record.reason : null };
}

/**
 * Parses `[{symbol, from, to, reason?}]` or `{SYMBOL: [{from, to, …}]}` (the
 * shape of details.no_data_unconfirmed); malformed entries are ignored.
 * `to` is exclusive (the pipeline writes the end of the last minute).
 */
function symbolIntervals(value: unknown): SymbolInterval[] {
  const parsed: (SymbolInterval | null)[] = [];
  if (Array.isArray(value)) {
    for (const entry of value) parsed.push(parseInterval(entry, null));
  } else {
    for (const [symbol, list] of Object.entries(asRecord(value) ?? {})) {
      if (Array.isArray(list)) for (const entry of list) parsed.push(parseInterval(entry, symbol));
    }
  }
  return parsed.filter((i): i is SymbolInterval => i !== null);
}

const byStartedAt = (a: IngestionLogSample, b: IngestionLogSample): number =>
  Date.parse(a.started_at) - Date.parse(b.started_at);

const fxLogs = (logs: readonly IngestionLogSample[]): IngestionLogSample[] =>
  logs.filter((log) => log.job === FX_INGEST_JOB).sort(byStartedAt);

/**
 * Causes of missing 1m minutes as written by ingest:fx-prices
 * (details.unrecovered[].reason / details.no_data_unconfirmed). UNKNOWN =
 * no log evidence (未取得・原因未特定).
 */
export const MISSING_CAUSES = [
  'NO_DATA_UNCONFIRMED',
  'BEYOND_HORIZON',
  'BUDGET',
  'RATE_LIMITED',
  'TIMEOUT',
  'API_ERROR',
  'UNKNOWN',
] as const;
export type MissingCause = (typeof MISSING_CAUSES)[number];

const UNRECOVERED_REASONS: ReadonlySet<string> = new Set(MISSING_CAUSES.filter((c) => c !== 'UNKNOWN'));

/** Known causes of missing 1m minutes for one pair, from the ingest:fx-prices logs. */
export interface MissingCauses {
  /**
   * details.no_data_unconfirmed of every run (the older key provider_empty
   * is read the same way) + unrecovered with reason NO_DATA_UNCONFIRMED of
   * the latest run: the provider may have no candles (not confirmed).
   */
  noDataUnconfirmed: MinuteInterval[];
  /** details.unrecovered of the latest run that recorded the key, by reason (except NO_DATA_UNCONFIRMED) */
  unrecovered: { reason: Exclude<MissingCause, 'NO_DATA_UNCONFIRMED' | 'UNKNOWN'>; interval: MinuteInterval }[];
}

export function extractMissingCauses(logs: readonly IngestionLogSample[]): Map<string, MissingCauses> {
  const result = new Map<string, MissingCauses>();
  const of = (symbol: string): MissingCauses => {
    const existing = result.get(symbol);
    if (existing) return existing;
    const created: MissingCauses = { noDataUnconfirmed: [], unrecovered: [] };
    result.set(symbol, created);
    return created;
  };
  const runs = fxLogs(logs);
  for (const run of runs) {
    for (const key of ['no_data_unconfirmed', 'provider_empty']) {
      for (const i of symbolIntervals(run.details?.[key])) of(i.symbol).noDataUnconfirmed.push(i);
    }
  }
  const latest = [...runs].reverse().find((run) => Array.isArray(run.details?.unrecovered));
  for (const i of symbolIntervals(latest?.details?.unrecovered)) {
    if (i.reason === 'NO_DATA_UNCONFIRMED') of(i.symbol).noDataUnconfirmed.push(i);
    else if (i.reason !== null && UNRECOVERED_REASONS.has(i.reason)) {
      of(i.symbol).unrecovered.push({
        reason: i.reason as MissingCauses['unrecovered'][number]['reason'],
        interval: { from: i.from, to: i.to },
      });
    }
  }
  return result;
}

const inInterval = (ms: number, i: MinuteInterval): boolean => ms >= i.from && ms < i.to;

/** no_data_unconfirmed first, then the latest run's unrecovered reason, else UNKNOWN. */
export function classifyMissingMinute(ms: number, causes: MissingCauses): MissingCause {
  if (causes.noDataUnconfirmed.some((i) => inInterval(ms, i))) return 'NO_DATA_UNCONFIRMED';
  return causes.unrecovered.find((u) => inInterval(ms, u.interval))?.reason ?? 'UNKNOWN';
}

// ---------------------------------------------------------------------------
// FX completeness
// ---------------------------------------------------------------------------

/** The fx_prices columns the report reads. */
export interface FxRowSample {
  timestamp: string;
  timeframe: FxPriceRow['timeframe'];
  verification_status: FxPriceRow['verification_status'];
  cross_check_diff_pips: number | null;
}

export interface Gap {
  /** ISO open time of the first missing minute. */
  start: string;
  minutes: number;
}

export interface AggregateCoverage {
  timeframe: Exclude<FxPriceRow['timeframe'], '1m'>;
  /** (a) Buckets whose 1m minutes are all present and none UNVERIFIED (= the pipeline could build them). */
  eligibleBuckets: number;
  /** Of those, buckets that have a row of this timeframe. */
  presentBuckets: number;
  /** (a) 作成可能区間での成功率 = presentBuckets ÷ eligibleBuckets */
  successRate: number | null;
  /** (b) Buckets fully inside [max(period.from, ingestion start), period.to) whose minutes are all open-market. */
  expectedBuckets: number;
  /** Of those, buckets that have a row of this timeframe. */
  presentExpectedBuckets: number;
  /** (b) 評価期間全体に対するカバレッジ = presentExpectedBuckets ÷ expectedBuckets */
  coverageRate: number | null;
}

/**
 * OK: ingestion started before period.to.
 * NO_DATA: no 1m candle stored at all (取り込み未開始).
 * STARTED_AFTER_PERIOD: the first candle is at or after period.to.
 */
export type FxDataState = 'OK' | 'NO_DATA' | 'STARTED_AFTER_PERIOD';

/** Missing minutes per cause (see MISSING_CAUSES; UNKNOWN = 未取得・原因未特定). */
export type MissingBreakdown = Record<MissingCause, number>;

export const emptyBreakdown = (): MissingBreakdown =>
  Object.fromEntries(MISSING_CAUSES.map((c) => [c, 0])) as MissingBreakdown;

export interface FxCompleteness {
  symbol: string;
  state: FxDataState;
  /** ISO open time of the earliest stored 1m candle (null = none) */
  ingestionStart: string | null;
  /** open-market minutes in [period.from, ingestion start) — not judged (取り込み開始前・対象外) */
  beforeStartMinutes: number;
  /** open-market minutes in [max(period.from, ingestion start), period.to) */
  expectedMinutes: number;
  presentMinutes: number;
  /** expected − present = real gaps */
  missingMinutes: number;
  missingRate: number | null;
  missingBreakdown: MissingBreakdown;
  /** present minutes not UNVERIFIED (= usable for reactions) */
  usableMinutes: number;
  /** 1m rows in the period but outside market hours (not counted as present). */
  outsideMarketRows: number;
  longestGaps: Gap[];
  status: Record<FxPriceRow['verification_status'], number>;
  /** 1m rows with a cross-check value (cross_check_diff_pips not null). */
  crossChecked: number;
  /** VERIFIED / cross-checked rows. null = nothing compared. */
  agreementRate: number | null;
  maxAbsDiffPips: number | null;
  aggregates: AggregateCoverage[];
  /** ISO open time of the newest 1m row seen (any time, also after the period). */
  latestCandleOpen: string | null;
}

const AGGREGATES = [
  { timeframe: '5m', minutes: 5 },
  { timeframe: '15m', minutes: 15 },
  { timeframe: '30m', minutes: 30 },
  { timeframe: '60m', minutes: 60 },
] as const;

export const TOP_GAPS = 5;

function topGaps(intervals: readonly MinuteInterval[], limit: number): Gap[] {
  return intervals
    .map((i) => ({ start: i.from, minutes: (i.to - i.from) / MINUTE_MS }))
    .sort((a, b) => b.minutes - a.minutes || a.start - b.start)
    .slice(0, limit)
    .map((gap) => ({ start: new Date(gap.start).toISOString(), minutes: gap.minutes }));
}

/**
 * Gaps are runs of consecutive open-market minutes without a 1m row; a
 * closed-market minute ends a gap (a gap never spans the weekend).
 * Sorted by length desc, then start asc; at most `limit`.
 */
export function findGaps(present: ReadonlySet<number>, period: Period, limit = TOP_GAPS): Gap[] {
  return topGaps(missingMarketIntervals(period.from, period.to, present), limit);
}

export interface FxCompletenessOptions {
  /**
   * ISO open time of the earliest stored 1m candle of the pair (any time).
   * undefined → the earliest 1m row in `rows`; null → none stored. The
   * earlier of this and the earliest row in `rows` is used.
   */
  firstCandleAt?: string | null | undefined;
  causes?: MissingCauses | undefined;
}

export function computeFxCompleteness(
  symbol: string,
  rows: readonly FxRowSample[],
  period: Period,
  options: FxCompletenessOptions = {},
): FxCompleteness {
  const minuteStatus = new Map<number, FxPriceRow['verification_status']>();
  const aggregated = new Map<string, Set<number>>();
  const status: FxCompleteness['status'] = { VERIFIED: 0, SINGLE_SOURCE: 0, UNVERIFIED: 0 };
  let outsideMarketRows = 0;
  let crossChecked = 0;
  let verifiedChecked = 0;
  let maxAbsDiffPips: number | null = null;
  let latest: number | null = null;
  let earliest: number | null = null;

  for (const row of rows) {
    const ms = Date.parse(row.timestamp);
    if (row.timeframe === '1m') {
      if (latest === null || ms > latest) latest = ms;
      if (earliest === null || ms < earliest) earliest = ms;
    }
    if (ms < period.from || ms >= period.to) continue;
    if (row.timeframe !== '1m') {
      const set = aggregated.get(row.timeframe) ?? new Set<number>();
      set.add(ms);
      aggregated.set(row.timeframe, set);
      continue;
    }
    if (!isFxMarketOpen(ms)) {
      outsideMarketRows += 1;
      continue;
    }
    minuteStatus.set(ms, row.verification_status);
    status[row.verification_status] += 1;
    if (row.cross_check_diff_pips !== null) {
      crossChecked += 1;
      if (row.verification_status === 'VERIFIED') verifiedChecked += 1;
      const diff = Math.abs(Number(row.cross_check_diff_pips));
      if (maxAbsDiffPips === null || diff > maxAbsDiffPips) maxAbsDiffPips = diff;
    }
  }

  const given = options.firstCandleAt ? Date.parse(options.firstCandleAt) : null;
  const start = given === null ? earliest : earliest === null ? given : Math.min(given, earliest);
  const state: FxDataState = start === null ? 'NO_DATA' : start >= period.to ? 'STARTED_AFTER_PERIOD' : 'OK';
  const judgedFrom = state === 'OK' ? Math.max(period.from, floorMinute(start!)) : period.to;

  const beforeStartMinutes = marketMinutes(period.from, judgedFrom).length;
  const expectedMinutes = marketMinutes(judgedFrom, period.to).length;
  const presentSet = new Set(minuteStatus.keys());
  const presentMinutes = presentSet.size;
  const intervals = missingMarketIntervals(judgedFrom, period.to, presentSet);
  const missingMinutes = intervals.reduce((sum, i) => sum + (i.to - i.from) / MINUTE_MS, 0);

  const missingBreakdown = emptyBreakdown();
  const causes = options.causes ?? { noDataUnconfirmed: [], unrecovered: [] };
  for (const interval of intervals) {
    for (let ms = interval.from; ms < interval.to; ms += MINUTE_MS) {
      missingBreakdown[classifyMissingMinute(ms, causes)] += 1;
    }
  }

  const aggregates = AGGREGATES.map(({ timeframe, minutes }): AggregateCoverage => {
    const bucketMs = minutes * MINUTE_MS;
    const present = aggregated.get(timeframe) ?? new Set<number>();
    let eligibleBuckets = 0;
    let presentBuckets = 0;
    let expectedBuckets = 0;
    let presentExpectedBuckets = 0;
    for (let b = Math.ceil(judgedFrom / bucketMs) * bucketMs; b + bucketMs <= period.to; b += bucketMs) {
      let allOpen = true;
      let complete = true;
      for (let ms = b; ms < b + bucketMs; ms += MINUTE_MS) {
        if (!isFxMarketOpen(ms)) {
          allOpen = false;
          break;
        }
        const s = minuteStatus.get(ms);
        if (s === undefined || s === 'UNVERIFIED') complete = false;
      }
      if (!allOpen) continue;
      expectedBuckets += 1;
      if (present.has(b)) presentExpectedBuckets += 1;
      if (!complete) continue;
      eligibleBuckets += 1;
      if (present.has(b)) presentBuckets += 1;
    }
    return {
      timeframe,
      eligibleBuckets,
      presentBuckets,
      successRate: ratio(presentBuckets, eligibleBuckets),
      expectedBuckets,
      presentExpectedBuckets,
      coverageRate: ratio(presentExpectedBuckets, expectedBuckets),
    };
  });

  return {
    symbol,
    state,
    ingestionStart: start === null ? null : new Date(start).toISOString(),
    beforeStartMinutes,
    expectedMinutes,
    presentMinutes,
    missingMinutes,
    missingRate: ratio(missingMinutes, expectedMinutes),
    missingBreakdown,
    usableMinutes: presentMinutes - status.UNVERIFIED,
    outsideMarketRows,
    longestGaps: topGaps(intervals, TOP_GAPS),
    status,
    crossChecked,
    agreementRate: ratio(verifiedChecked, crossChecked),
    maxAbsDiffPips,
    aggregates,
    latestCandleOpen: latest === null ? null : new Date(latest).toISOString(),
  };
}

/** Minutes (open time, ms) of usable 1m rows: UNVERIFIED counts as missing, like the reactions. */
export function usableMinuteSet(rows: readonly FxRowSample[]): Set<number> {
  const set = new Set<number>();
  for (const row of rows) {
    if (row.timeframe === '1m' && row.verification_status !== 'UNVERIFIED') set.add(Date.parse(row.timestamp));
  }
  return set;
}

// ---------------------------------------------------------------------------
// Release windows
// ---------------------------------------------------------------------------

export interface ReleaseInstant {
  kind: 'ECONOMIC' | 'SPEECH';
  /** economic_events.release_datetime (RELEASED) / speech_events.statement_datetime (DELIVERED) */
  at: string;
  label: string;
}

export interface ReleaseWindowIssue {
  kind: ReleaseInstant['kind'];
  at: string;
  label: string;
  symbol: string;
  missingMinutes: number;
}

export interface ReleaseWindowCounts {
  /** releases / speeches in the input (= in the period) */
  instants: number;
  /** of those, instants judged for at least one pair (件数) */
  evaluatedInstants: number;
  /** instant × pair windows that were judged (通貨ペア別の判定件数) */
  windows: number;
  complete: number;
  incomplete: number;
  /** instant × pair windows not judged: the window touches the closed market */
  outsideMarket: number;
  /** … the window is not fully inside the period */
  outsidePeriod: number;
  /** … the window starts before the pair's first stored candle (or the pair has none) */
  beforeIngestionStart: number;
}

export interface ReleaseWindowSummary {
  /** number of pairs every instant is judged against */
  pairs: number;
  byKind: Record<ReleaseInstant['kind'], ReleaseWindowCounts>;
  /** incomplete windows, most missing minutes first (at most 20) */
  issues: ReleaseWindowIssue[];
}

const emptyCounts = (): ReleaseWindowCounts => ({
  instants: 0,
  evaluatedInstants: 0,
  windows: 0,
  complete: 0,
  incomplete: 0,
  outsideMarket: 0,
  outsidePeriod: 0,
  beforeIngestionStart: 0,
});

/**
 * For every instant × pair: does every 1m candle with open time in
 * [T − 5 min, T + 60 min) exist and is not UNVERIFIED? A non-minute-aligned
 * T is floored to the minute. Not judged (counted separately): window not
 * fully in the period, window touching the closed market, window starting
 * before the pair's ingestion start (`startBySymbol`; null = no data; a
 * pair missing from the map is not restricted).
 */
export function checkReleaseWindows(
  instants: readonly ReleaseInstant[],
  usableBySymbol: ReadonlyMap<string, ReadonlySet<number>>,
  period: Period,
  startBySymbol: ReadonlyMap<string, number | null> = new Map(),
): ReleaseWindowSummary {
  const byKind = { ECONOMIC: emptyCounts(), SPEECH: emptyCounts() };
  const issues: ReleaseWindowIssue[] = [];
  for (const instant of instants) {
    const t = floorMinute(Date.parse(instant.at));
    const start = t - RELEASE_WINDOW_MINUTES.before * MINUTE_MS;
    const end = t + RELEASE_WINDOW_MINUTES.after * MINUTE_MS;
    const counts = byKind[instant.kind];
    counts.instants += 1;
    let marketOpen = true;
    for (let ms = start; ms < end; ms += MINUTE_MS) {
      if (!isFxMarketOpen(ms)) {
        marketOpen = false;
        break;
      }
    }
    let judged = false;
    for (const [symbol, usable] of usableBySymbol) {
      if (start < period.from || end > period.to) {
        counts.outsidePeriod += 1;
        continue;
      }
      if (!marketOpen) {
        counts.outsideMarket += 1;
        continue;
      }
      const pairStart = startBySymbol.has(symbol) ? startBySymbol.get(symbol)! : -Infinity;
      if (pairStart === null || start < pairStart) {
        counts.beforeIngestionStart += 1;
        continue;
      }
      judged = true;
      counts.windows += 1;
      let missing = 0;
      for (let ms = start; ms < end; ms += MINUTE_MS) if (!usable.has(ms)) missing += 1;
      if (missing === 0) {
        counts.complete += 1;
      } else {
        counts.incomplete += 1;
        issues.push({ kind: instant.kind, at: instant.at, label: instant.label, symbol, missingMinutes: missing });
      }
    }
    if (judged) counts.evaluatedInstants += 1;
  }
  issues.sort((a, b) => b.missingMinutes - a.missingMinutes || Date.parse(a.at) - Date.parse(b.at));
  return { pairs: usableBySymbol.size, byKind, issues: issues.slice(0, 20) };
}

// ---------------------------------------------------------------------------
// Ingestion runs
// ---------------------------------------------------------------------------

export interface JobRunStats {
  job: string;
  runs: number;
  success: number;
  partial: number;
  failure: number;
  medianDurationSeconds: number | null;
  /** details.skip_reasons summed over the runs */
  skipReasons: Record<string, number>;
}

export function jobName(log: IngestionLogSample): string {
  return log.job ?? `(job未記録) ${log.data_type}:${log.provider}`;
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function numberRecord(raw: unknown): Record<string, number> {
  const record = asRecord(raw);
  if (!record) return {};
  const result: Record<string, number> = {};
  for (const [key, value] of Object.entries(record)) {
    const n = asNumber(value);
    if (n !== null) result[key] = n;
  }
  return result;
}

const skipReasonsOf = (log: IngestionLogSample): Record<string, number> => numberRecord(log.details?.skip_reasons);

export function summarizeRuns(logs: readonly IngestionLogSample[]): JobRunStats[] {
  const byJob = new Map<string, IngestionLogSample[]>();
  for (const log of logs) byJob.set(jobName(log), [...(byJob.get(jobName(log)) ?? []), log]);
  return [...byJob.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([job, runs]) => {
      const skipReasons: Record<string, number> = {};
      for (const run of runs) {
        for (const [reason, count] of Object.entries(skipReasonsOf(run))) {
          skipReasons[reason] = (skipReasons[reason] ?? 0) + count;
        }
      }
      const durations = runs
        .filter((run) => run.completed_at !== null)
        .map((run) => (Date.parse(run.completed_at!) - Date.parse(run.started_at)) / 1000);
      return {
        job,
        runs: runs.length,
        success: runs.filter((run) => run.status === 'SUCCESS').length,
        partial: runs.filter((run) => run.status === 'PARTIAL').length,
        failure: runs.filter((run) => run.status === 'FAILURE').length,
        medianDurationSeconds: median(durations),
        skipReasons,
      };
    });
}

export interface ScheduleGap {
  /** started_at of the earlier successful run */
  from: string;
  /** started_at of the next successful run */
  to: string;
  minutes: number;
  /** market-open minutes neither run's 120-minute window covered (= possibly lost) */
  uncoveredMarketMinutes: number;
}

export interface FxScheduleStats {
  successfulRuns: number;
  longestIntervalMinutes: number | null;
  longestInterval: { from: string; to: string } | null;
  /** intervals longer than the fetch window (at most 20, longest first) */
  gapsOverWindow: ScheduleGap[];
  /** now − started_at of the last successful run */
  minutesSinceLastSuccess: number | null;
}

/**
 * Intervals between consecutive SUCCESS runs of ingest:fx-prices (by
 * started_at). Each run re-fetches the last `windowMinutes`, so an interval
 * longer than that leaves [previous run, next run − window) uncovered;
 * only market-open minutes of that span can actually lose data.
 * PARTIAL runs are not counted as successful (some pairs failed).
 */
export function analyzeFxSchedule(
  logs: readonly IngestionLogSample[],
  now: number,
  windowMinutes = FX_INGEST_WINDOW_MINUTES,
): FxScheduleStats {
  const starts = logs
    .filter((log) => log.job === FX_INGEST_JOB && log.status === 'SUCCESS')
    .map((log) => Date.parse(log.started_at))
    .sort((a, b) => a - b);
  let longest: { from: number; to: number } | null = null;
  const gaps: ScheduleGap[] = [];
  for (let i = 1; i < starts.length; i += 1) {
    const from = starts[i - 1]!;
    const to = starts[i]!;
    if (!longest || to - from > longest.to - longest.from) longest = { from, to };
    const minutes = (to - from) / MINUTE_MS;
    if (minutes > windowMinutes) {
      gaps.push({
        from: new Date(from).toISOString(),
        to: new Date(to).toISOString(),
        minutes: Math.round(minutes),
        uncoveredMarketMinutes: marketMinutes(from, floorMinute(to) - windowMinutes * MINUTE_MS).length,
      });
    }
  }
  const last = starts[starts.length - 1];
  return {
    successfulRuns: starts.length,
    longestIntervalMinutes: longest ? Math.round((longest.to - longest.from) / MINUTE_MS) : null,
    longestInterval: longest
      ? { from: new Date(longest.from).toISOString(), to: new Date(longest.to).toISOString() }
      : null,
    gapsOverWindow: gaps.sort((a, b) => b.minutes - a.minutes).slice(0, 20),
    minutesSinceLastSuccess: last === undefined ? null : Math.round((now - last) / MINUTE_MS),
  };
}

/** details.skip_reasons.TIME_NOT_EXACT summed over ingest:speeches runs (speeches without an exact time). */
export function countSpeechTimeNotExact(logs: readonly IngestionLogSample[]): number {
  return logs
    .filter((log) => log.job === 'ingest:speeches')
    .reduce((sum, log) => sum + (skipReasonsOf(log).TIME_NOT_EXACT ?? 0), 0);
}

// ---------------------------------------------------------------------------
// 要人発言の鮮度(HQ承認 2026-10-23「要人発言の鮮度監視」、レポート第9章と
// GET /home speeches_status の共通判定。FRB と ECB は混ぜずに provider ごとに判定する)
// ---------------------------------------------------------------------------

export const SPEECH_JOB = 'ingest:speeches';
/** ingest:speeches の取得元(src/jobs/ingestSpeeches.ts の adapter name)。レポートは記録が無くても表示する(下の任意の取得元を除く)。 */
export const SPEECH_PROVIDERS = ['frb_calendar', 'ecb_press_rss', 'ecb_weekly_schedule'] as const;
/**
 * 環境変数で有効にしたときだけ動く取得元(ECB の週間予定は INGEST_ECB_WEEKLY=1 のときだけ)。実行記録が1件も無ければ
 * レポートに出さない(動かしていないのを「取得の失敗」と出さないため。HQ判断 2026-10-28 R5)。
 */
export const SPEECH_OPTIONAL_PROVIDERS: readonly string[] = ['ecb_weekly_schedule'];
/**
 * 開始から SPEECH_OVERDUE_HOURS 時間を過ぎても SCHEDULED の行を「終わった予定が SCHEDULED のまま(注意)」と判定する取得元
 * (HQ判断 2026-10-28 R4)。ECB の週間予定は約1週間分しか載らないので、開始の後に取り直す前にページから外れると
 * SCHEDULED のまま残り得る(自動では DELIVERED にしない)。FRB は件数を表示するだけで判定には使わない。
 */
export const SPEECH_OVERDUE_JUDGED_PROVIDERS: readonly string[] = ['ecb_weekly_schedule'];
export const SPEECH_OVERDUE_HOURS = 24;
/** 要人発言を実際に speech_events へ書く唯一の取得元(ECB RSS は公開時刻のみで、仕様上すべて TIME_NOT_EXACT)。 */
export const SPEECH_HOME_PROVIDER = 'frb_calendar';
/** 最後の SUCCESS からこの時間以上経っていたら「取得の失敗」。 */
export const SPEECH_SUCCESS_MAX_AGE_HOURS = 18;
/** 取得元の最新の予定がこの日数以上前で、未来の予定も無ければ「取得元の更新なし」。 */
export const SPEECH_SOURCE_STALE_DAYS = 10;
/** pipelines/speeches.ts の pastDays の既定値(これより古い項目は OUTSIDE_WINDOW で取り込まない)。 */
export const SPEECH_INGEST_PAST_DAYS = 14;

const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** ingest:speeches の1回の実行(ingestion_logs の1行)。件数の列は古い行・異常終了で null のことがある。 */
export interface SpeechRunSample extends IngestionLogSample {
  fetched_count: number | null;
  success_count: number | null;
  error_count: number | null;
}

/** speech_events のうち、その provider の行の状態(状態は問わない)。 */
export interface SpeechDbStatus {
  /** statement_datetime の最大値(SCHEDULED/DELIVERED を問わない)。行が無ければ null */
  latestAt: string | null;
  /** statement_datetime が now より後の SCHEDULED の件数 */
  futureScheduled: number;
  /** statement_datetime が now − SPEECH_OVERDUE_HOURS より前で、SCHEDULED のままの件数 */
  overdueScheduled: number;
}

const runTime = (run: SpeechRunSample): number => Date.parse(run.completed_at ?? run.started_at);

/** started_at の新しい順(同時刻は completed_at の新しい順)。 */
export function sortSpeechRunsNewestFirst(runs: readonly SpeechRunSample[]): SpeechRunSample[] {
  return [...runs].sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at) || runTime(b) - runTime(a));
}

export interface SpeechFetchHealth {
  /** started_at が最新の実行。記録が無ければ null */
  latest: SpeechRunSample | null;
  /** latest の1つ前の実行(取得件数の前回比用) */
  previous: SpeechRunSample | null;
  /** 最後の SUCCESS の完了時刻(completed_at、無ければ started_at)。無ければ null */
  lastSuccessAt: string | null;
  /** 「取得の失敗」に当たるか */
  failed: boolean;
  /** failed の理由(表示用、日本語) */
  reasons: string[];
}

/**
 * 「取得の失敗」の判定(レポート第9章と /home speeches_status.stale の共通部分)。
 * `runs` は1つの provider の実行だけを渡す(FRB と ECB を混ぜない)。並び順は問わない。
 *
 * 失敗とするのは次のいずれか:
 * - 最新の実行(started_at が最大)が FAILURE / PARTIAL、error_count > 0、または取得件数 0
 *   (過去に SUCCESS があっても、その後の実行が失敗していれば失敗。最新の実行で見る)
 * - 18時間以内に SUCCESS が無い(now − 最後の SUCCESS の完了時刻 ≥ 18時間、または SUCCESS が一度も無い)
 */
export function judgeSpeechFetch(runs: readonly SpeechRunSample[], now: Date): SpeechFetchHealth {
  const sorted = sortSpeechRunsNewestFirst(runs);
  const latest = sorted[0] ?? null;
  const lastSuccess = sorted.find((run) => run.status === 'SUCCESS') ?? null;
  const lastSuccessMs = lastSuccess ? runTime(lastSuccess) : null;
  const reasons: string[] = [];
  if (!latest) {
    reasons.push('実行記録なし');
  } else {
    if (latest.status !== 'SUCCESS') reasons.push(`最新の実行が ${latest.status}`);
    if ((latest.error_count ?? 0) > 0) reasons.push(`最新の実行でエラー ${latest.error_count} 件`);
    if ((latest.fetched_count ?? 0) === 0) reasons.push('最新の実行の取得件数が 0');
  }
  if (lastSuccessMs === null) {
    if (latest) reasons.push('SUCCESS の実行記録なし');
  } else if (now.getTime() - lastSuccessMs >= SPEECH_SUCCESS_MAX_AGE_HOURS * HOUR_MS) {
    reasons.push(`最後の SUCCESS から ${SPEECH_SUCCESS_MAX_AGE_HOURS} 時間以上経過`);
  }
  return {
    latest,
    previous: sorted[1] ?? null,
    lastSuccessAt: lastSuccessMs === null ? null : new Date(lastSuccessMs).toISOString(),
    failed: reasons.length > 0,
    reasons,
  };
}

export type SpeechFreshnessJudgement =
  | 'FETCH_FAILED'
  | 'INGEST_GAP'
  | 'SOURCE_NOT_UPDATED'
  | 'RECONCILE_HELD'
  | 'OVERDUE_SCHEDULED'
  | 'TIME_NOT_EXACT_ONLY'
  | 'NORMAL';

export interface SpeechFreshness extends SpeechFetchHealth {
  provider: string;
  judgement: SpeechFreshnessJudgement;
  /** 判定の理由(表示用、日本語)。NORMAL は空 */
  judgementReasons: string[];
  /** 最新の実行の details.source_latest_at。null = 記録なし(この記録より前の行)または0件 */
  sourceLatestAt: string | null;
  /** 最新の実行に source_latest_at のキーがあるか(false = 記録なし。漏れ・更新なしは判定しない) */
  sourceRecorded: boolean;
  /** 最新の実行の details.source_future_count。null = 記録なし */
  sourceFutureCount: number | null;
  /** 最新の実行の details.skip_reasons */
  skipReasons: Record<string, number>;
  db: SpeechDbStatus;
}

/**
 * 最新の実行で、取り込み期間内(OUTSIDE_WINDOW 以外)の項目が1件以上あり、それが
 * すべて TIME_NOT_EXACT で、取り込み件数が 0 か(ECB RSS の通常の状態)。
 */
function isTimeNotExactOnly(run: SpeechRunSample): boolean {
  const reasons = skipReasonsOf(run);
  const inWindow = (run.fetched_count ?? 0) - (reasons.OUTSIDE_WINDOW ?? 0);
  return inWindow > 0 && (reasons.TIME_NOT_EXACT ?? 0) === inWindow && (run.success_count ?? 0) === 0;
}

/**
 * レポート第9章の provider ごとの判定。優先順位(上ほど優先、1つだけ返す):
 *
 * 1. FETCH_FAILED 取得の失敗(異常) — judgeSpeechFetch。取得できていなければ他の判定は意味を持たない
 * 2. INGEST_GAP 取り込みの漏れ(異常) — 取得元の最新(source_latest_at)が取り込み期間内
 *    (now − 14日 以降。未来も含む)で、DB のその provider の最新 statement_datetime
 *    (状態は問わない。未来の予定は SCHEDULED で保存されるため)より新しい、または DB に行が無い。
 *    source_latest_at はスキップされた項目も含むため、最新の項目が話者未登録(SPEAKER_UNKNOWN 等)で
 *    スキップされた場合もここに当たる(スキップ理由の行で確認する)。
 *    ただし最新の実行が「時刻なしのみ」(4.)のときは判定しない — 期間内の項目がすべて
 *    TIME_NOT_EXACT なら、DB に無いのは仕様どおりで漏れではない
 * 3. SOURCE_NOT_UPDATED 取得元の更新なし(注意) — 取得は成功しているが、source_latest_at が
 *    now − 10日 以前で、source_future_count が 0
 * 4. RECONCILE_HELD 消えた予定の保留(注意) — 最新の実行の details に held_disappearances(読み漏れと区別できず
 *    中止にしなかった予定)か cancel_suppressed(安全弁で何も変えなかった)がある(ECB の週間予定。HQ判断 2026-10-28
 *    「統合前レビュー」A2)。取得元で、予定が本当に消えたのかを人が確かめる
 * 5. OVERDUE_SCHEDULED 終わった予定が SCHEDULED のまま(注意) — SPEECH_OVERDUE_JUDGED_PROVIDERS の取得元で、
 *    db.overdueScheduled > 0(HQ判断 2026-10-28 R4)
 * 6. TIME_NOT_EXACT_ONLY 時刻なしで未取り込み(情報) — isTimeNotExactOnly(ECB の通常の状態)
 * 7. NORMAL 正常
 *
 * 2.〜3. は source_latest_at を使うため、最新の実行にその記録が無い(この記録の追加前の行)
 * ときは判定しない(「—(記録なし)」と表示)。1. と 4. は記録が無くても判定する。
 * 異常 > 注意 > 情報 の順にしたのは、ECB の時刻なし(情報)が更新停止(注意)を隠さないようにするため
 * (時刻なしで未取り込みの実行でも、取得元が10日以上更新されていなければ「更新なし」と出す)。
 */
/** details の配列の件数(配列でなければ 0)。 */
function asArrayLength(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

export function judgeSpeechFreshness(
  provider: string,
  runs: readonly SpeechRunSample[],
  db: SpeechDbStatus,
  now: Date,
): SpeechFreshness {
  const health = judgeSpeechFetch(runs, now);
  const details = health.latest?.details ?? null;
  const sourceRecorded = details !== null && Object.prototype.hasOwnProperty.call(details, 'source_latest_at');
  const sourceLatestMs = sourceRecorded ? asTime(details.source_latest_at) : null;
  const base = {
    ...health,
    provider,
    sourceLatestAt: sourceLatestMs === null ? null : new Date(sourceLatestMs).toISOString(),
    sourceRecorded,
    sourceFutureCount: details ? asNumber(details.source_future_count) : null,
    skipReasons: health.latest ? skipReasonsOf(health.latest) : {},
    db,
  };
  const result = (judgement: SpeechFreshnessJudgement, judgementReasons: string[]): SpeechFreshness => ({
    ...base,
    judgement,
    judgementReasons,
  });

  if (health.failed) return result('FETCH_FAILED', health.reasons);
  const latest = health.latest!;
  const timeNotExactOnly = isTimeNotExactOnly(latest);
  const nowMs = now.getTime();
  if (sourceLatestMs !== null && !timeNotExactOnly && sourceLatestMs >= nowMs - SPEECH_INGEST_PAST_DAYS * DAY_MS) {
    const dbLatestMs = db.latestAt === null ? null : Date.parse(db.latestAt);
    if (dbLatestMs === null || sourceLatestMs > dbLatestMs) {
      return result('INGEST_GAP', [
        dbLatestMs === null
          ? '取得元に取り込み期間内の予定があるが、DB にこの取得元の行が無い'
          : '取得元の最新の予定が DB の最新より新しい',
      ]);
    }
  }
  if (
    sourceLatestMs !== null &&
    sourceLatestMs <= nowMs - SPEECH_SOURCE_STALE_DAYS * DAY_MS &&
    base.sourceFutureCount === 0
  ) {
    return result('SOURCE_NOT_UPDATED', [
      `取得元の最新の予定が ${SPEECH_SOURCE_STALE_DAYS} 日以上前で、未来の予定が 0 件`,
    ]);
  }
  const held = asArrayLength(details?.held_disappearances);
  const suppressed = asArrayLength(details?.cancel_suppressed);
  if (held > 0 || suppressed > 0) {
    return result('RECONCILE_HELD', [
      `最新の実行で、消えた予定 ${held} 件を中止にせず保留した(読み漏れと区別できない・安全弁 ${suppressed} 件)。取得元で確かめる`,
    ]);
  }
  if (SPEECH_OVERDUE_JUDGED_PROVIDERS.includes(provider) && db.overdueScheduled > 0) {
    return result('OVERDUE_SCHEDULED', [
      `開始から ${SPEECH_OVERDUE_HOURS} 時間を過ぎても SCHEDULED のままの予定が ${db.overdueScheduled} 件(実施されたか取得元で確かめる)`,
    ]);
  }
  if (timeNotExactOnly) {
    return result('TIME_NOT_EXACT_ONLY', [
      '取り込み期間内の項目がすべて時刻なし(公開時刻のみ)のため、仕様どおり取り込んでいない',
    ]);
  }
  return result('NORMAL', []);
}

// ---------------------------------------------------------------------------
// Individual anomalies (HQ判断 2026-10-17: 差異の内容・対象日時・通貨ペア・
// 参照元を確認できるようにする)
// ---------------------------------------------------------------------------

/** One minute that ingest:fx-prices marked UNVERIFIED (details.unverified_minutes), as logged at the time. */
export interface AnomalyDetail {
  symbol: string;
  /** ISO open time of the candle. */
  minute: string;
  /** null = no cross-check was run for this minute (the only other way to become UNVERIFIED is a price jump). */
  diffPips: number | null;
  /** The取得元 compared against, when diffPips is not null; null otherwise. */
  referenceSource: string | null;
  /** checkCandles' notes: 'CROSS_CHECK_DIFF' and/or 'PRICE_JUMP' (a jump can override an in-range cross-check). */
  notes: readonly string[];
  /** started_at of the run that recorded this entry (the most recent one, if seen more than once). */
  loggedAt: string;
}

export const MAX_ANOMALY_DETAILS = 20;

/**
 * One entry per (symbol, minute) in the period, from the latest run that
 * recorded it (details.unverified_minutes is capped at 50 per run, newest
 * runs first, so a minute later re-verified by gap repair and no longer
 * UNVERIFIED may still appear here from an older run — this lists what was
 * logged, not today's live status; §2's counts are the live status).
 */
export function extractAnomalyDetails(logs: readonly IngestionLogSample[], period: Period): AnomalyDetail[] {
  const runs = fxLogs(logs);
  const byKey = new Map<string, AnomalyDetail>();
  for (const run of runs) {
    const list = run.details?.unverified_minutes;
    if (!Array.isArray(list)) continue;
    for (const entry of list) {
      const record = asRecord(entry);
      if (!record) continue;
      const symbol = typeof record.symbol === 'string' ? record.symbol : null;
      const minute = typeof record.minute === 'string' ? record.minute : null;
      if (symbol === null || minute === null) continue;
      const ms = Date.parse(minute);
      if (!Number.isFinite(ms) || ms < period.from || ms >= period.to) continue;
      const notes = Array.isArray(record.notes) ? record.notes.filter((n): n is string => typeof n === 'string') : [];
      byKey.set(`${symbol}|${minute}`, {
        symbol,
        minute,
        diffPips: asNumber(record.diff_pips),
        referenceSource: typeof record.cross_check_source === 'string' ? record.cross_check_source : null,
        notes,
        loggedAt: run.started_at,
      });
    }
  }
  return [...byKey.values()].sort((a, b) => Date.parse(b.minute) - Date.parse(a.minute));
}

// ---------------------------------------------------------------------------
// API usage and reconciliation (ingest:fx-prices details)
// ---------------------------------------------------------------------------

export interface ApiUsageDay {
  /** UTC date YYYY-MM-DD of started_at */
  date: string;
  requests: number;
  /** runs that recorded api_requests */
  runs: number;
}

export interface ReconciliationTotals {
  /** runs whose details had a reconciliation object */
  runs: number;
  fetched: number;
  accepted: number;
  rejected: number;
  rejectedByReason: Record<string, number>;
  upserted1m: number;
  upsertedAggregated: number;
  corrected: number;
  failedRequests: number;
  /** runs where fetched ≠ accepted + Σrejected, or upserted_1m ≠ accepted (only fields that were recorded are checked) */
  mismatchRuns: number;
  /** the same checks on the sums over all runs */
  sumMismatch: boolean;
}

export interface ApiUsageStats {
  /** ingest:fx-prices runs in the logs */
  fxRuns: number;
  /** of those, runs that recorded details.api_requests (older rows don't) */
  runsWithCount: number;
  totalRequests: number;
  maxPerRun: { requests: number; startedAt: string } | null;
  perDay: ApiUsageDay[];
  dailyLimit: number;
  /** budget.daily of the latest run that recorded it, else API_DAILY_BUDGET_DEFAULT */
  dailyBudget: number;
  latestBudget: {
    startedAt: string;
    daily: number | null;
    usedBeforeRun: number | null;
    leftAfterRun: number | null;
  } | null;
  /** details.unrecovered of the latest run that recorded it: minutes per reason */
  latestUnrecovered: { startedAt: string; total: number | null; minutesByReason: Record<string, number> } | null;
  reconciliation: ReconciliationTotals | null;
}

export function summarizeApiUsage(logs: readonly IngestionLogSample[]): ApiUsageStats {
  const runs = fxLogs(logs);
  const perDay = new Map<string, ApiUsageDay>();
  let totalRequests = 0;
  let runsWithCount = 0;
  let maxPerRun: ApiUsageStats['maxPerRun'] = null;
  let latestBudget: ApiUsageStats['latestBudget'] = null;
  let latestUnrecovered: ApiUsageStats['latestUnrecovered'] = null;
  let rec: ReconciliationTotals | null = null;

  for (const run of runs) {
    const details = run.details ?? {};
    const requests = asNumber(details.api_requests);
    if (requests !== null) {
      runsWithCount += 1;
      totalRequests += requests;
      const date = new Date(Date.parse(run.started_at)).toISOString().slice(0, 10);
      const day = perDay.get(date) ?? { date, requests: 0, runs: 0 };
      day.requests += requests;
      day.runs += 1;
      perDay.set(date, day);
      if (!maxPerRun || requests > maxPerRun.requests) maxPerRun = { requests, startedAt: run.started_at };
    }
    const budget = asRecord(details.budget);
    if (budget) {
      latestBudget = {
        startedAt: run.started_at,
        daily: asNumber(budget.daily),
        usedBeforeRun: asNumber(budget.used_before_run),
        leftAfterRun: asNumber(budget.left_after_run),
      };
    }
    if (Array.isArray(details.unrecovered)) {
      const minutesByReason: Record<string, number> = {};
      for (const i of symbolIntervals(details.unrecovered)) {
        const reason = i.reason ?? '(理由なし)';
        minutesByReason[reason] = (minutesByReason[reason] ?? 0) + Math.round((i.to - i.from) / MINUTE_MS);
      }
      latestUnrecovered = { startedAt: run.started_at, total: asNumber(details.unrecovered_total), minutesByReason };
    }
    const r = asRecord(details.reconciliation);
    if (r) {
      rec ??= {
        runs: 0,
        fetched: 0,
        accepted: 0,
        rejected: 0,
        rejectedByReason: {},
        upserted1m: 0,
        upsertedAggregated: 0,
        corrected: 0,
        failedRequests: 0,
        mismatchRuns: 0,
        sumMismatch: false,
      };
      const fetched = asNumber(r.fetched);
      const accepted = asNumber(r.accepted);
      const upserted1m = asNumber(r.upserted_1m);
      const rejectedByReason = numberRecord(r.rejected_by_reason);
      const rejected = Object.values(rejectedByReason).reduce((sum, n) => sum + n, 0);
      rec.runs += 1;
      rec.fetched += fetched ?? 0;
      rec.accepted += accepted ?? 0;
      rec.rejected += rejected;
      for (const [reason, n] of Object.entries(rejectedByReason)) {
        rec.rejectedByReason[reason] = (rec.rejectedByReason[reason] ?? 0) + n;
      }
      rec.upserted1m += upserted1m ?? 0;
      rec.upsertedAggregated += asNumber(r.upserted_aggregated) ?? 0;
      rec.corrected += asNumber(r.corrected) ?? 0;
      rec.failedRequests += asNumber(r.failed_requests) ?? 0;
      const countMismatch = fetched !== null && accepted !== null && fetched !== accepted + rejected;
      const upsertMismatch = upserted1m !== null && accepted !== null && upserted1m !== accepted;
      if (countMismatch || upsertMismatch) rec.mismatchRuns += 1;
    }
  }
  if (rec) rec.sumMismatch = rec.fetched !== rec.accepted + rec.rejected || rec.upserted1m !== rec.accepted;

  return {
    fxRuns: runs.length,
    runsWithCount,
    totalRequests,
    maxPerRun,
    perDay: [...perDay.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)),
    dailyLimit: API_DAILY_LIMIT,
    dailyBudget: latestBudget?.daily ?? API_DAILY_BUDGET_DEFAULT,
    latestBudget,
    latestUnrecovered,
    reconciliation: rec,
  };
}

// ---------------------------------------------------------------------------
// API credits (api_credit_usage, written by the ingest jobs before each attempt)
// ---------------------------------------------------------------------------

/** The api_credit_usage columns the report reads. */
export interface CreditUsageSample {
  provider: string;
  /** UTC date YYYY-MM-DD */
  usage_date: string;
  job: string | null;
  credits: number;
  /** daily cap applied when the credit was reserved (700 scheduled / 800 manual); null = unknown */
  cap?: number | null | undefined;
  /** api_credit_usage.mode (AUTOMATIC / MANUAL); null = unknown */
  mode?: string | null | undefined;
}

export type CreditJobKind = 'AUTO' | 'MANUAL' | 'EVAL';

/**
 * Daily caps (UTC day). PLAN assumes the Twelve Data Basic plan (800/day,
 * contract not confirmed); AUTO is the budget of the scheduled ingest,
 * MANUAL the most a manual run may use.
 */
export const CREDIT_CAPS = { AUTO: API_DAILY_BUDGET_DEFAULT, MANUAL: API_DAILY_LIMIT, PLAN: API_DAILY_LIMIT } as const;

/**
 * eval:providers → EVAL. Otherwise the ledger's `mode` column decides
 * (AUTOMATIC → AUTO, MANUAL → MANUAL). Rows without a mode (none expected)
 * fall back to the cap they reserved under (> the automatic cap = manual).
 */
export function creditJobKind(
  job: string | null,
  cap: number | null = null,
  mode: string | null = null,
): CreditJobKind {
  if (job === 'eval:providers') return 'EVAL';
  if (mode === 'AUTOMATIC') return 'AUTO';
  if (mode === 'MANUAL') return 'MANUAL';
  if (job === FX_INGEST_JOB) return cap !== null && cap > CREDIT_CAPS.AUTO ? 'MANUAL' : 'AUTO';
  return 'MANUAL';
}

export interface CreditDay {
  provider: string;
  date: string;
  auto: number;
  manual: number;
  eval: number;
  total: number;
  overAutoCap: boolean;
  overManualCap: boolean;
  overPlan: boolean;
}

export interface CreditUsageStats {
  days: CreditDay[];
  /** job names counted as MANUAL */
  manualJobs: string[];
}

/** null rows (= table missing or unreadable) → null. */
export function summarizeCreditUsage(rows: readonly CreditUsageSample[] | null): CreditUsageStats | null {
  if (rows === null) return null;
  const days = new Map<string, CreditDay>();
  const manualJobs = new Set<string>();
  for (const row of rows) {
    const credits = Number(row.credits);
    if (!Number.isFinite(credits)) continue;
    const date = row.usage_date.slice(0, 10);
    const key = `${date}|${row.provider}`;
    const day = days.get(key) ?? {
      provider: row.provider,
      date,
      auto: 0,
      manual: 0,
      eval: 0,
      total: 0,
      overAutoCap: false,
      overManualCap: false,
      overPlan: false,
    };
    const kind = creditJobKind(row.job, row.cap ?? null, row.mode ?? null);
    if (kind === 'AUTO') day.auto += credits;
    else if (kind === 'EVAL') day.eval += credits;
    else {
      day.manual += credits;
      manualJobs.add(row.job === FX_INGEST_JOB ? `${FX_INGEST_JOB} (--manual)` : (row.job ?? '(job未記録)'));
    }
    day.total += credits;
    days.set(key, day);
  }
  const sorted = [...days.values()].sort((a, b) =>
    a.date !== b.date ? (a.date < b.date ? -1 : 1) : a.provider < b.provider ? -1 : a.provider > b.provider ? 1 : 0,
  );
  for (const day of sorted) {
    day.overAutoCap = day.auto > CREDIT_CAPS.AUTO;
    day.overManualCap = day.manual > CREDIT_CAPS.MANUAL;
    day.overPlan = day.total > CREDIT_CAPS.PLAN;
  }
  return { days: sorted, manualJobs: [...manualJobs].sort() };
}

// ---------------------------------------------------------------------------
// Economic values
// ---------------------------------------------------------------------------

export interface SnapshotSample {
  verification_status: string;
  /**
   * economic_events.provider that supplied the actual value (e.g.
   * 'tradingeconomics', 'bls_schedule'). Optional: samples from before this
   * field existed are treated as independently sourced, matching the
   * behavior before this distinction existed (HQ判断 2026-10-17).
   */
  provider?: string;
  /** event_snapshots.verification_source (e.g. "BLS:CUUR0000SA0@2026-10-14"); null = no official corroboration (SINGLE_SOURCE). */
  verification_source?: string | null;
}

export interface StagedSample {
  verification_status: StagedVerificationStatus;
  reasons: readonly string[];
  indicator_code?: string;
  reference_period?: string | null;
  provider?: string;
  actual?: number | null;
  new_value?: number | null;
  official_actual?: number | null;
}

/**
 * Providers that ARE the official agency itself, not a third-party
 * calendar — HQ判断(2026-10-17): a VERIFIED snapshot from one of these,
 * matched against THE SAME agency's own official series, is a self-match
 * (data-sources.md §14.5): actual and official come from the identical
 * fetch, so the agreement is tautological, not independent corroboration.
 * This is an explicit, reviewed map — never inferred from the provider
 * string alone (a provider could coincidentally be named after an agency
 * without actually being it) and never from matching text alone (a
 * genuinely independent provider's value could coincidentally equal the
 * official one without being the same fetch).
 */
export const SELF_SOURCING_PROVIDER_AGENCY: Readonly<Record<string, string>> = {
  bls_schedule: 'BLS',
  eurostat_schedule: 'EUROSTAT',
};

/** "BLS:CUUR0000SA0@2026-10-14" → "BLS". */
function officialAgencyOf(verificationSource: string | null | undefined): string | null {
  if (!verificationSource) return null;
  const colon = verificationSource.indexOf(':');
  return colon === -1 ? verificationSource : verificationSource.slice(0, colon);
}

export type SnapshotMatchKind = 'INDEPENDENT' | 'SELF_MATCH' | 'SINGLE_SOURCE';

/** null for a status this function doesn't classify (anything but VERIFIED/SINGLE_SOURCE). */
export function classifySnapshotMatch(sample: SnapshotSample): SnapshotMatchKind | null {
  if (sample.verification_status === 'SINGLE_SOURCE') return 'SINGLE_SOURCE';
  if (sample.verification_status !== 'VERIFIED') return null;
  const selfAgency = sample.provider ? SELF_SOURCING_PROVIDER_AGENCY[sample.provider] : undefined;
  return selfAgency !== undefined && officialAgencyOf(sample.verification_source) === selfAgency
    ? 'SELF_MATCH'
    : 'INDEPENDENT';
}

export const MAX_MISMATCH_DETAILS = 20;

export interface MismatchDetail {
  indicatorCode: string;
  referencePeriod: string | null;
  provider: string;
  actual: number | null;
  officialActual: number | null;
}

/**
 * NO_DATA: no economic_events and no event_snapshots rows in the period (未検証・経済指標データ未取得).
 * NOT_RUN: data exists but no ingest:official* run in the period (未検証・照合処理未実行).
 * MEASURED: counts and rates are meaningful.
 */
export type EconomicState = 'NO_DATA' | 'NOT_RUN' | 'MEASURED';

export interface EconomicValueStats {
  state: EconomicState;
  /** economic_events rows in the period (any status); null = not counted */
  economicEvents: number | null;
  /** ingest:official / ingest:official:reverify runs in the period; null = not counted */
  officialRuns: number | null;
  snapshots: Record<string, number>;
  staged: Record<string, number>;
  /** PENDING_REVIEW staged values whose reasons include OFFICIAL_MISMATCH */
  officialMismatches: number;
  /**
   * snapshots VERIFIED / (VERIFIED + officialMismatches). null = nothing
   * compared. Kept for compatibility — INCLUDES self-matched snapshots
   * (SELF_SOURCING_PROVIDER_AGENCY) in both counts, so it does NOT answer
   * "what fraction was independently verified" (independentAgreementRate
   * does). HQ判断(2026-10-17): 自己一致は独立照合に加算しない。
   */
  agreementRate: number | null;
  /** reasons of PENDING_REVIEW staged values (count per code) */
  pendingReviewReasons: Record<string, number>;
  /** VERIFIED snapshots classified INDEPENDENT (classifySnapshotMatch) — a genuinely different source corroborated the value. */
  independentlyVerified: number;
  /** VERIFIED snapshots classified SELF_MATCH — same fetch compared with itself; never counted toward independentlyVerified. */
  selfMatched: number;
  /** = snapshots.SINGLE_SOURCE (no official ever available/required). Exposed separately for the new breakdown. */
  singleSource: number;
  /** ingestion_staged_values still AWAITING_OFFICIAL (actual received, official corroboration not yet available) — 未発表・確認待ち. */
  awaitingOfficial: number;
  /** independentlyVerified / (independentlyVerified + officialMismatches), excluding self-matches from both sides. null = nothing to compare. */
  independentAgreementRate: number | null;
  /** Up to MAX_MISMATCH_DETAILS of the PENDING_REVIEW/OFFICIAL_MISMATCH rows, for 差異あり detail (指標・対象期間・取得元・値). */
  mismatches: MismatchDetail[];
}

export function summarizeEconomicValues(
  snapshots: readonly SnapshotSample[],
  staged: readonly StagedSample[],
  context: { economicEvents: number; officialRuns: number } | null = null,
): EconomicValueStats {
  const count = (values: readonly string[]): Record<string, number> => {
    const result: Record<string, number> = {};
    for (const value of values) result[value] = (result[value] ?? 0) + 1;
    return result;
  };
  const pending = staged.filter((s) => s.verification_status === 'PENDING_REVIEW');
  const mismatched = pending.filter((s) => s.reasons.includes('OFFICIAL_MISMATCH'));
  const officialMismatches = mismatched.length;
  const snapshotCounts = count(snapshots.map((s) => s.verification_status));
  const verified = snapshotCounts.VERIFIED ?? 0;
  let state: EconomicState = 'MEASURED';
  if (context) {
    if (context.economicEvents === 0 && snapshots.length === 0) state = 'NO_DATA';
    else if (context.officialRuns === 0) state = 'NOT_RUN';
  }

  let independentlyVerified = 0;
  let selfMatched = 0;
  let singleSource = 0;
  for (const snapshot of snapshots) {
    const kind = classifySnapshotMatch(snapshot);
    if (kind === 'INDEPENDENT') independentlyVerified += 1;
    else if (kind === 'SELF_MATCH') selfMatched += 1;
    else if (kind === 'SINGLE_SOURCE') singleSource += 1;
  }
  const awaitingOfficial = staged.filter((s) => s.verification_status === 'AWAITING_OFFICIAL').length;
  const mismatches: MismatchDetail[] = mismatched.slice(0, MAX_MISMATCH_DETAILS).map((s) => ({
    indicatorCode: s.indicator_code ?? '(指標不明)',
    referencePeriod: s.reference_period ?? null,
    provider: s.provider ?? '(取得元不明)',
    actual: s.actual ?? s.new_value ?? null,
    officialActual: s.official_actual ?? null,
  }));

  return {
    state,
    economicEvents: context?.economicEvents ?? null,
    officialRuns: context?.officialRuns ?? null,
    snapshots: snapshotCounts,
    staged: count(staged.map((s) => s.verification_status)),
    officialMismatches,
    agreementRate: ratio(verified, verified + officialMismatches),
    pendingReviewReasons: count(pending.flatMap((s) => [...s.reasons])),
    independentlyVerified,
    selfMatched,
    singleSource,
    awaitingOfficial,
    independentAgreementRate: ratio(independentlyVerified, independentlyVerified + officialMismatches),
    mismatches,
  };
}

// ---------------------------------------------------------------------------
// Whole report
// ---------------------------------------------------------------------------

export interface FxPairInput {
  symbol: string;
  /** 1m and aggregated rows, at least for [period.from, now) */
  rows: readonly FxRowSample[];
  /** ISO open time of the earliest stored 1m candle (see FxCompletenessOptions.firstCandleAt) */
  firstCandleAt?: string | null | undefined;
}

export interface DataQualityInput {
  now: Date;
  /** completeness period [from, to) — `to` is a bit before `now` (the latest minutes wait for the next run) */
  period: Period;
  days: number;
  pairs: readonly FxPairInput[];
  releases: readonly ReleaseInstant[];
  logs: readonly IngestionLogSample[];
  snapshots: readonly SnapshotSample[];
  staged: readonly StagedSample[];
  /** economic_events rows (any status) in the period; undefined → the ECONOMIC releases are counted */
  economicEventCount?: number;
  /** api_credit_usage rows for the UTC days of the period; null/undefined = table missing or unreadable */
  creditUsage?: readonly CreditUsageSample[] | null;
}

export interface FxTotals {
  beforeStartMinutes: number;
  expectedMinutes: number;
  presentMinutes: number;
  missingMinutes: number;
  missingRate: number | null;
  missingBreakdown: MissingBreakdown;
  /** pairs with no stored 1m candle at all */
  pairsWithoutData: string[];
}

/**
 * latestCandleAgeMinutesの正常/警告/異常の判定(HQ決定2026-10-18「価格データ品質の閾値」)。
 *
 * 為替の取り込みは20分ごと(cron '7,27,47 * * * *'、FX_FETCH_SETTINGS.forwardMinutesとは
 * 別の、実際のGitHub Actionsスケジュール)+ finality lag 2分のため、**健全な状態でも**
 * 次の実行の直前には最大で20+2=22分前後になる。これは正常な運用サイクルであり異常では
 * ない。HQ暫定案(3分以内=正常、10分超=異常)のままでは、1サイクルの後半(約10〜22分、
 * サイクルのおよそ半分)で毎回「異常」と誤判定するため、そのままでは実装しなかった
 * (HQ指示「休場中に誤警告が出る設計であれば、そのまま実装せず、適切な判定方法を
 * 提案すること」への対応。実際には休場中だけでなく、健全な通常運用中にも誤警告が出る
 * 設計だったため、取り込みサイクルに合わせた閾値へ変更して提案する)。
 *
 * 市場休場中(週末・祝日。isFxMarketOpen参照)は、新しい足自体が来ないため評価しない
 * (MARKET_CLOSED。警告・異常にはしない — これがHQ指示が想定していた誤警告の防止)。
 *
 * 新しい閾値(1サイクル=20分+finality lag 2分を基準):
 * - 正常: 25分以内(1サイクル分の遅れまで)
 * - 警告: 25分超〜45分以内(2サイクル以内の遅れ — 1回の取り込み失敗・リトライ相当)
 * - 異常: 45分超(2サイクル以上、連続して取得できていない — Twelve Data側の配信停止・
 *   大幅な遅延等を検出する本来の目的に対応)
 *
 * 画面(iOSアプリ)には一切表示されない(品質レポートのみ、report.ts §7)。閾値の変更は
 * この判定ロジックのみに影響し、既存のUI・データ取得処理・API利用上限には影響しない。
 */
export const CANDLE_FRESHNESS_THRESHOLDS = {
  normalMaxMinutes: 25,
  warningMaxMinutes: 45,
} as const;

export type CandleFreshnessStatus = 'NORMAL' | 'WARNING' | 'CRITICAL' | 'MARKET_CLOSED' | 'NO_DATA';

export function classifyCandleFreshness(ageMinutes: number | null, now: Date): CandleFreshnessStatus {
  if (!isFxMarketOpen(now.getTime())) return 'MARKET_CLOSED';
  if (ageMinutes === null) return 'NO_DATA';
  if (ageMinutes <= CANDLE_FRESHNESS_THRESHOLDS.normalMaxMinutes) return 'NORMAL';
  if (ageMinutes <= CANDLE_FRESHNESS_THRESHOLDS.warningMaxMinutes) return 'WARNING';
  return 'CRITICAL';
}

export interface DataQualityReport {
  generatedAt: string;
  period: { from: string; to: string };
  days: number;
  fx: FxCompleteness[];
  fxTotals: FxTotals;
  /** now − close time of the newest 1m candle, per pair (null = no candle) */
  latestCandleAgeMinutes: Record<string, number | null>;
  /** classifyCandleFreshness() result per pair, using the SAME `now` as latestCandleAgeMinutes. */
  candleFreshness: Record<string, CandleFreshnessStatus>;
  releaseWindows: ReleaseWindowSummary;
  runs: JobRunStats[];
  fxSchedule: FxScheduleStats;
  apiUsage: ApiUsageStats;
  /** null = no credit records (table missing or unreadable) */
  credits: CreditUsageStats | null;
  speechTimeNotExact: number;
  economic: EconomicValueStats;
  /** Individual UNVERIFIED minutes in the period (most recent first, at most MAX_ANOMALY_DETAILS). */
  anomalies: AnomalyDetail[];
}

export function buildDataQualityReport(input: DataQualityInput): DataQualityReport {
  const now = input.now.getTime();
  const causes = extractMissingCauses(input.logs);
  const fx = input.pairs.map((pair) =>
    computeFxCompleteness(pair.symbol, pair.rows, input.period, {
      firstCandleAt: pair.firstCandleAt,
      causes: causes.get(pair.symbol),
    }),
  );
  const sum = (pick: (f: FxCompleteness) => number): number => fx.reduce((total, f) => total + pick(f), 0);
  const expectedMinutes = sum((f) => f.expectedMinutes);
  const missingMinutes = sum((f) => f.missingMinutes);
  const latestCandleAgeMinutes: Record<string, number | null> = {};
  const candleFreshness: Record<string, CandleFreshnessStatus> = {};
  for (const f of fx) {
    const age =
      f.latestCandleOpen === null ? null : Math.round((now - Date.parse(f.latestCandleOpen) - MINUTE_MS) / MINUTE_MS);
    latestCandleAgeMinutes[f.symbol] = age;
    candleFreshness[f.symbol] = classifyCandleFreshness(age, input.now);
  }
  const usable = new Map(input.pairs.map((pair) => [pair.symbol, usableMinuteSet(pair.rows)]));
  const starts = new Map(fx.map((f) => [f.symbol, f.ingestionStart === null ? null : Date.parse(f.ingestionStart)]));
  const economicEvents = input.economicEventCount ?? input.releases.filter((r) => r.kind === 'ECONOMIC').length;
  const officialRuns = input.logs.filter((log) => log.job?.startsWith(OFFICIAL_JOB_PREFIX)).length;
  return {
    generatedAt: input.now.toISOString(),
    period: { from: new Date(input.period.from).toISOString(), to: new Date(input.period.to).toISOString() },
    days: input.days,
    fx,
    fxTotals: {
      beforeStartMinutes: sum((f) => f.beforeStartMinutes),
      expectedMinutes,
      presentMinutes: sum((f) => f.presentMinutes),
      missingMinutes,
      missingRate: ratio(missingMinutes, expectedMinutes),
      missingBreakdown: Object.fromEntries(
        MISSING_CAUSES.map((c) => [c, sum((f) => f.missingBreakdown[c])]),
      ) as MissingBreakdown,
      pairsWithoutData: fx.filter((f) => f.state === 'NO_DATA').map((f) => f.symbol),
    },
    latestCandleAgeMinutes,
    candleFreshness,
    releaseWindows: checkReleaseWindows(input.releases, usable, input.period, starts),
    runs: summarizeRuns(input.logs),
    fxSchedule: analyzeFxSchedule(input.logs, now),
    apiUsage: summarizeApiUsage(input.logs),
    credits: summarizeCreditUsage(input.creditUsage ?? null),
    speechTimeNotExact: countSpeechTimeNotExact(input.logs),
    economic: summarizeEconomicValues(input.snapshots, input.staged, { economicEvents, officialRuns }),
    anomalies: extractAnomalyDetails(input.logs, input.period).slice(0, MAX_ANOMALY_DETAILS),
  };
}
