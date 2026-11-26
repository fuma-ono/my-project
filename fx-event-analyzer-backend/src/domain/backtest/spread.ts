/**
 * Pluggable spread models. Every number here is an ASSUMPTION supplied by the caller, never a
 * measured spread; `describe()` output is copied into the result manifest so reports cannot be
 * mistaken for measured transaction costs.
 *
 * spread(pair, time, events) = base[pair] * hourMultiplier[UTC hour] * eventMultiplier
 *  - eventMultiplier = max over nearby events and matching windows (1 if none). A window matches an
 *    event when its importance equals the event's importance (or the window importance is '*') and
 *    the fill time minus eventTime, in minutes, lies in [fromMinutes, toMinutes] (negative = before
 *    the release). Event TIMES (the calendar) are public in advance, so widening before a release does
 *    not leak the surprise value.
 *  - hourMultipliers are indexed by UTC hour 0..23 (use them for thin Asian / rollover hours;
 *    rollover is around 21-22 UTC depending on DST).
 */
export interface NearbyEvent {
  eventTime: number;
  indicatorCode: string;
  importance: string | number | undefined;
  /** (fill time - eventTime) / 60000; negative before the event. */
  minutesFromEvent: number;
}

export interface SpreadContext {
  pair: string;
  /** Fill time, epoch ms UTC. */
  timeMs: number;
  /** Event with the smallest |minutesFromEvent| within the model's look-around, else null. */
  nearestEvent: NearbyEvent | null;
  /** All events within the model's look-around (any importance). */
  nearbyEvents: readonly NearbyEvent[];
}

export interface SpreadModel {
  readonly id: string;
  /** How far (ms, both directions) the simulator should look for events around a fill. 0 = none. */
  readonly lookaroundMs: number;
  /** Full (round-turn-half-each-side) spread in pips at the given context. */
  spreadPips(ctx: SpreadContext): number;
  /** Machine-readable assumptions for the manifest. */
  describe(): Record<string, unknown>;
}

export const ASSUMPTION_LABEL = 'ASSUMPTION: cost parameters are not measured spreads';

function assertNonNegative(x: number, what: string): void {
  if (!Number.isFinite(x) || x < 0) throw new RangeError(`${what} must be a finite number >= 0`);
}

export function constantSpread(pips: number): SpreadModel {
  assertNonNegative(pips, 'spread');
  return {
    id: 'constant',
    lookaroundMs: 0,
    spreadPips: () => pips,
    describe: () => ({ kind: 'constant', spreadPips: pips, label: ASSUMPTION_LABEL }),
  };
}

export interface EventSpreadWindow {
  importance: string | number; // '*' matches any importance
  fromMinutes: number;
  toMinutes: number;
  multiplier: number;
}

export interface TableSpreadConfig {
  basePipsByPair: Readonly<Record<string, number>>;
  /** Used for pairs missing from basePipsByPair. */
  defaultBasePips: number;
  /** 24 multipliers indexed by UTC hour; default all 1. */
  hourMultipliersUtc?: readonly number[];
  eventWindows?: readonly EventSpreadWindow[];
}

export function tableSpread(cfg: TableSpreadConfig): SpreadModel {
  assertNonNegative(cfg.defaultBasePips, 'defaultBasePips');
  for (const [p, v] of Object.entries(cfg.basePipsByPair)) assertNonNegative(v, `base spread for ${p}`);
  const hours = cfg.hourMultipliersUtc ?? new Array<number>(24).fill(1);
  if (hours.length !== 24) throw new RangeError('hourMultipliersUtc must have 24 entries');
  hours.forEach((m, h) => assertNonNegative(m, `hour multiplier ${h}`));
  const windows = cfg.eventWindows ?? [];
  for (const w of windows) {
    assertNonNegative(w.multiplier, 'event multiplier');
    if (!(w.fromMinutes <= w.toMinutes)) throw new RangeError('event window fromMinutes must be <= toMinutes');
  }
  const lookaroundMs =
    windows.reduce((a, w) => Math.max(a, Math.abs(w.fromMinutes), Math.abs(w.toMinutes)), 0) * 60_000;
  return {
    id: 'table',
    lookaroundMs,
    spreadPips(ctx) {
      const base = cfg.basePipsByPair[ctx.pair] ?? cfg.defaultBasePips;
      const hourMult = hours[new Date(ctx.timeMs).getUTCHours()]!;
      let eventMult = 1;
      for (const e of ctx.nearbyEvents) {
        for (const w of windows) {
          if (w.importance !== '*' && w.importance !== e.importance) continue;
          if (e.minutesFromEvent >= w.fromMinutes && e.minutesFromEvent <= w.toMinutes) {
            eventMult = Math.max(eventMult, w.multiplier);
          }
        }
      }
      return base * hourMult * eventMult;
    },
    describe: () => ({
      kind: 'table',
      basePipsByPair: { ...cfg.basePipsByPair },
      defaultBasePips: cfg.defaultBasePips,
      hourMultipliersUtc: [...hours],
      eventWindows: windows.map((w) => ({ ...w })),
      label: ASSUMPTION_LABEL,
    }),
  };
}
