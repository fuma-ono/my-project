/**
 * Bar-by-bar backtest simulator.
 *
 * Timeline per bar i (range [startIndex, endIndex)):
 *  1. A pending order decided at the close of bar i-1 is filled at the OPEN of bar i, worse by
 *     spread/2 + slippage (long buys higher, short sells lower), plus commission per fill.
 *  2. Equity is marked at the close of bar i (mid close vs entry fill; realised PnL is net of costs).
 *  3. Unless i is the last bar, the strategy sees history[0..i] (data <= now) and returns a target;
 *     any change becomes the pending order for the next open. A reversal closes and opens in the same fill.
 *  4. On the last bar an open position is force-closed at that bar's close (mid, with the same costs).
 * History before startIndex is passed to the strategy (it is the past); only the range is traded.
 * Position size is 1 unit; all PnL is in pips.
 */
import { toEpochMs, type Bar } from '../technical/index.js';
import { fingerprintBars, fingerprintEvents } from './manifest.js';
import { computeMetrics } from './metrics.js';
import { ASSUMPTION_LABEL, constantSpread, type NearbyEvent, type SpreadModel } from './spread.js';
import type {
  BacktestResult,
  CostParams,
  Manifest,
  EventFeature,
  Side,
  Strategy,
  TargetPosition,
  Trade,
} from './types.js';

export interface SimulationOptions {
  barMs: number;
  pipSize: number;
  /** `costs.spreadPips` is used through a constant model unless `spreadModel` is given. */
  costs: CostParams;
  spreadModel?: SpreadModel;
  /** Pair code passed to the spread model (e.g. 'USDJPY'). */
  pair?: string;
  startIndex?: number;
  /** Exclusive. */
  endIndex?: number;
  /** Cap on history length handed to the strategy (cost control). Default: all history. */
  maxHistory?: number;
  codeVersion?: string;
  seed?: number;
  configsTried?: number;
}

interface Open {
  side: Side;
  index: number;
  time: number;
  mid: number;
  fill: number;
  spread: number;
}

export function runBacktest(
  bars: readonly Bar[],
  events: readonly EventFeature[],
  strategy: Strategy,
  opts: SimulationOptions,
): BacktestResult {
  const { barMs, pipSize, costs } = opts;
  if (!(pipSize > 0) || !(barMs > 0)) throw new RangeError('pipSize and barMs must be > 0');
  const start = opts.startIndex ?? 0;
  const end = opts.endIndex ?? bars.length;
  if (start < 0 || end > bars.length || start >= end) throw new RangeError('invalid range');

  const times = bars.map((b) => toEpochMs(b.t));
  const sortedEvents = [...events].sort((a, b) => a.eventTime - b.eventTime);
  const spreadModel = opts.spreadModel ?? constantSpread(costs.spreadPips);
  const pair = opts.pair ?? 'UNKNOWN';
  const eventTimes = sortedEvents.map((e) => e.eventTime);
  /** Full spread at a fill time; uses only the public event calendar (times/importance). */
  const spreadAt = (timeMs: number): number => {
    let nearby: NearbyEvent[] = [];
    if (spreadModel.lookaroundMs > 0) {
      let lo = 0;
      let hi = eventTimes.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (eventTimes[mid]! < timeMs - spreadModel.lookaroundMs) lo = mid + 1;
        else hi = mid;
      }
      for (let k = lo; k < sortedEvents.length && eventTimes[k]! <= timeMs + spreadModel.lookaroundMs; k++) {
        const e = sortedEvents[k]!;
        nearby.push({
          eventTime: e.eventTime,
          indicatorCode: e.indicatorCode,
          importance: e.importance,
          minutesFromEvent: (timeMs - e.eventTime) / 60_000,
        });
      }
    }
    nearby = nearby.sort(
      (a, b) => Math.abs(a.minutesFromEvent) - Math.abs(b.minutesFromEvent) || a.eventTime - b.eventTime,
    );
    return spreadModel.spreadPips({ pair, timeMs, nearestEvent: nearby[0] ?? null, nearbyEvents: nearby });
  };

  const trades: Trade[] = [];
  const equity: number[] = [];
  let realized = 0;
  let cur = null as Open | null;
  let pending: TargetPosition | undefined;
  let barsInPosition = 0;
  let visibleEvents = 0;

  const close = (i: number, mid: number, forced: boolean): void => {
    const o = cur as Open;
    const dir = o.side === 'long' ? 1 : -1;
    const exitSpread = spreadAt(times[i]! + (forced ? barMs : 0));
    const fill = mid - dir * ((exitSpread / 2 + costs.slippagePips) * pipSize);
    const grossPips = (dir * (mid - o.mid)) / pipSize;
    const costPips = (o.spread + exitSpread) / 2 + 2 * costs.slippagePips + 2 * costs.commissionPipsPerSide;
    const pnlPips = grossPips - costPips;
    trades.push({
      side: o.side,
      entryIndex: o.index,
      exitIndex: i,
      entryTime: o.time,
      exitTime: times[i]! + (forced ? barMs : 0),
      entryPrice: o.fill,
      exitPrice: fill,
      grossPips,
      costPips,
      pnlPips,
      forced,
      entrySpreadPips: o.spread,
      exitSpreadPips: exitSpread,
    });
    realized += (dir * (fill - o.fill)) / pipSize - costs.commissionPipsPerSide;
    cur = null;
  };

  for (let i = start; i < end; i++) {
    const bar = bars[i]!;
    if (pending !== undefined) {
      const target = pending;
      pending = undefined;
      if (cur && cur.side !== target) close(i, bar.o, false);
      if (!cur && target !== 'flat') {
        const dir = target === 'long' ? 1 : -1;
        const spread = spreadAt(times[i]!);
        const fill = bar.o + dir * ((spread / 2 + costs.slippagePips) * pipSize);
        cur = { side: target, index: i, time: times[i]!, mid: bar.o, fill, spread };
        realized -= costs.commissionPipsPerSide;
      }
    }
    const last = i === end - 1;
    if (last && cur) close(i, bar.c, true);
    if (cur) {
      barsInPosition++;
      const dir = cur.side === 'long' ? 1 : -1;
      equity.push(realized + (dir * (bar.c - cur.fill)) / pipSize);
    } else {
      equity.push(realized);
    }
    if (!last) {
      const nowMs = times[i]! + barMs;
      while (visibleEvents < sortedEvents.length && sortedEvents[visibleEvents]!.eventTime <= nowMs) visibleEvents++;
      const from = opts.maxHistory ? Math.max(0, i + 1 - opts.maxHistory) : 0;
      const history = bars.slice(from, i + 1);
      if (i + 1 >= strategy.warmupBars) {
        const decision = strategy.decide({
          history,
          events: sortedEvents.slice(0, visibleEvents),
          position: cur ? cur.side : 'flat',
          barIndex: i,
          nowMs,
          barMs,
        });
        if (decision !== undefined) pending = decision;
      }
    }
  }

  const metrics = computeMetrics(trades, equity, barsInPosition);
  return {
    trades,
    equity,
    metrics,
    manifest: {
      codeVersion: opts.codeVersion ?? 'unspecified',
      dataFingerprint: fingerprintBars(bars.slice(0, end)),
      eventsFingerprint: fingerprintEvents(sortedEvents),
      strategy: { name: strategy.name, params: strategy.params },
      costs,
      costAssumptions: costAssumptions(spreadModel, pair),
      pipSize,
      barMs,
      range: { startIndex: start, endIndex: end },
      seed: opts.seed ?? 0,
      configsTried: opts.configsTried ?? 1,
    },
  };
}

export function costAssumptions(spreadModel: SpreadModel, pair: string): Manifest['costAssumptions'] {
  return { label: ASSUMPTION_LABEL, pair, spreadModel: spreadModel.describe() };
}
