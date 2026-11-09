import { MAJOR_FX_PAIR_ORDER } from './majorFxReactions.js';

/**
 * Pro イベント別トレード戦略分析(HQ指示 2026-11-06「Pro イベント別トレード戦略分析」、api-design v1.48)。
 *
 * 同じ指標の過去の発表(この発表より前の RELEASED、直近 STRATEGY_SAMPLE_WINDOW 回)の、保存済みの値動き
 * (event_price_reactions)と RELEASE スナップショット(event_snapshots)だけから、発表後の値動きの傾向を数える。
 * 値・価格・時刻を作らない。データの無い項目は null(推測で埋めない)。売買の推奨・利益・勝率は出さない。
 *
 * 各項目の決め方(どれも保存済みの値だけで決まる):
 * - direction_1m: 1分後の pips の符号(UP / DOWN / FLAT)。
 * - 1分の高値・安値のブレイク(high_break_15m など): event_price_reactions の max_upward・max_downward は、発表直前の価格
 *   からの、窓の中の足の高値・安値の最大・最小(domain/economicEventReactions.ts。窓 = 足の終わりが発表より後〜発表の N 分後)。
 *   1分の窓 = 発表後の最初の1分の足なので、15分の窓の max_upward が1分の max_upward より大きければ、2分目以降に最初の1分の
 *   高値を上に抜けた(high_break)。安値も同じ(low_break)。**どちらが先に起きたかは、この値からは分からないので出さない。**
 *   HQ指示(2026-11-07「1分足欠損への対応」): 15分・60分のブレイク判定は、その窓の1分足が全部(15本・60本)揃っていて、
 *   どれも欠損・UNVERIFIEDでない(minuteCompleteness15m/60m、historicalRepository.listMinuteCandleCompleteness)ときだけ
 *   行う。event_price_reactions.data_status = AVAILABLE は窓の境界の価格が取れたことしか意味せず、窓の途中の1分足の
 *   欠損までは保証しないため、別途1分足を数えて確かめる。欠けていれば「ブレイクなし」にはせず null(判定不能)にする。
 *   1分・5分の判定(direction_1m・pips_1m・pips_15m・pattern_15m)はこの確認の対象外(既存のまま)。
 * - pattern_15m: 1分後と15分後の pips の符号が同じなら CONTINUATION、逆なら REVERSAL(どちらかが 0 または無ければ null)。
 * - surprise・surprise_direction: RELEASE スナップショットのまま(surprise = 結果 − 予想。surprise_direction は指標の好ましい
 *   方向を考えた、その通貨にとっての良し悪し。domain/surprise.ts)。予想が無い発表は null。
 * - sell_the_fact: 結果がその通貨にとって良かった(surprise_direction = POSITIVE)のに、15分後にその通貨が売られた方向に
 *   動いた(通貨が通貨ペアの前なら pips < 0、後なら pips > 0)。POSITIVE でない発表・指標の通貨が通貨ペアに無い・
 *   15分後の値が無い場合は null(判定しない)。
 *   HQ指示(2026-11-09 P0): 発表時刻が EXACT でない発表(APPROXIMATE・DATE_ONLY・UNKNOWN)は判定しない(null)。1分の値動きは
 *   精度の決まり(domain/dataQuality.ts)で作られないのに、15分の値動きだけで判定されて件数に入っていたため。
 *   この項目は「好結果なのに15分後に通貨安」(初動は問わない)。
 * - sell_the_fact_after_initial_rise(HQ指示 2026-11-09 P0): 「好結果で、初動(1分後)は通貨高、その後15分後には通貨安」。
 *   条件は sell_the_fact と同じ(POSITIVE・EXACT・指標の通貨が通貨ペアにある)に加えて、1分後と15分後の値の両方が要る。
 *   1分後が通貨高でなかった(横ばいを含む)発表は false(判定はした)。分母は sell_the_fact と同じく「結果が良かった発表」。
 * 傾向の要約(summary)は、その項目を判定できた発表が STRATEGY_MINIMUM_SAMPLES 回以上あるときだけ数える(少なければ null =
 * 「分析データ準備中」。傾向を断定しない)。
 */

export const STRATEGY_SAMPLE_WINDOW = 5;
export const STRATEGY_MINIMUM_SAMPLES = 3;
export const STRATEGY_TIMEFRAMES = ['1m', '15m', '60m'] as const;

export interface StrategyReactionInput {
  timeframe: string;
  pips: number | null;
  max_upward: number | null;
  max_downward: number | null;
  data_status: string;
}

export interface StrategyReleaseInput {
  event_id: string;
  release_datetime: string;
  forecast: number | null;
  actual: number | null;
  surprise: number | null;
  surprise_direction: string | null;
  /** economic_events.release_datetime_precision。EXACT 以外は Sell the Fact を判定しない(HQ指示 2026-11-09 P0)。 */
  release_datetime_precision: string;
  reactions: readonly StrategyReactionInput[];
  /** HQ指示(2026-11-07): 発表から15分・60分の窓に1分足が欠けなく(15本・60本)あり、どれもUNVERIFIEDでないか。 */
  minuteCompleteness15m: boolean;
  minuteCompleteness60m: boolean;
}

export type Direction = 'UP' | 'DOWN' | 'FLAT';
export type Pattern = 'CONTINUATION' | 'REVERSAL';

export interface StrategyReleaseRow {
  event_id: string;
  release_datetime: string;
  forecast: number | null;
  actual: number | null;
  surprise: number | null;
  surprise_direction: string | null;
  direction_1m: Direction | null;
  pips_1m: number | null;
  pips_15m: number | null;
  pattern_15m: Pattern | null;
  high_break_15m: boolean | null;
  low_break_15m: boolean | null;
  high_break_60m: boolean | null;
  low_break_60m: boolean | null;
  sell_the_fact: boolean | null;
  sell_the_fact_after_initial_rise: boolean | null;
}

export interface BreakSummary {
  high: number;
  low: number;
  both: number;
  neither: number;
  samples: number;
}

export interface StrategySummary {
  direction_1m: { up: number; down: number; flat: number; samples: number } | null;
  breaks_15m: BreakSummary | null;
  breaks_60m: BreakSummary | null;
  pattern_15m: { continuation: number; reversal: number; samples: number } | null;
  sell_the_fact: { occurred: number; samples: number } | null;
  sell_the_fact_after_initial_rise: { occurred: number; samples: number } | null;
}

export interface StrategyAnalysis {
  /** READY = 1分後の値動きを比べられた発表が STRATEGY_MINIMUM_SAMPLES 回以上。足りなければ DATA_PREPARING。 */
  status: 'READY' | 'DATA_PREPARING';
  sample_window: number;
  minimum_samples: number;
  releases: StrategyReleaseRow[];
  summary: StrategySummary;
}

function available(reactions: readonly StrategyReactionInput[], timeframe: string): StrategyReactionInput | null {
  return reactions.find((r) => r.timeframe === timeframe && r.data_status === 'AVAILABLE') ?? null;
}

const sign = (value: number) => (value > 0 ? 1 : value < 0 ? -1 : 0);

/**
 * `complete` が false(1分足の欠損・UNVERIFIEDを含む)のときは、high/max_upward 等があっても判定せず null にする
 * (欠損を「ブレイクなし」にしない、HQ指示 2026-11-07)。
 */
function breaks(
  first: StrategyReactionInput | null,
  window: StrategyReactionInput | null,
  complete: boolean,
): { high: boolean | null; low: boolean | null } {
  if (!first || !window || !complete) return { high: null, low: null };
  const high =
    first.max_upward === null || window.max_upward === null
      ? null
      : Number(window.max_upward) > Number(first.max_upward);
  const low =
    first.max_downward === null || window.max_downward === null
      ? null
      : Number(window.max_downward) < Number(first.max_downward);
  return { high, low };
}

/** 指標の通貨が通貨ペアのどちらにあるか(USDJPY の USD = 'BASE'、JPY = 'QUOTE')。無ければ null。 */
export function currencySide(symbol: string, currency: string | null): 'BASE' | 'QUOTE' | null {
  if (!currency || symbol.length !== 6) return null;
  if (symbol.slice(0, 3) === currency) return 'BASE';
  if (symbol.slice(3, 6) === currency) return 'QUOTE';
  return null;
}

export interface StrategyPairCandidate {
  fx_pair_id: string;
  symbol: string;
  base_currency: string;
  quote_currency: string;
  is_active: boolean;
  /** indicator_fx_pairs.priority(関連の通貨ペアのとき)。 */
  priority: number;
}

/**
 * HQ指示(2026-11-09 P0「通貨ペアの選択・並び順」): 分析に使える通貨ペアか。有効(fx_pairs.is_active)で、指標の通貨を
 * 含むペアだけ(値動き event_price_reactions はこのペアにしか計算されない、ingestion/pipelines/eventReactions.ts)。
 */
export function isUsableStrategyPair(
  pair: Pick<StrategyPairCandidate, 'base_currency' | 'quote_currency' | 'is_active'>,
  currency: string | null,
): boolean {
  return pair.is_active && currency !== null && (pair.base_currency === currency || pair.quote_currency === currency);
}

/**
 * 既定の通貨ペア: 指標の関連の通貨ペア(indicator_fx_pairs が有効なもの)のうち、使えるペアを priority の小さい順、
 * 同じ priority なら主要ペアの順(MAJOR_FX_PAIR_ORDER)、最後に symbol 順で並べた先頭。使えるペアが無ければ null。
 */
export function selectDefaultStrategyPair(
  related: readonly StrategyPairCandidate[],
  currency: string | null,
): StrategyPairCandidate | null {
  const rank = (symbol: string) => {
    const index = (MAJOR_FX_PAIR_ORDER as readonly string[]).indexOf(symbol);
    return index === -1 ? MAJOR_FX_PAIR_ORDER.length : index;
  };
  const usable = related
    .filter((pair) => isUsableStrategyPair(pair, currency))
    .sort(
      (a, b) =>
        a.priority - b.priority ||
        rank(a.symbol) - rank(b.symbol) ||
        (a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0),
    );
  return usable[0] ?? null;
}

export function analyzeRelease(release: StrategyReleaseInput, side: 'BASE' | 'QUOTE' | null): StrategyReleaseRow {
  const m1 = available(release.reactions, '1m');
  const m15 = available(release.reactions, '15m');
  const m60 = available(release.reactions, '60m');
  const pips1 = m1?.pips === null || m1?.pips === undefined ? null : Number(m1.pips);
  const pips15 = m15?.pips === null || m15?.pips === undefined ? null : Number(m15.pips);
  const direction = pips1 === null ? null : pips1 > 0 ? 'UP' : pips1 < 0 ? 'DOWN' : 'FLAT';
  const pattern =
    pips1 === null || pips15 === null || sign(pips1) === 0 || sign(pips15) === 0
      ? null
      : sign(pips1) === sign(pips15)
        ? 'CONTINUATION'
        : 'REVERSAL';
  const b15 = breaks(m1, m15, release.minuteCompleteness15m);
  const b60 = breaks(m1, m60, release.minuteCompleteness60m);
  let sellTheFact: boolean | null = null;
  let afterInitialRise: boolean | null = null;
  if (
    release.surprise_direction === 'POSITIVE' &&
    release.release_datetime_precision === 'EXACT' &&
    side !== null &&
    pips15 !== null
  ) {
    // その通貨が売られた方向: 通貨が前(BASE)なら通貨ペアが下がる、後(QUOTE)なら上がる。
    const currencyWeak = (pips: number) => (side === 'BASE' ? pips < 0 : pips > 0);
    const currencyStrong = (pips: number) => (side === 'BASE' ? pips > 0 : pips < 0);
    sellTheFact = currencyWeak(pips15);
    if (pips1 !== null) afterInitialRise = currencyStrong(pips1) && currencyWeak(pips15);
  }
  return {
    event_id: release.event_id,
    release_datetime: release.release_datetime,
    forecast: release.forecast,
    actual: release.actual,
    surprise: release.surprise,
    surprise_direction: release.surprise_direction,
    direction_1m: direction,
    pips_1m: pips1,
    pips_15m: pips15,
    pattern_15m: pattern,
    high_break_15m: b15.high,
    low_break_15m: b15.low,
    high_break_60m: b60.high,
    low_break_60m: b60.low,
    sell_the_fact: sellTheFact,
    sell_the_fact_after_initial_rise: afterInitialRise,
  };
}

function breakSummary(rows: StrategyReleaseRow[], key: '15m' | '60m'): BreakSummary | null {
  const judged = rows.filter((r) => r[`high_break_${key}`] !== null && r[`low_break_${key}`] !== null);
  if (judged.length < STRATEGY_MINIMUM_SAMPLES) return null;
  const high = judged.filter((r) => r[`high_break_${key}`] === true);
  const low = judged.filter((r) => r[`low_break_${key}`] === true);
  const both = judged.filter((r) => r[`high_break_${key}`] === true && r[`low_break_${key}`] === true);
  const neither = judged.filter((r) => r[`high_break_${key}`] === false && r[`low_break_${key}`] === false);
  return { high: high.length, low: low.length, both: both.length, neither: neither.length, samples: judged.length };
}

/** `releases` は新しい順(直近 STRATEGY_SAMPLE_WINDOW 回まで)。`symbol` は通貨ペア、`currency` は指標の通貨。 */
export function buildStrategyAnalysis(
  releases: readonly StrategyReleaseInput[],
  symbol: string,
  currency: string | null,
): StrategyAnalysis {
  const side = currencySide(symbol, currency);
  const rows = releases.slice(0, STRATEGY_SAMPLE_WINDOW).map((release) => analyzeRelease(release, side));

  const directions = rows.filter((r) => r.direction_1m !== null);
  const patterns = rows.filter((r) => r.pattern_15m !== null);
  const sellJudged = rows.filter((r) => r.sell_the_fact !== null);
  const riseJudged = rows.filter((r) => r.sell_the_fact_after_initial_rise !== null);
  const summary: StrategySummary = {
    direction_1m:
      directions.length >= STRATEGY_MINIMUM_SAMPLES
        ? {
            up: directions.filter((r) => r.direction_1m === 'UP').length,
            down: directions.filter((r) => r.direction_1m === 'DOWN').length,
            flat: directions.filter((r) => r.direction_1m === 'FLAT').length,
            samples: directions.length,
          }
        : null,
    breaks_15m: breakSummary(rows, '15m'),
    breaks_60m: breakSummary(rows, '60m'),
    pattern_15m:
      patterns.length >= STRATEGY_MINIMUM_SAMPLES
        ? {
            continuation: patterns.filter((r) => r.pattern_15m === 'CONTINUATION').length,
            reversal: patterns.filter((r) => r.pattern_15m === 'REVERSAL').length,
            samples: patterns.length,
          }
        : null,
    sell_the_fact:
      sellJudged.length >= STRATEGY_MINIMUM_SAMPLES
        ? { occurred: sellJudged.filter((r) => r.sell_the_fact === true).length, samples: sellJudged.length }
        : null,
    sell_the_fact_after_initial_rise:
      riseJudged.length >= STRATEGY_MINIMUM_SAMPLES
        ? {
            occurred: riseJudged.filter((r) => r.sell_the_fact_after_initial_rise === true).length,
            samples: riseJudged.length,
          }
        : null,
  };
  return {
    status: directions.length >= STRATEGY_MINIMUM_SAMPLES ? 'READY' : 'DATA_PREPARING',
    sample_window: STRATEGY_SAMPLE_WINDOW,
    minimum_samples: STRATEGY_MINIMUM_SAMPLES,
    releases: rows,
    summary,
  };
}
