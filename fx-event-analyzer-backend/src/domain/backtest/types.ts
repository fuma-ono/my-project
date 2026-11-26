/**
 * Backtest framework types (pure; no I/O, no provider/DB dependency).
 *
 * IMPORTANT: everything here exists to TEST and VERIFY strategies. Example strategies are framework
 * fixtures, not product claims. Results are historical simulations and never a promise of returns.
 */
import type { Bar } from '../technical/index.js';

export type Side = 'long' | 'short';
export type TargetPosition = Side | 'flat';

/** Event feature record. It becomes visible to a strategy only once `eventTime` <= decision time. */
export interface EventFeature {
  /** Epoch ms UTC at which the information became public (release time, not a later revision time). */
  eventTime: number;
  indicatorCode: string;
  /** Importance label/level of the release (used by spread models; public calendar info). */
  importance?: string | number | undefined;
  /** Standardised surprise (actual - forecast, normalised) known AT eventTime. */
  surprise: number;
  [extra: string]: number | string | undefined;
}

export interface DecisionContext {
  /** Bars up to and INCLUDING the bar that just closed (copy; mutation cannot affect the simulator). */
  history: readonly Bar[];
  /** Events with eventTime <= close time of the latest bar in `history`. */
  events: readonly EventFeature[];
  /** Current position after the fills that happened at this bar's open. */
  position: TargetPosition;
  /** Absolute index (into the full bar array) of the latest bar in `history`. */
  barIndex: number;
  /** Close time (epoch ms) of the latest bar = decision time. */
  nowMs: number;
  barMs: number;
}

/**
 * Strategy contract. `decide` is called once per closed bar and returns the desired position
 * (or undefined = keep). The order is filled at the OPEN of the NEXT bar. The strategy only
 * receives data <= now, so look-ahead is impossible by construction.
 */
export interface Strategy {
  readonly name: string;
  readonly params: Readonly<Record<string, number | string>>;
  /** Minimum number of bars of history before `decide` is called. */
  readonly warmupBars: number;
  decide(ctx: DecisionContext): TargetPosition | undefined;
}

export interface CostParams {
  /** Default constant spread in pips (half paid on each fill) when no SpreadModel is given. ASSUMPTION. */
  spreadPips: number;
  /** Adverse slippage per fill, in pips. */
  slippagePips: number;
  /** Commission per fill (per side), in pips. */
  commissionPipsPerSide: number;
}

export interface Trade {
  side: Side;
  entryIndex: number;
  exitIndex: number;
  entryTime: number;
  exitTime: number;
  entryPrice: number;
  exitPrice: number;
  grossPips: number;
  costPips: number;
  /** Net PnL in pips (gross - costs). */
  pnlPips: number;
  /** True when closed by the end of the simulated range rather than by the strategy. */
  forced: boolean;
  /** Full spread (pips) used at entry / exit; half of each is paid on that fill. */
  entrySpreadPips: number;
  exitSpreadPips: number;
}

export interface Metrics {
  trades: number;
  wins: number;
  hitRate: number | null;
  totalPips: number;
  expectancyPips: number | null;
  avgWinPips: number | null;
  avgLossPips: number | null;
  /** gross profit / gross loss; null when there are no losing trades or no trades. */
  profitFactor: number | null;
  maxDrawdownPips: number;
  /** Fraction of evaluated bars with an open position. */
  exposure: number;
  /** mean/sd of per-trade net pips (no annualisation). */
  sharpeLikePerTrade: number | null;
  /** mean/sd of per-bar equity changes (no annualisation). */
  sharpeLikePerBar: number | null;
  caveats: readonly string[];
}

export interface Manifest {
  codeVersion: string;
  dataFingerprint: string;
  eventsFingerprint: string;
  strategy: { name: string; params: Readonly<Record<string, number | string>> } | null;
  costs: CostParams;
  /** Every cost number is an assumption, never a measured spread. */
  costAssumptions: { label: string; pair: string; spreadModel: Record<string, unknown> };
  pipSize: number;
  barMs: number;
  range: { startIndex: number; endIndex: number };
  seed: number;
  /** Number of strategy configurations examined to produce this result (multiple-testing). */
  configsTried: number;
}

export interface BacktestResult {
  trades: Trade[];
  /** Cumulative net pips marked to market at each bar close in [startIndex, endIndex). */
  equity: number[];
  metrics: Metrics;
  manifest: Manifest;
}
