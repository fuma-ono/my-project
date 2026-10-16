/**
 * ③ (+ optional ⑤) 1-minute FX candles → fx_prices, upsert keyed by
 * (fx_pair_id, timeframe, timestamp = candle OPEN time). Gaps are
 * never filled with invented values; see validation/fxCandles.ts for the
 * checks. Missing minutes are re-FETCHED by the gap repair
 * (ingestFxWithGapRepair + fxGapRepair.ts, data-sources.md §6.4).
 *
 * 5m/15m/30m/60m are built here from 1m candles (not fetched separately):
 * every timeframe then agrees with the 1m data the reactions are computed
 * from, and it costs no extra provider requests. They are rebuilt from the
 * STORED 1m rows of every hour a window touches, so a bucket that mixes
 * earlier minutes and newly repaired ones is built too.
 *
 * Corrections: the provider's latest value wins (upsert overwrites). A
 * stored 1m row whose OHLC changes is counted as `corrected` (examples in
 * the log). Rows are never deleted.
 */
import { FX_FETCH_SETTINGS, INGESTION_SETTINGS, type FxFetchSettings } from '../config.js';
import type { CreditGate } from '../http.js';
import { findFxPairMapping, type FxPairMapping } from '../mappings/fxPairs.js';
import { floorMinute, MINUTE_MS } from '../marketHours.js';
import type { FxPriceProvider } from '../providers.js';
import type { JobCounters } from '../runner.js';
import type { FxPairRef, FxPriceRow, IngestionStore } from '../store.js';
import type { InstantRange, NormalizedCandle } from '../types.js';
import { checkCandles } from '../validation/fxCandles.js';
import { roundTo } from '../values.js';
import {
  classifyFetchError,
  classifyUnrecovered,
  noDataAfterRun,
  noDataHistoryFromLogs,
  planFxFetches,
  presentReadRange,
  type ExecutedWindow,
  type FetchKind,
  type NoDataInterval,
  type PairPlanInput,
  type RequestOutcome,
  type UnrecoveredInterval,
} from './fxGapRepair.js';

export interface FxPipelineDeps {
  store: IngestionStore;
  primary: FxPriceProvider;
  secondary?: FxPriceProvider;
  now?: () => Date;
}

const HOUR_MS = 60 * MINUTE_MS;
const LOG_LIST_CAP = 50;
const CORRECTION_EXAMPLES_CAP = 20;

/** Totals of one run; written as details.reconciliation. */
export interface FxReconciliation {
  fetched: number;
  accepted: number;
  rejected_by_reason: Record<string, number>;
  upserted_1m: number;
  upserted_aggregated: number;
  corrected: number;
  failed_requests: number;
  ok_requests: number;
  not_sent_requests: number;
}

function emptyReconciliation(): FxReconciliation {
  return {
    fetched: 0,
    accepted: 0,
    rejected_by_reason: {},
    upserted_1m: 0,
    upserted_aggregated: 0,
    corrected: 0,
    failed_requests: 0,
    ok_requests: 0,
    not_sent_requests: 0,
  };
}

interface RunState {
  reconciliation: FxReconciliation;
  corrections: { symbol: string; minute: string; old_close: number; new_close: number }[];
}

interface ResolvedPair {
  pair: FxPairRef;
  mapping: FxPairMapping;
}

/** Pairs that can be ingested; the others are skipped / errored exactly as before. */
async function resolvePairs(
  store: IngestionStore,
  symbols: readonly string[],
  counters: JobCounters,
): Promise<Map<string, ResolvedPair>> {
  const pairs = new Map((await store.listFxPairs()).map((pair) => [pair.symbol, pair]));
  const resolved = new Map<string, ResolvedPair>();
  for (const symbol of symbols) {
    const mapping = findFxPairMapping(symbol);
    const pair = pairs.get(symbol);
    if (!mapping || !pair) {
      counters.skip('PAIR_NOT_MAPPED');
      continue;
    }
    if (Number(pair.pip_size) !== mapping.pipSize || Number(pair.price_precision) !== mapping.pricePrecision) {
      counters.error(`${symbol}: fx_pairs pip_size/price_precision differ from mappings/fxPairs.ts — not ingested`);
      continue;
    }
    resolved.set(symbol, { pair, mapping });
  }
  return resolved;
}

function minuteKey(openTime: string): string {
  const ms = Date.parse(openTime);
  return Number.isNaN(ms) ? openTime : new Date(ms).toISOString();
}

/**
 * One candle per minute before validation, so every fetched candle is
 * counted exactly once: identical copies → DUPLICATE, differing copies →
 * all CONFLICTING_DUPLICATE (the validator rejects those minutes too).
 */
function dedupeByMinute(candles: readonly NormalizedCandle[]): {
  unique: NormalizedCandle[];
  rejected: Record<string, number>;
} {
  const groups = new Map<string, NormalizedCandle[]>();
  for (const candle of candles) {
    const key = minuteKey(candle.openTime);
    const group = groups.get(key) ?? [];
    group.push(candle);
    groups.set(key, group);
  }
  const unique: NormalizedCandle[] = [];
  const rejected: Record<string, number> = {};
  for (const group of groups.values()) {
    const first = group[0]!;
    if (group.length === 1) {
      unique.push(first);
      continue;
    }
    const same = group.every(
      (c) => c.open === first.open && c.high === first.high && c.low === first.low && c.close === first.close,
    );
    const reason = same ? 'DUPLICATE' : 'CONFLICTING_DUPLICATE';
    if (same) unique.push(first);
    rejected[reason] = (rejected[reason] ?? 0) + (same ? group.length - 1 : group.length);
  }
  return { unique, rejected };
}

function ohlcChanged(a: FxPriceRow, b: FxPriceRow): boolean {
  return (['open', 'high', 'low', 'close'] as const).some((k) => roundTo(a[k], 6) !== roundTo(b[k], 6));
}

interface WindowResult {
  outcome: RequestOutcome;
  /** Open times (ms) of the 1m rows written. */
  acceptedMinutes: number[];
  fetched: number;
  accepted: number;
  error?: unknown;
}

/** Fetch → validate → compare with stored rows → upsert 1m → rebuild 5m–60m, for one pair and one window. */
async function ingestWindow(
  deps: FxPipelineDeps,
  { pair, mapping }: ResolvedPair,
  range: InstantRange,
  kind: FetchKind,
  now: Date,
  counters: JobCounters,
  state: RunState,
): Promise<WindowResult> {
  const symbol = pair.symbol;
  let primary: NormalizedCandle[];
  try {
    primary = await deps.primary.fetchOneMinuteCandles(symbol, range);
  } catch (error) {
    // Twelve Data answers a range without any candle with { status: "error", code: 400,
    // message: "No data is available on the specified dates..." } — an OK, empty answer.
    if (!isNoDataAnswer(error)) {
      return { outcome: classifyFetchError(error), acceptedMinutes: [], fetched: 0, accepted: 0, error };
    }
    primary = [];
  }
  const rec = state.reconciliation;
  try {
    counters.fetched += primary.length;
    rec.fetched += primary.length;
    let secondary;
    if (deps.secondary) {
      try {
        secondary = await deps.secondary.fetchOneMinuteCandles(symbol, range);
      } catch (error) {
        // The cross-check is optional: without it candles are SINGLE_SOURCE, not dropped.
        counters.note('secondary_errors', `${symbol}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    const deduped = dedupeByMinute(primary);
    const checked = checkCandles(deduped.unique, {
      pipSize: mapping.pipSize,
      now,
      maxJumpPips: INGESTION_SETTINGS.fxMaxJumpPips,
      maxDiffPips: INGESTION_SETTINGS.fxCrossCheckMaxDiffPips,
      ...(secondary ? { secondary } : {}),
    });
    const rejected: Record<string, number> = { ...deduped.rejected };
    for (const { reason } of checked.rejected) rejected[reason] = (rejected[reason] ?? 0) + 1;
    let rejectedCount = 0;
    for (const [reason, count] of Object.entries(rejected)) {
      rejectedCount += count;
      rec.rejected_by_reason[reason] = (rec.rejected_by_reason[reason] ?? 0) + count;
      for (let i = 0; i < count; i += 1) counters.skip(`CANDLE_${reason}`);
    }
    rec.accepted += checked.accepted.length;
    if (primary.length !== checked.accepted.length + rejectedCount) {
      counters.error(
        `${symbol}: reconciliation mismatch fetched=${primary.length} accepted=${checked.accepted.length} rejected=${rejectedCount}`,
      );
    }
    const unverified = checked.accepted.filter((c) => c.verificationStatus === 'UNVERIFIED');
    counters.review += unverified.length;
    for (const c of unverified.slice(0, 20)) {
      counters.note('unverified_minutes', {
        symbol,
        minute: c.candle.openTime,
        diff_pips: c.crossCheckDiffPips,
        notes: c.notes,
      });
    }
    const minuteRows: FxPriceRow[] = checked.accepted.map((c) => ({
      fx_pair_id: pair.id,
      timestamp: new Date(c.candle.openTime).toISOString(),
      timeframe: '1m',
      open: c.candle.open,
      high: c.candle.high,
      low: c.candle.low,
      close: c.candle.close,
      volume: c.candle.volume,
      source: c.candle.provider,
      verification_status: c.verificationStatus,
      cross_check_source: c.crossCheckClose === null ? null : (deps.secondary?.name ?? null),
      cross_check_close: c.crossCheckClose,
      cross_check_diff_pips: c.crossCheckDiffPips,
    }));
    if (minuteRows.length === 0) {
      return { outcome: 'OK', acceptedMinutes: [], fetched: primary.length, accepted: 0 };
    }

    // Stored 1m rows of every hour the window touches: for the correction count and the aggregates.
    const firstMs = Date.parse(minuteRows[0]!.timestamp);
    const lastMs = Date.parse(minuteRows[minuteRows.length - 1]!.timestamp);
    const hourFrom = Math.floor(Math.min(firstMs, Date.parse(range.from)) / HOUR_MS) * HOUR_MS;
    const hourTo = Math.ceil(Math.max(lastMs + MINUTE_MS, Date.parse(range.to)) / HOUR_MS) * HOUR_MS;
    const stored = await deps.store.listFxMinuteRows(
      pair.id,
      new Date(hourFrom).toISOString(),
      new Date(hourTo).toISOString(),
    );
    const byMinute = new Map(stored.map((row) => [Date.parse(row.timestamp), row]));
    for (const row of minuteRows) {
      const old = byMinute.get(Date.parse(row.timestamp));
      if (old && ohlcChanged(old, row)) {
        rec.corrected += 1;
        if (state.corrections.length < CORRECTION_EXAMPLES_CAP) {
          state.corrections.push({ symbol, minute: row.timestamp, old_close: old.close, new_close: row.close });
        }
      }
    }

    const upserted1m = await deps.store.upsertFxPrices(minuteRows);
    rec.upserted_1m += upserted1m;
    if (upserted1m !== minuteRows.length) {
      counters.error(`${symbol}: upserted ${upserted1m} 1m rows, expected ${minuteRows.length}`);
    }
    for (const row of minuteRows) byMinute.set(Date.parse(row.timestamp), row);
    const merged = [...byMinute.values()];
    const aggregated = AGGREGATED_TIMEFRAMES.flatMap(({ timeframe, minutes }) =>
      aggregateMinuteRows(merged, timeframe, minutes, now),
    );
    const upsertedAggregated = aggregated.length > 0 ? await deps.store.upsertFxPrices(aggregated) : 0;
    rec.upserted_aggregated += upsertedAggregated;
    counters.success += upserted1m + upsertedAggregated;
    if (kind === 'FORWARD') {
      // 時刻ずれの計測用(data-sources.md 12章): この実行で取れた最新の1分足の始まりの時刻。
      counters.note('latest_candle', { symbol, open_time: minuteRows[minuteRows.length - 1]?.timestamp ?? null });
    }
    return {
      outcome: 'OK',
      acceptedMinutes: minuteRows.map((row) => Date.parse(row.timestamp)),
      fetched: primary.length,
      accepted: minuteRows.length,
    };
  } catch (error) {
    // Fetched, but storing failed (DB): the window did not deliver.
    return { outcome: 'API_ERROR', acceptedMinutes: [], fetched: primary.length, accepted: 0, error };
  }
}

function isNoDataAnswer(error: unknown): boolean {
  return error instanceof Error && /^twelvedata \S+: 400 No data is available/i.test(error.message);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Fixed-range ingestion (one request per pair for `range`). Kept for
 * callers that want exactly one window; the scheduled job uses
 * ingestFxWithGapRepair.
 */
export async function ingestFxCandles(
  deps: FxPipelineDeps,
  symbols: readonly string[],
  range: InstantRange,
  counters: JobCounters,
): Promise<void> {
  const now = (deps.now ?? (() => new Date()))();
  const state: RunState = { reconciliation: emptyReconciliation(), corrections: [] };
  const resolved = await resolvePairs(deps.store, symbols, counters);
  for (const pair of resolved.values()) {
    const result = await ingestWindow(deps, pair, range, 'FORWARD', now, counters, state);
    if (result.outcome !== 'OK') counters.error(`${pair.pair.symbol}: ${errorText(result.error)}`);
  }
}

export interface FxGapRepairDeps extends FxPipelineDeps {
  /** The credit gate wired into the primary provider's HttpClient (beforeAttempt). */
  gate: CreditGate;
  mode: 'AUTOMATIC' | 'MANUAL';
  settings?: FxFetchSettings;
}

export interface FxGapRepairOptions {
  symbols: readonly string[];
  /** Manual override of the FORWARD window length (--minutes), capped at maxWindowMinutes. */
  forwardMinutes?: number;
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

/**
 * ingest:fx-prices body: plan (fxGapRepair.ts) → execute sequentially →
 * record everything in counters.details (one ingestion_logs row):
 * api_requests, budget, requests, unrecovered, unrecovered_total,
 * no_data_unconfirmed, reconciliation, corrections, latest_candle, range.
 */
export async function ingestFxWithGapRepair(
  deps: FxGapRepairDeps,
  options: FxGapRepairOptions,
  counters: JobCounters,
): Promise<void> {
  const settings = deps.settings ?? FX_FETCH_SETTINGS;
  const now = (deps.now ?? (() => new Date()))();
  const nowMs = now.getTime();
  const nowMin = floorMinute(nowMs);
  const { gate } = deps;
  const provider = gate.spec.provider;
  const dailyCap = gate.spec.dailyCap;
  const state: RunState = { reconciliation: emptyReconciliation(), corrections: [] };
  const forwardMinutes = Math.min(options.forwardMinutes ?? settings.forwardMinutes, settings.maxWindowMinutes);
  counters.details.api_requests = 0;
  counters.details.range = [{ from: iso(nowMin - forwardMinutes * MINUTE_MS), to: iso(nowMin) }];

  const resolved = await resolvePairs(deps.store, options.symbols, counters);
  const usedBefore = await deps.store.todayApiCredits(provider);
  const budgetLeft = Math.max(0, dailyCap - usedBefore);
  const budget = { mode: deps.mode, daily: dailyCap, used_before_run: usedBefore, left_after_run: budgetLeft };
  counters.details.budget = budget;
  if (budgetLeft === 0) {
    counters.note(
      'notes',
      `${provider}: daily credit cap already reached before this run (${usedBefore}/${dailyCap}, ${deps.mode}) — no request sent; missing minutes stay unrecovered (BUDGET) and are fetched after 00:00 UTC`,
    );
  }

  const logs = await deps.store.listRecentFxIngestionLogs(iso(nowMin - settings.repairHorizonDays * 86_400_000));
  const history = noDataHistoryFromLogs(logs);
  const present = new Map<string, Set<number>>();
  const inputs: PairPlanInput[] = [];
  for (const { pair } of resolved.values()) {
    const firstIso = await deps.store.firstFxMinute(pair.id);
    const firstMinute = firstIso === null ? null : Date.parse(firstIso);
    const read = presentReadRange(nowMs, firstMinute, settings);
    const minutes =
      read.from < read.to ? await deps.store.listFxMinuteTimestamps(pair.id, iso(read.from), iso(read.to)) : [];
    const set = new Set(minutes.map((m) => Date.parse(m)));
    present.set(pair.symbol, set);
    inputs.push({ symbol: pair.symbol, firstMinute, present: set, noDataHistory: history.get(pair.symbol) ?? [] });
  }

  const plan = planFxFetches({
    now: nowMs,
    pairs: inputs,
    maxRequests: Math.min(settings.perRunRequestCap, budgetLeft),
    settings,
    forwardMinutes,
  });

  const executed = new Map<string, ExecutedWindow[]>();
  let stopped: 'RATE_LIMITED' | 'BUDGET' | null = null;
  const rec = state.reconciliation;
  for (const request of plan.requests) {
    if (stopped) {
      rec.not_sent_requests += 1;
      continue;
    }
    const target = resolved.get(request.symbol)!;
    const range = { from: iso(request.from), to: iso(request.to) };
    const result = await ingestWindow(deps, target, range, request.kind, now, counters, state);
    counters.details.api_requests = gate.reserved;
    const list = executed.get(request.symbol) ?? [];
    list.push({ request, outcome: result.outcome });
    executed.set(request.symbol, list);
    counters.note('requests', {
      symbol: request.symbol,
      kind: request.kind,
      ...range,
      outcome: result.outcome,
      fetched: result.fetched,
      accepted: result.accepted,
    });
    const set = present.get(request.symbol)!;
    for (const ms of result.acceptedMinutes) set.add(ms);

    if (result.outcome === 'OK') {
      rec.ok_requests += 1;
      continue;
    }
    if (result.outcome === 'BUDGET') {
      rec.not_sent_requests += 1;
      stopped = 'BUDGET';
      const why =
        gate.refusal === 'LEDGER_UNAVAILABLE'
          ? 'credit ledger unavailable'
          : gate.refusal === 'RUN_CAP'
            ? `per-run cap ${settings.perRunRequestCap} reached`
            : `daily credit cap ${dailyCap} (${deps.mode}) reached`;
      counters.error(`${provider}: ${why} — request not sent; remaining windows recorded as unrecovered (BUDGET)`);
      counters.note('notes', `${provider}: ${why} at ${request.symbol} ${range.from}–${range.to}; stopped`);
      continue;
    }
    rec.failed_requests += 1;
    counters.error(`${request.symbol}: ${result.outcome}: ${errorText(result.error)}`);
    if (result.outcome === 'RATE_LIMITED') {
      // Retries are done inside HttpClient; a 429 that still fails means the quota is gone for now.
      stopped = 'RATE_LIMITED';
      counters.note('notes', `${provider}: rate limited (429) — no further requests in this run`);
    }
  }

  const unrecovered: UnrecoveredInterval[] = [];
  const noData: Record<string, NoDataInterval[]> = {};
  for (const [symbol, pairPlan] of plan.pairs) {
    const after = present.get(symbol)!;
    const done = executed.get(symbol) ?? [];
    unrecovered.push(...classifyUnrecovered(pairPlan, after, done));
    const empty = noDataAfterRun(pairPlan, after, done);
    if (empty.length > 0) noData[symbol] = empty.slice(-LOG_LIST_CAP);
  }
  const priority = (u: UnrecoveredInterval) => (u.reason === 'BEYOND_HORIZON' ? 1 : 0);
  unrecovered.sort((a, b) => priority(a) - priority(b) || Date.parse(b.from) - Date.parse(a.from));
  counters.details.unrecovered = unrecovered.slice(0, LOG_LIST_CAP);
  counters.details.unrecovered_total = unrecovered.length;
  counters.details.no_data_unconfirmed = noData;
  counters.details.reconciliation = rec;
  counters.details.corrections = state.corrections;
  counters.details.api_requests = gate.reserved;
  try {
    budget.left_after_run = Math.max(0, dailyCap - (await deps.store.todayApiCredits(provider)));
  } catch {
    budget.left_after_run = Math.max(0, budgetLeft - gate.reserved);
  }
}

export const AGGREGATED_TIMEFRAMES = [
  { timeframe: '5m', minutes: 5 },
  { timeframe: '15m', minutes: 15 },
  { timeframe: '30m', minutes: 30 },
  { timeframe: '60m', minutes: 60 },
] as const satisfies readonly { timeframe: FxPriceRow['timeframe']; minutes: number }[];

/**
 * Builds `timeframe` candles (open time aligned to `minutes` in UTC) from
 * 1m rows of ONE pair. A bucket is written only when every one of its
 * minutes is present, none is UNVERIFIED and the bucket has fully passed —
 * a partial bucket would show a wrong high/low/close, so it is left out
 * (a later run that completes the bucket writes it). Status: VERIFIED only
 * when every minute is VERIFIED, otherwise SINGLE_SOURCE.
 */
export function aggregateMinuteRows(
  rows: readonly FxPriceRow[],
  timeframe: Exclude<FxPriceRow['timeframe'], '1m'>,
  minutes: number,
  now: Date,
): FxPriceRow[] {
  const bucketMs = minutes * MINUTE_MS;
  const byMinute = new Map(rows.map((row) => [Date.parse(row.timestamp), row]));
  const buckets = new Set([...byMinute.keys()].map((ms) => Math.floor(ms / bucketMs) * bucketMs));
  const result: FxPriceRow[] = [];
  for (const start of [...buckets].sort((a, b) => a - b)) {
    if (start + bucketMs > now.getTime()) continue;
    const parts: FxPriceRow[] = [];
    for (let ms = start; ms < start + bucketMs; ms += MINUTE_MS) {
      const row = byMinute.get(ms);
      if (!row || row.verification_status === 'UNVERIFIED') break;
      parts.push(row);
    }
    if (parts.length !== minutes) continue;
    const first = parts[0]!;
    const last = parts[parts.length - 1]!;
    const volumes = parts.map((p) => p.volume);
    result.push({
      fx_pair_id: first.fx_pair_id,
      timestamp: new Date(start).toISOString(),
      timeframe,
      open: first.open,
      high: Math.max(...parts.map((p) => p.high)),
      low: Math.min(...parts.map((p) => p.low)),
      close: last.close,
      volume: volumes.every((v) => v !== null) ? volumes.reduce<number>((sum, v) => sum + (v ?? 0), 0) : null,
      source: first.source,
      verification_status: parts.every((p) => p.verification_status === 'VERIFIED') ? 'VERIFIED' : 'SINGLE_SOURCE',
      cross_check_source: null,
      cross_check_close: null,
      cross_check_diff_pips: null,
    });
  }
  return result;
}
