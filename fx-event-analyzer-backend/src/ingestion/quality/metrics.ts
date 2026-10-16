/**
 * Data-quality metrics (HQ判断 2026-10-16: 取得率・欠損率・照合一致率・時刻ずれを
 * 実データで測る)。PURE functions only — no I/O, no clock: the job
 * (src/jobs/reportDataQuality.ts) reads the rows (quality/reader.ts) and
 * passes `now` in, so every number here is reproducible in unit tests.
 *
 * Times are epoch milliseconds (UTC) internally; fx_prices.timestamp is
 * the candle OPEN time (db-design.md §3.11). Periods are half-open
 * [from, to) and minute-aligned.
 */
import type { FxPriceRow, IngestionLogRow, StagedVerificationStatus } from '../store.js';

export const MINUTE_MS = 60_000;

/**
 * Approximate FX market week used to count "expected" 1m candles:
 * open Sunday 21:00 UTC → close Friday 21:00 UTC (= 17:00 New York in US
 * daylight time). This is an APPROXIMATION:
 *   - DST shifts it by an hour: in US standard time (Nov–Mar) the real
 *     week is Sunday 22:00 → Friday 22:00 UTC, so Sunday 21:00–22:00 is
 *     counted as expected (and missing) although the market is closed,
 *     and Friday 21:00–22:00 is not counted at all.
 *   - Holidays (Dec 25, Jan 1, …) and thin minutes in which the provider
 *     has no trade are NOT excluded.
 * Expected minutes / missing rate are therefore UPPER BOUNDS — a missing
 * rate of a few percent may be entirely explained by the above.
 */
export const FX_MARKET_WEEK_UTC = {
  /** getUTCDay(): 0 = Sunday */
  openDay: 0,
  openHour: 21,
  /** 5 = Friday */
  closeDay: 5,
  closeHour: 21,
} as const;

/** Minutes around a release that reactions need: open times [T − 5 min, T + 60 min). */
export const RELEASE_WINDOW_MINUTES = { before: 5, after: 60 } as const;

/** ingest:fx-prices fetches the last 120 minutes on every run (src/jobs/ingestFxPrices.ts). */
export const FX_INGEST_WINDOW_MINUTES = 120;

export const FX_INGEST_JOB = 'ingest:fx-prices';

export interface Period {
  from: number;
  to: number;
}

export function isFxMarketOpen(ms: number): boolean {
  const date = new Date(ms);
  const day = date.getUTCDay();
  const hour = date.getUTCHours();
  if (day === FX_MARKET_WEEK_UTC.openDay) return hour >= FX_MARKET_WEEK_UTC.openHour;
  if (day === FX_MARKET_WEEK_UTC.closeDay) return hour < FX_MARKET_WEEK_UTC.closeHour;
  return day !== 6;
}

const floorMinute = (ms: number): number => Math.floor(ms / MINUTE_MS) * MINUTE_MS;
const ceilMinute = (ms: number): number => Math.ceil(ms / MINUTE_MS) * MINUTE_MS;

/** Number of market-open minutes (by open time) in [from, to). */
export function countMarketOpenMinutes(period: Period): number {
  let count = 0;
  for (let ms = ceilMinute(period.from); ms < period.to; ms += MINUTE_MS) if (isFxMarketOpen(ms)) count += 1;
  return count;
}

const ratio = (numerator: number, denominator: number): number | null =>
  denominator === 0 ? null : numerator / denominator;

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
  /** Buckets fully inside the period whose 1m minutes are all present and none UNVERIFIED (what the pipeline needs). */
  eligibleBuckets: number;
  /** Of those, buckets that have a row of this timeframe. */
  presentBuckets: number;
  coverageRate: number | null;
}

export interface FxCompleteness {
  symbol: string;
  expectedMinutes: number;
  presentMinutes: number;
  missingMinutes: number;
  missingRate: number | null;
  /** present minutes not UNVERIFIED (= usable for reactions) */
  usableMinutes: number;
  /** 1m rows outside the approximate market week (not counted as present). */
  outsideMarketRows: number;
  longestGaps: Gap[];
  status: Record<FxPriceRow['verification_status'], number>;
  /** 1m rows with a cross-check value (cross_check_diff_pips not null). */
  crossChecked: number;
  /** VERIFIED / cross-checked rows (VERIFIED + UNVERIFIED that were compared). null = nothing compared. */
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

/**
 * Gaps are runs of consecutive market-open minutes without a 1m row; a
 * closed-market minute ends a gap (a gap never spans the weekend).
 * Sorted by length desc, then start asc; at most `TOP_GAPS`.
 */
export function findGaps(present: ReadonlySet<number>, period: Period, limit = TOP_GAPS): Gap[] {
  const gaps: { start: number; minutes: number }[] = [];
  let start: number | null = null;
  let length = 0;
  const close = (): void => {
    if (start !== null) gaps.push({ start, minutes: length });
    start = null;
    length = 0;
  };
  for (let ms = ceilMinute(period.from); ms < period.to; ms += MINUTE_MS) {
    if (!isFxMarketOpen(ms) || present.has(ms)) {
      close();
      continue;
    }
    if (start === null) start = ms;
    length += 1;
  }
  close();
  return gaps
    .sort((a, b) => b.minutes - a.minutes || a.start - b.start)
    .slice(0, limit)
    .map((gap) => ({ start: new Date(gap.start).toISOString(), minutes: gap.minutes }));
}

export function computeFxCompleteness(symbol: string, rows: readonly FxRowSample[], period: Period): FxCompleteness {
  const minuteStatus = new Map<number, FxPriceRow['verification_status']>();
  const aggregated = new Map<string, Set<number>>();
  const status: FxCompleteness['status'] = { VERIFIED: 0, SINGLE_SOURCE: 0, UNVERIFIED: 0 };
  let outsideMarketRows = 0;
  let crossChecked = 0;
  let verifiedChecked = 0;
  let maxAbsDiffPips: number | null = null;
  let latest: number | null = null;

  for (const row of rows) {
    const ms = Date.parse(row.timestamp);
    if (row.timeframe === '1m' && (latest === null || ms > latest)) latest = ms;
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

  const expectedMinutes = countMarketOpenMinutes(period);
  const presentMinutes = minuteStatus.size;
  const missingMinutes = expectedMinutes - presentMinutes;

  const aggregates = AGGREGATES.map(({ timeframe, minutes }): AggregateCoverage => {
    const bucketMs = minutes * MINUTE_MS;
    const present = aggregated.get(timeframe) ?? new Set<number>();
    let eligibleBuckets = 0;
    let presentBuckets = 0;
    for (let start = Math.ceil(period.from / bucketMs) * bucketMs; start + bucketMs <= period.to; start += bucketMs) {
      let complete = true;
      for (let ms = start; ms < start + bucketMs; ms += MINUTE_MS) {
        const s = minuteStatus.get(ms);
        if (s === undefined || s === 'UNVERIFIED') {
          complete = false;
          break;
        }
      }
      if (!complete) continue;
      eligibleBuckets += 1;
      if (present.has(start)) presentBuckets += 1;
    }
    return { timeframe, eligibleBuckets, presentBuckets, coverageRate: ratio(presentBuckets, eligibleBuckets) };
  });

  return {
    symbol,
    expectedMinutes,
    presentMinutes,
    missingMinutes,
    missingRate: ratio(missingMinutes, expectedMinutes),
    usableMinutes: presentMinutes - status.UNVERIFIED,
    outsideMarketRows,
    longestGaps: findGaps(new Set(minuteStatus.keys()), period),
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
  /** instant × pair windows that could be judged */
  windows: number;
  complete: number;
  incomplete: number;
  /** windows touching the (approximate) closed market — not judged */
  outsideMarket: number;
  /** windows not fully inside the period — not judged */
  outsidePeriod: number;
}

export interface ReleaseWindowSummary {
  byKind: Record<ReleaseInstant['kind'], ReleaseWindowCounts>;
  /** incomplete windows, most missing minutes first (at most 20) */
  issues: ReleaseWindowIssue[];
}

const emptyCounts = (): ReleaseWindowCounts => ({
  windows: 0,
  complete: 0,
  incomplete: 0,
  outsideMarket: 0,
  outsidePeriod: 0,
});

/**
 * For every instant × pair: does every 1m candle with open time in
 * [T − 5 min, T + 60 min) exist and is not UNVERIFIED? A non-minute-aligned
 * T is floored to the minute.
 */
export function checkReleaseWindows(
  instants: readonly ReleaseInstant[],
  usableBySymbol: ReadonlyMap<string, ReadonlySet<number>>,
  period: Period,
): ReleaseWindowSummary {
  const byKind = { ECONOMIC: emptyCounts(), SPEECH: emptyCounts() };
  const issues: ReleaseWindowIssue[] = [];
  for (const instant of instants) {
    const t = floorMinute(Date.parse(instant.at));
    const start = t - RELEASE_WINDOW_MINUTES.before * MINUTE_MS;
    const end = t + RELEASE_WINDOW_MINUTES.after * MINUTE_MS;
    const counts = byKind[instant.kind];
    let marketOpen = true;
    for (let ms = start; ms < end; ms += MINUTE_MS) {
      if (!isFxMarketOpen(ms)) {
        marketOpen = false;
        break;
      }
    }
    for (const [symbol, usable] of usableBySymbol) {
      if (start < period.from || end > period.to) {
        counts.outsidePeriod += 1;
        continue;
      }
      if (!marketOpen) {
        counts.outsideMarket += 1;
        continue;
      }
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
  }
  issues.sort((a, b) => b.missingMinutes - a.missingMinutes || Date.parse(a.at) - Date.parse(b.at));
  return { byKind, issues: issues.slice(0, 20) };
}

// ---------------------------------------------------------------------------
// Ingestion runs
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

function skipReasonsOf(log: IngestionLogSample): Record<string, number> {
  const raw = log.details?.skip_reasons;
  if (!raw || typeof raw !== 'object') return {};
  const result: Record<string, number> = {};
  for (const [reason, count] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof count === 'number' && Number.isFinite(count)) result[reason] = count;
  }
  return result;
}

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
        uncoveredMarketMinutes: countMarketOpenMinutes({ from, to: floorMinute(to) - windowMinutes * MINUTE_MS }),
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
// Economic values
// ---------------------------------------------------------------------------

export interface SnapshotSample {
  verification_status: string;
}

export interface StagedSample {
  verification_status: StagedVerificationStatus;
  reasons: readonly string[];
}

export interface EconomicValueStats {
  snapshots: Record<string, number>;
  staged: Record<string, number>;
  /** PENDING_REVIEW staged values whose reasons include OFFICIAL_MISMATCH */
  officialMismatches: number;
  /** snapshots VERIFIED / (VERIFIED + officialMismatches). null = nothing compared. */
  agreementRate: number | null;
  /** reasons of PENDING_REVIEW staged values (count per code) */
  pendingReviewReasons: Record<string, number>;
}

export function summarizeEconomicValues(
  snapshots: readonly SnapshotSample[],
  staged: readonly StagedSample[],
): EconomicValueStats {
  const count = (values: readonly string[]): Record<string, number> => {
    const result: Record<string, number> = {};
    for (const value of values) result[value] = (result[value] ?? 0) + 1;
    return result;
  };
  const pending = staged.filter((s) => s.verification_status === 'PENDING_REVIEW');
  const officialMismatches = pending.filter((s) => s.reasons.includes('OFFICIAL_MISMATCH')).length;
  const snapshotCounts = count(snapshots.map((s) => s.verification_status));
  const verified = snapshotCounts.VERIFIED ?? 0;
  return {
    snapshots: snapshotCounts,
    staged: count(staged.map((s) => s.verification_status)),
    officialMismatches,
    agreementRate: ratio(verified, verified + officialMismatches),
    pendingReviewReasons: count(pending.flatMap((s) => [...s.reasons])),
  };
}

// ---------------------------------------------------------------------------
// Whole report
// ---------------------------------------------------------------------------

export interface DataQualityInput {
  now: Date;
  /** completeness period [from, to) — `to` is a bit before `now` (the latest minutes wait for the next run) */
  period: Period;
  days: number;
  /** 1m and aggregated rows per pair, at least for [period.from, now) */
  pairs: readonly { symbol: string; rows: readonly FxRowSample[] }[];
  releases: readonly ReleaseInstant[];
  logs: readonly IngestionLogSample[];
  snapshots: readonly SnapshotSample[];
  staged: readonly StagedSample[];
}

export interface DataQualityReport {
  generatedAt: string;
  period: { from: string; to: string };
  days: number;
  fx: FxCompleteness[];
  fxTotals: { expectedMinutes: number; presentMinutes: number; missingMinutes: number; missingRate: number | null };
  /** now − close time of the newest 1m candle, per pair (null = no candle) */
  latestCandleAgeMinutes: Record<string, number | null>;
  releaseWindows: ReleaseWindowSummary;
  runs: JobRunStats[];
  fxSchedule: FxScheduleStats;
  speechTimeNotExact: number;
  economic: EconomicValueStats;
}

export function buildDataQualityReport(input: DataQualityInput): DataQualityReport {
  const now = input.now.getTime();
  const fx = input.pairs.map((pair) => computeFxCompleteness(pair.symbol, pair.rows, input.period));
  const expectedMinutes = fx.reduce((sum, f) => sum + f.expectedMinutes, 0);
  const presentMinutes = fx.reduce((sum, f) => sum + f.presentMinutes, 0);
  const latestCandleAgeMinutes: Record<string, number | null> = {};
  for (const f of fx) {
    latestCandleAgeMinutes[f.symbol] =
      f.latestCandleOpen === null ? null : Math.round((now - Date.parse(f.latestCandleOpen) - MINUTE_MS) / MINUTE_MS);
  }
  const usable = new Map(input.pairs.map((pair) => [pair.symbol, usableMinuteSet(pair.rows)]));
  return {
    generatedAt: input.now.toISOString(),
    period: { from: new Date(input.period.from).toISOString(), to: new Date(input.period.to).toISOString() },
    days: input.days,
    fx,
    fxTotals: {
      expectedMinutes,
      presentMinutes,
      missingMinutes: expectedMinutes - presentMinutes,
      missingRate: ratio(expectedMinutes - presentMinutes, expectedMinutes),
    },
    latestCandleAgeMinutes,
    releaseWindows: checkReleaseWindows(input.releases, usable, input.period),
    runs: summarizeRuns(input.logs),
    fxSchedule: analyzeFxSchedule(input.logs, now),
    speechTimeNotExact: countSpeechTimeNotExact(input.logs),
    economic: summarizeEconomicValues(input.snapshots, input.staged),
  };
}
