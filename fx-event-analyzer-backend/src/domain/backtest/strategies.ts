/**
 * Example strategies. They exist ONLY to exercise the backtest framework in tests.
 * They are not trading advice, not product features and carry no performance claim.
 */
import { rsi, sma } from '../technical/index.js';
import type { DecisionContext, Strategy, TargetPosition } from './types.js';

export function maCrossStrategy(fast: number, slow: number): Strategy {
  if (fast >= slow) throw new RangeError('fast must be < slow');
  return {
    name: 'ma_cross',
    params: { fast, slow },
    warmupBars: slow,
    decide(ctx: DecisionContext): TargetPosition | undefined {
      const closes = ctx.history.map((b) => b.c);
      const f = sma(closes, fast).at(-1);
      const s = sma(closes, slow).at(-1);
      if (f == null || s == null) return undefined;
      return f > s ? 'long' : f < s ? 'short' : undefined;
    },
  };
}

/** Long when RSI < low, short when RSI > high, flat once RSI crosses back through 50. */
export function rsiMeanReversionStrategy(period: number, low: number, high: number): Strategy {
  return {
    name: 'rsi_mean_reversion',
    params: { period, low, high },
    warmupBars: period + 1,
    decide(ctx: DecisionContext): TargetPosition | undefined {
      const r = rsi(
        ctx.history.map((b) => b.c),
        period,
      ).at(-1);
      if (r == null) return undefined;
      if (r < low) return 'long';
      if (r > high) return 'short';
      if (ctx.position === 'long' && r >= 50) return 'flat';
      if (ctx.position === 'short' && r <= 50) return 'flat';
      return undefined;
    },
  };
}

/**
 * Event-surprise breakout: after an event with |surprise| >= threshold becomes visible, trade in the
 * direction of the surprise for `holdBars` bars, then go flat. Uses only events already visible.
 */
export function eventSurpriseStrategy(threshold: number, holdBars: number, indicatorCode?: string): Strategy {
  return {
    name: 'event_surprise_breakout',
    params: { threshold, holdBars, indicatorCode: indicatorCode ?? '*' },
    warmupBars: 1,
    decide(ctx: DecisionContext): TargetPosition | undefined {
      let latest = null as (typeof ctx.events)[number] | null;
      for (const e of ctx.events) {
        if (indicatorCode !== undefined && e.indicatorCode !== indicatorCode) continue;
        if (Math.abs(e.surprise) >= threshold) latest = e;
      }
      if (!latest) return 'flat';
      const barsSince = Math.floor((ctx.nowMs - latest.eventTime) / ctx.barMs);
      if (barsSince >= holdBars) return 'flat';
      return latest.surprise > 0 ? 'long' : 'short';
    },
  };
}
