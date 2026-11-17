import { FX_FETCH_SETTINGS } from '../ingestion/config.js';
import { floorMinute, isFxMarketOpen, MINUTE_MS } from '../ingestion/marketHours.js';

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
// であること。前後とも180分まで(合計360分)とし、表示範囲は半開区間 [from, to) なので、1分足でも返す足は最大 360 本
// (360分 ÷ 1分)で、5分足以上はそれより少ない。PostgREST の1回の取得の上限(既定1000行)に届かないので、本数の上限や
// 切り詰めの処理は置かない(HQ指示 2026-11-17「Cレビュー反映」: 上限が実際に届かないなら簡素化する)。
export const CHART_MAX_BEFORE_MINUTES = 180;
export const CHART_MAX_AFTER_MINUTES = 180;

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
 * 「もう確定していてよい」時刻の境目(ミリ秒)。取り込みは、now − finalityLagMinutes より新しい分は、まだ取り込みの途中の
 * 可能性があるため、欠けているとは扱わない(ingestion/pipelines/fxGapRepair.ts)。ここもそれに揃える。
 * 5〜60分足は、中の N 分がすべて確定してから組み立てられる(aggregateMinuteRows)ので、足の終わりがこの境目以前のものだけが対象。
 */
export function chartFinalityBoundaryMs(nowMs: number): number {
  return floorMinute(nowMs - FX_FETCH_SETTINGS.finalityLagMinutes * MINUTE_MS);
}

/**
 * 表示範囲 [from, to) のうち、境目(finality)までに到来した、市場が開いている間にあるはずの足の開始時刻(ISO)。
 * 1分足 = 開いている分。5〜60分足 = エポックの N 分の倍数の区切りで、中の N 分がすべて市場の開いている分で、かつ足の終わりが
 * 境目以前のもの(未来の足・まだ確定していない足は含めない)。市場の休み(週末・12/25・1/1)の足は含めない。
 */
export function expectedChartTimestamps(fromIso: string, toIso: string, timeframe: string, nowMs: number): string[] {
  const minutes = MINUTES_OF_TIMEFRAME[timeframe];
  if (minutes === undefined) return [];
  const bucketMs = minutes * MINUTE_MS;
  const fromMs = new Date(fromIso).getTime();
  const toMs = new Date(toIso).getTime();
  const boundary = chartFinalityBoundaryMs(nowMs);
  const result: string[] = [];
  for (let start = Math.ceil(fromMs / bucketMs) * bucketMs; start < toMs; start += bucketMs) {
    if (start + bucketMs > boundary) break;
    let open = true;
    for (let ms = start; ms < start + bucketMs; ms += MINUTE_MS) {
      if (!isFxMarketOpen(ms)) {
        open = false;
        break;
      }
    }
    if (open) result.push(new Date(start).toISOString());
  }
  return result;
}

/**
 * 窓の終わりの時刻(ミリ秒)。窓 [from, to) に入る最後の足(エポックの N 分の倍数の区切り)の終わり。`to` が足幅の倍数でないとき、
 * 最後の足は `to` を超えて終わる(例: to = 13:12 の5分足なら、最後の足は 13:10〜13:15 で、終わりは 13:15)。その足が確定するまで、
 * 窓は完了していない。窓に足の区切りが1つも入らないときは `to` を使う。
 */
export function chartWindowEndMs(fromIso: string, toIso: string, timeframe: string): number {
  const fromMs = new Date(fromIso).getTime();
  const toMs = new Date(toIso).getTime();
  const minutes = MINUTES_OF_TIMEFRAME[timeframe];
  if (minutes === undefined) return toMs;
  const bucketMs = minutes * MINUTE_MS;
  const firstStart = Math.ceil(fromMs / bucketMs) * bucketMs;
  if (firstStart >= toMs) return toMs;
  const lastStart = Math.ceil(toMs / bucketMs) * bucketMs - bucketMs;
  return lastStart + bucketMs;
}

/**
 * データの状態(既存の ApiDataStatus と同じ語彙。新しい PARTIAL は作らない。HQ判断 2026-11-17 で確定):
 * - DATA_PENDING: 窓が未完了(未来の時間帯が残っている・まだ確定していない足がある)。足が揃っているかは問わない。
 * - READY: 窓が完了していて、チャートに使える足が返っている。**完全性は保証しない**(別項目 has_gaps で表す)。
 *   期待する足が0本の窓(市場の休み)も READY(expected_candles = 0、has_gaps = false)。
 * - DATA_UNAVAILABLE: 窓が完了していて、期待する足があるのに、1本も返っていない。
 */
export type ChartDataStatus = 'READY' | 'DATA_PENDING' | 'DATA_UNAVAILABLE';

export interface ChartCandleCoverage {
  /** 到来した(確定している)対象の足の数。未来の時間帯は含めない。 */
  expected_candles: number;
  /** 返した足の数(= prices の本数。期待に入らない足、例えば休場時間の足も数える)。 */
  returned_candles: number;
  /** 期待する足のうち、返した足に無い数(期待のタイムスタンプの集合と返した集合の差。休場時間などの余分な足は差し引かない)。 */
  missing_candles: number;
  /** 期待する足が一部欠けている(missing_candles > 0)。READY のときも、欠けた足があれば true。 */
  has_gaps: boolean;
  /** 窓の終わり(最後の足の終わり)までがすべて確定している(未来の時間帯が残っていない)か。 */
  window_complete: boolean;
  data_status: ChartDataStatus;
}

/**
 * 期待するタイムスタンプの集合と、返した足のタイムスタンプの集合を比べて、欠損の状態を決める。
 * `timestamps` は、取得した足の開始時刻(窓は半開区間 [from, to) で取得している前提)。`nowMs` は現在時刻(ミリ秒)。
 */
export function chartCandleCoverage(
  fromIso: string,
  toIso: string,
  timeframe: string,
  timestamps: readonly string[],
  nowMs: number,
): ChartCandleCoverage {
  const expected = expectedChartTimestamps(fromIso, toIso, timeframe, nowMs);
  const returnedSet = new Set(timestamps.map((t) => new Date(t).getTime()));
  const missing = expected.filter((t) => !returnedSet.has(new Date(t).getTime())).length;
  const matched = expected.length - missing;
  const windowComplete = chartWindowEndMs(fromIso, toIso, timeframe) <= chartFinalityBoundaryMs(nowMs);
  const status: ChartDataStatus = !windowComplete
    ? 'DATA_PENDING'
    : expected.length > 0 && matched === 0
      ? 'DATA_UNAVAILABLE'
      : 'READY';
  return {
    expected_candles: expected.length,
    returned_candles: timestamps.length,
    missing_candles: missing,
    has_gaps: missing > 0,
    window_complete: windowComplete,
    data_status: status,
  };
}
