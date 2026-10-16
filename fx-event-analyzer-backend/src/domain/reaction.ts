/**
 * Market Reaction calculation — api-design.md §10, db-design.md §3.12.
 * pre_release_price is always a separate input, never a "BEFORE"
 * timeframe row.
 */

export interface ReactionInputs {
  preReleasePrice: number | null;
  postReleasePrice: number | null;
  pipSize: number;
}

export interface ReactionResult {
  movement: number | null;
  pips: number | null;
  changePercent: number | null;
}

export function calculateReaction(inputs: ReactionInputs): ReactionResult {
  const { preReleasePrice, postReleasePrice, pipSize } = inputs;
  if (preReleasePrice === null || postReleasePrice === null) {
    return { movement: null, pips: null, changePercent: null };
  }

  const movement = postReleasePrice - preReleasePrice;
  const pips = movement / pipSize;
  const changePercent = (movement / preReleasePrice) * 100;

  return { movement, pips, changePercent };
}

export interface MaxExcursionInputs {
  preReleasePrice: number | null;
  /** Every price observed within the release-to-timeframe window. */
  pricesInWindow: number[];
  pipSize: number;
}

export interface MaxExcursionResult {
  maxUpward: number | null;
  maxDownward: number | null;
  maxUpwardPips: number | null;
  maxDownwardPips: number | null;
}

/**
 * pre_release_price-relative max/min excursion within the window — NOT a
 * cumulative delta between consecutive candles (db-design.md §3.12).
 */
export function calculateMaxExcursion(inputs: MaxExcursionInputs): MaxExcursionResult {
  const { preReleasePrice, pricesInWindow, pipSize } = inputs;
  if (preReleasePrice === null || pricesInWindow.length === 0) {
    return { maxUpward: null, maxDownward: null, maxUpwardPips: null, maxDownwardPips: null };
  }

  const deltas = pricesInWindow.map((price) => price - preReleasePrice);
  const maxUpward = Math.max(...deltas);
  const maxDownward = Math.min(...deltas);

  return {
    maxUpward,
    maxDownward,
    maxUpwardPips: maxUpward / pipSize,
    maxDownwardPips: maxDownward / pipSize,
  };
}
