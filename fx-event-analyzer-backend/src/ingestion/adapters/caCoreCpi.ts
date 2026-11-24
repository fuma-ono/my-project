/**
 * カナダのコアCPI(CA_CPI_TRIM・CA_CPI_MEDIAN)の、Statistics Canada WDS の応答の読み取り(設計書 ca-cpi-detailed-design.md
 * §4.2・§4.3・§16.1・§16.3、第1段階 §16.15.1)。
 *
 * - 系列: 表 18-10-0256-01(Bank of Canada definitions)の前年同月比(%)の系列。CA_CPI_TRIM = v108785715、
 *   CA_CPI_MEDIAN = v108785714。**公表値をそのまま読む**(自前の計算・丸めはしない)。取得は系列ごとに1回のリクエスト
 *   `getDataFromVectorsAndLatestNPeriods`、`latestN: 49`(§16.14.2。第1段階は参考情報の確認にも使う)。
 * - 応答の読み取り(`classifyCoreResponse`・`readPoint`)は経路 A(初回値)と経路 B(過去点の参考確認。
 *   pipelines/caCoreRevisionObservation.ts)で共通。公表日の照合 `evaluateFirstValue` は経路 A だけが使う。
 */
import { STATCAN_WDS_URL } from './gbCaOfficialValues.js';

export interface CaCoreSeries {
  indicatorCode: 'CA_CPI_TRIM' | 'CA_CPI_MEDIAN';
  vectorId: number;
}

export const CA_CORE_SERIES: readonly CaCoreSeries[] = [
  { indicatorCode: 'CA_CPI_TRIM', vectorId: 108785715 },
  { indicatorCode: 'CA_CPI_MEDIAN', vectorId: 108785714 },
];

export const CA_CORE_LATEST_N = 49;
export const CA_CORE_WDS_URL = STATCAN_WDS_URL;
/** 出典の表のページ(スナップショットの source_url・出典の source_url) */
export const CA_CORE_TABLE_URL = 'https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=1810025601';

export interface CorePoint {
  refPer?: unknown;
  value?: unknown;
  releaseTime?: unknown;
  statusCode?: unknown;
  symbolCode?: unknown;
}

/**
 * 応答の分類(系列ごと)。
 * - OK: 系列を識別でき、期待の vectorId と一致。points を返す
 * - SERIES_MISMATCH: vectorId が期待と違う(その系列だけ止める)
 * - FETCH_FAILED: status が SUCCESS でない(その系列だけ止める)
 * - RESPONSE_UNPARSABLE: 配列でない・空・要素がオブジェクトでない(CA 系の全系列を止める)
 * - SERIES_UNIDENTIFIABLE: SUCCESS なのに vectorId が無い・数でない(CA 系の全系列を止める)
 */
export type CoreResponse =
  | { kind: 'OK'; points: CorePoint[] }
  | { kind: 'SERIES_MISMATCH'; got: number }
  | { kind: 'FETCH_FAILED' }
  | { kind: 'RESPONSE_UNPARSABLE' }
  | { kind: 'SERIES_UNIDENTIFIABLE' };

export function classifyCoreResponse(series: CaCoreSeries, body: unknown): CoreResponse {
  if (!Array.isArray(body) || body.length === 0) return { kind: 'RESPONSE_UNPARSABLE' };
  const item = body[0] as { status?: unknown; object?: { vectorId?: unknown; vectorDataPoint?: unknown } } | null;
  if (item === null || typeof item !== 'object') return { kind: 'RESPONSE_UNPARSABLE' };
  if (item.status !== 'SUCCESS') return { kind: 'FETCH_FAILED' };
  const vectorId = item.object?.vectorId;
  if (typeof vectorId !== 'number' || !Number.isInteger(vectorId)) return { kind: 'SERIES_UNIDENTIFIABLE' };
  if (vectorId !== series.vectorId) return { kind: 'SERIES_MISMATCH', got: vectorId };
  const points = item.object?.vectorDataPoint;
  if (!Array.isArray(points)) return { kind: 'RESPONSE_UNPARSABLE' };
  return { kind: 'OK', points: points.filter((p): p is CorePoint => p !== null && typeof p === 'object') };
}

/** 'YYYY-MM-01' → 'YYYY-MM'。月初の形でなければ null。 */
export function periodOfRefPer(refPer: unknown): string | null {
  const match = typeof refPer === 'string' ? /^(\d{4})-(0[1-9]|1[0-2])-01$/.exec(refPer) : null;
  return match ? `${match[1]}-${match[2]}` : null;
}

/**
 * 点の値(小数第1位の%)。数として読める有限の値で、statusCode・symbolCode が 0、小数第1位までのものだけ。
 * WDS は値を数または数字の文字列で返しうるので、どちらも受け付ける(文字列は厳密な小数の形だけ)。
 */
export function readPointValue(point: CorePoint): number | null {
  if (point.statusCode !== 0 || point.symbolCode !== 0) return null;
  let value: number;
  if (typeof point.value === 'number') value = point.value;
  else if (typeof point.value === 'string' && /^-?\d+(\.\d+)?$/.test(point.value.trim())) value = Number(point.value);
  else return null;
  if (!Number.isFinite(value)) return null;
  if (Math.abs(value * 10 - Math.round(value * 10)) > 1e-9) return null; // 小数第1位まで(丸めない)
  return Math.round(value * 10) / 10;
}

export type FirstValueVerdict =
  | { ok: true; period: string; value: number; releasedOn: string }
  | { ok: false; reason: 'NOT_RELEASED_OR_DATE_MISMATCH' | 'PERIOD_MISMATCH' | 'INVALID_VALUE' };

/**
 * 経路 A: 初回値の判定(§4.3)。対象は**最新点1つだけ**(refPer が最も新しい点)。
 * 1. 最新点の releaseTime の日付 = 公表予定日(コアの過去点の releaseTime は直近の公表の日付になるため、この照合は最新点だけ)
 * 2. 最新点の対象月 = 公表予定の表の referencePeriod
 * 3. 数として読める有限の値・statusCode と symbolCode が 0
 * 受付期間(7日)・vectorId の同一性は、呼び出し側(classifyCoreResponse・firstValueWindow)で確かめる。
 */
export function evaluateFirstValue(
  points: readonly CorePoint[],
  releaseDate: string,
  referencePeriod: string,
): FirstValueVerdict {
  let latest: CorePoint | null = null;
  let latestPeriod: string | null = null;
  for (const point of points) {
    const period = periodOfRefPer(point.refPer);
    if (period !== null && (latestPeriod === null || period > latestPeriod)) {
      latest = point;
      latestPeriod = period;
    }
  }
  if (!latest || latestPeriod === null) return { ok: false, reason: 'NOT_RELEASED_OR_DATE_MISMATCH' };
  const releasedOn = typeof latest.releaseTime === 'string' ? latest.releaseTime.slice(0, 10) : null;
  if (releasedOn !== releaseDate) return { ok: false, reason: 'NOT_RELEASED_OR_DATE_MISMATCH' };
  if (latestPeriod !== referencePeriod) return { ok: false, reason: 'PERIOD_MISMATCH' };
  const value = readPointValue(latest);
  if (value === null) return { ok: false, reason: 'INVALID_VALUE' };
  return { ok: true, period: latestPeriod, value, releasedOn };
}
