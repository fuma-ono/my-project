import { isFxMarketOpen, MINUTE_MS } from '../ingestion/marketHours.js';

// SCR-008 相場反応詳細のチャートの表示範囲(HQ指示 2026-10-09)。発表時刻を基準に、
// 時間足ごとに範囲を変える。1分足は初動(前後15分)、5分足は短期の流れ(前後60分)、
// 15分足は全体の流れ(前後3時間)。それ以外の時間足は従来どおり前30分〜後60分。
const WINDOW_MINUTES: Record<string, { before: number; after: number }> = {
  '1m': { before: 15, after: 15 },
  '5m': { before: 60, after: 60 },
  '15m': { before: 180, after: 180 },
};

const DEFAULT_WINDOW = { before: 30, after: 60 };

export function chartWindow(releaseDatetime: string, timeframe: string): { from: string; to: string } {
  const release = new Date(releaseDatetime).getTime();
  const { before, after } = WINDOW_MINUTES[timeframe] ?? DEFAULT_WINDOW;
  return {
    from: new Date(release - before * 60_000).toISOString(),
    to: new Date(release + after * 60_000).toISOString(),
  };
}

// ---- 第1段階の拡張(HQ指示 2026-11-17「Strategy Analysis バックエンド実装 第1段階」): before_minutes / after_minutes ----
// 発表の前から発表の後2時間まで(1分足を含む)表示できるよう、表示範囲を Query で指定できるようにする。
// 指定が無いときは、上の時間足ごとの既定の範囲のまま(既存の動作を変えない)。
//
// 上限(最大取得範囲)の根拠: 既存の最大の表示範囲が 15分足の前後3時間(180分)であること、要件が「発表前から発表後2時間」
// であること。前後とも180分まで(合計360分)とし、1分足でも返す足は最大 360 本になる。返す本数の安全弁として
// CHART_MAX_CANDLES を別に置く(DB の取得に limit を付ける)。
export const CHART_MAX_BEFORE_MINUTES = 180;
export const CHART_MAX_AFTER_MINUTES = 180;
export const CHART_MAX_CANDLES = 1000;

export type ChartWindowSource = 'DEFAULT' | 'REQUESTED';

export interface ResolvedChartWindow {
  from: string;
  to: string;
  before_minutes: number;
  after_minutes: number;
  source: ChartWindowSource;
}

/** 時間足ごとの既定の範囲(分)。 */
export function defaultChartMinutes(timeframe: string): { before: number; after: number } {
  return WINDOW_MINUTES[timeframe] ?? DEFAULT_WINDOW;
}

/**
 * Query の before_minutes / after_minutes(文字列)を整数にする。無い(undefined)なら undefined。
 * 0 以上 max 以下の整数でなければ null(呼び出し側が検証エラーにする)。小数・負数・空文字・数字以外は null。
 */
export function parseChartMinutes(raw: unknown, max: number): number | undefined | null {
  if (raw === undefined) return undefined;
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value <= max ? value : null;
}

export function resolveChartWindow(
  releaseDatetime: string,
  timeframe: string,
  requested: { beforeMinutes?: number | undefined; afterMinutes?: number | undefined } = {},
): ResolvedChartWindow {
  const defaults = defaultChartMinutes(timeframe);
  const before = requested.beforeMinutes ?? defaults.before;
  const after = requested.afterMinutes ?? defaults.after;
  const release = new Date(releaseDatetime).getTime();
  return {
    from: new Date(release - before * 60_000).toISOString(),
    to: new Date(release + after * 60_000).toISOString(),
    before_minutes: before,
    after_minutes: after,
    source: requested.beforeMinutes === undefined && requested.afterMinutes === undefined ? 'DEFAULT' : 'REQUESTED',
  };
}

const MINUTES_OF_TIMEFRAME: Record<string, number> = { '1m': 1, '5m': 5, '15m': 15, '30m': 30, '60m': 60 };

/**
 * 表示範囲 [from, to) に、市場が開いている間に存在するはずの足の数(期待本数)。
 * 1分足 = 市場が開いている分の数。5〜60分足 = 取り込みが1分足から組み立てる足(エポックの N 分の倍数の区切り。中の N 分がすべて
 * 市場の開いている分のときだけできる、ingestion/pipelines/fxPrices.ts の aggregateMinuteRows)のうち、開始が範囲に入るもの。
 * 市場の休み(週末・12/25・1/1)の足は数えない。
 */
export function expectedChartCandles(fromIso: string, toIso: string, timeframe: string): number {
  const minutes = MINUTES_OF_TIMEFRAME[timeframe];
  if (minutes === undefined) return 0;
  const bucketMs = minutes * MINUTE_MS;
  const fromMs = new Date(fromIso).getTime();
  const toMs = new Date(toIso).getTime();
  let count = 0;
  for (let start = Math.ceil(fromMs / bucketMs) * bucketMs; start < toMs; start += bucketMs) {
    let open = true;
    for (let ms = start; ms < start + bucketMs; ms += MINUTE_MS) {
      if (!isFxMarketOpen(ms)) {
        open = false;
        break;
      }
    }
    if (open) count += 1;
  }
  return count;
}

export type ChartDataStatus = 'READY' | 'PARTIAL' | 'DATA_UNAVAILABLE';

export interface ChartCandleCoverage {
  expected_candles: number;
  /** 表示範囲 [from, to) の中にある足の数(返した足のうち、範囲に入るもの)。 */
  returned_candles: number;
  missing_candles: number;
  data_status: ChartDataStatus;
}

/**
 * 期待本数と実際の本数から、欠損の状態を決める。READY = 期待どおり全部ある(期待が0本で返却も0本の、市場が休みの窓も
 * 欠損なしの READY)。PARTIAL = 一部だけある。DATA_UNAVAILABLE = 期待があるのに1本も無い。足は補わない。
 */
export function chartCandleCoverage(
  fromIso: string,
  toIso: string,
  timeframe: string,
  timestamps: readonly string[],
): ChartCandleCoverage {
  const fromMs = new Date(fromIso).getTime();
  const toMs = new Date(toIso).getTime();
  const expected = expectedChartCandles(fromIso, toIso, timeframe);
  const inWindow = timestamps.filter((t) => {
    const ms = new Date(t).getTime();
    return ms >= fromMs && ms < toMs;
  }).length;
  const missing = Math.max(expected - inWindow, 0);
  const status: ChartDataStatus =
    expected === 0 || missing === 0 ? 'READY' : inWindow === 0 ? 'DATA_UNAVAILABLE' : 'PARTIAL';
  return { expected_candles: expected, returned_candles: inWindow, missing_candles: missing, data_status: status };
}
