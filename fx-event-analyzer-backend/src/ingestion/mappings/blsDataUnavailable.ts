/**
 * BLS が前年比の計算に必要な月の指数を公表していないため、実績値を作れない発表回(HQ指示 2026-11-11「CPI 2026-11-10
 * DATA_UNAVAILABLE 対応(案A)」)。CODE-REVIEWED CONFIG: 人が BLS の公式データで確かめた回だけを載せる。
 * **一般化しない**: ほかの回・ほかの指標はこの表に載らない限り、今までどおりの取り込み(ingest:official:bls-calendar)。
 *
 * 2026-11-11 に BLS Public Data API v1(https://api.bls.gov/publicAPI/v1/timeseries/data/)で確認:
 *   CUUR0000SA0(US_CPI)・CUUR0000SA0L1E(US_CORE_CPI)の 2025 年 10 月(M10)は value "-"、footnote code "X"
 *   「Data unavailable due to the 2025 lapse in appropriations」。2026 年 10 月(M10)は公表済み(latest)。
 *   前年比 = 2026-10 の指数 ÷ 2025-10 の指数 − 1 は計算できない。前月比(季節調整、CUSR…)は計算できるが、前年比の
 *   代わりにしない(指標の定義が違う)。
 */

export interface BlsDataUnavailableEntry {
  indicatorCode: 'US_CPI' | 'US_CORE_CPI';
  /** 'YYYY-MM' その回の対象月 */
  referencePeriod: string;
  /** 'YYYY-MM-DD' 発表日(blsSchedule.ts の表と同じ) */
  releaseDate: string;
  /** 発表時刻(UTC)。DB のイベントの release_datetime と一致しなければ何もしない */
  releaseDatetimeUtc: string;
  /** 前年比の計算に必要で、BLS が公表していない月('YYYY-MM') */
  missingPeriod: string;
  /** 前年比の元の系列(BLS の series ID) */
  seriesId: string;
  /** アプリに出す理由(event_explanations.summary) */
  reason: string;
  source: string;
  sourceUrl: string;
  /** 'YYYY-MM-DD' 人が BLS の公式データで確かめた日 */
  checkedAt: string;
}

export const BLS_DATA_UNAVAILABLE_REASON =
  'BLSが2025年10月の指数を公表していないため、2026年10月分の前年比を計算できません。';

export const BLS_DATA_UNAVAILABLE: readonly BlsDataUnavailableEntry[] = [
  {
    indicatorCode: 'US_CPI',
    referencePeriod: '2026-10',
    releaseDate: '2026-11-10',
    releaseDatetimeUtc: '2026-11-10T13:30:00.000Z',
    missingPeriod: '2025-10',
    seriesId: 'CUUR0000SA0',
    reason: BLS_DATA_UNAVAILABLE_REASON,
    source: 'U.S. Bureau of Labor Statistics',
    sourceUrl: 'https://data.bls.gov/timeseries/CUUR0000SA0',
    checkedAt: '2026-11-11',
  },
  {
    indicatorCode: 'US_CORE_CPI',
    referencePeriod: '2026-10',
    releaseDate: '2026-11-10',
    releaseDatetimeUtc: '2026-11-10T13:30:00.000Z',
    missingPeriod: '2025-10',
    seriesId: 'CUUR0000SA0L1E',
    reason: BLS_DATA_UNAVAILABLE_REASON,
    source: 'U.S. Bureau of Labor Statistics',
    sourceUrl: 'https://data.bls.gov/timeseries/CUUR0000SA0L1E',
    checkedAt: '2026-11-11',
  },
];

export const blsDataUnavailableKey = (e: { indicatorCode: string; referencePeriod: string }) =>
  `${e.indicatorCode}:${e.referencePeriod}`;

/** この表に載っている回か(ingest:official:bls-calendar が「期限超過」に入れないために使う)。 */
export function isBlsDataUnavailable(
  entry: { indicatorCode: string; referencePeriod: string },
  table: readonly BlsDataUnavailableEntry[] = BLS_DATA_UNAVAILABLE,
): boolean {
  return table.some((e) => blsDataUnavailableKey(e) === blsDataUnavailableKey(entry));
}
