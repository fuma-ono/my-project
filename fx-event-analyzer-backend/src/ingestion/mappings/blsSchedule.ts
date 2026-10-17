/**
 * BLS's own official release schedule for CPI and the Employment Situation
 * (Nonfarm Payrolls) — HQ判断(2026-10-17)「有料カレンダーに依存しない
 * 独立経路」。CODE-REVIEWED CONFIG, like mappings/indicators.ts: a human
 * adds future dates by reading the official pages below, not by guessing
 * a pattern (the actual release date moves around the 2nd Friday / varies
 * by a few days each month and is never computed from a rule).
 *
 * Both releases are always 08:30 America/New_York (US_RELEASE_0830 in
 * indicators.ts) — BLS has never missed this to the minute, so the
 * schedule here needs only the date, not a separate time.
 *
 * Source (fetched 2026-10-17, no login, no key):
 * - https://www.bls.gov/schedule/2026/home.htm (2026 full-year list, both series)
 * - https://www.bls.gov/schedule/news_release/cpi.htm (CPI, 2026-11 through 2027-11)
 * - https://www.bls.gov/schedule/news_release/empsit.htm (Employment Situation, 2026-11 through 2027-11)
 *
 * BLS content is public domain (no end-use controls; bls.gov/opub/copyright-information.htm) —
 * reusing this published schedule needs no permission. 対象はこの2指標のみ
 * (経済指標・単位ともDBにrowがあるのはUS_CPI・US_NFPだけ — data-sources.md §3.1)。
 * 取得範囲は下表の参照期間(2025-12〜2027-11)に限られる。日本・欧州・英国など
 * BLS以外が出す指標はこの経路では一切扱わない。
 */

export interface BlsScheduleEntry {
  /** economic_indicators.code — only 'US_CPI' and 'US_NFP' exist here. */
  indicatorCode: 'US_CPI' | 'US_NFP';
  /** 'YYYY-MM' the release reports on. */
  referencePeriod: string;
  /** 'YYYY-MM-DD', America/New_York wall-clock date of the 08:30 release. */
  releaseDate: string;
}

const cpi: readonly [string, string][] = [
  ['2025-12', '2026-01-13'],
  ['2026-01', '2026-02-13'],
  ['2026-02', '2026-03-11'],
  ['2026-03', '2026-04-10'],
  ['2026-04', '2026-05-12'],
  ['2026-05', '2026-06-10'],
  ['2026-06', '2026-07-14'],
  ['2026-07', '2026-08-12'],
  ['2026-08', '2026-09-11'],
  ['2026-09', '2026-10-14'],
  ['2026-10', '2026-11-10'],
  ['2026-11', '2026-12-10'],
  ['2026-12', '2027-01-13'],
  ['2027-01', '2027-02-11'],
  ['2027-02', '2027-03-10'],
  ['2027-03', '2027-04-13'],
  ['2027-04', '2027-05-12'],
  ['2027-05', '2027-06-10'],
  ['2027-06', '2027-07-14'],
  ['2027-07', '2027-08-11'],
  ['2027-08', '2027-09-14'],
  ['2027-09', '2027-10-14'],
  ['2027-10', '2027-11-10'],
  ['2027-11', '2027-12-10'],
];

const nfp: readonly [string, string][] = [
  ['2025-12', '2026-01-09'],
  ['2026-01', '2026-02-11'],
  ['2026-02', '2026-03-06'],
  ['2026-03', '2026-04-03'],
  ['2026-04', '2026-05-08'],
  ['2026-05', '2026-06-05'],
  ['2026-06', '2026-07-02'],
  ['2026-07', '2026-08-07'],
  ['2026-08', '2026-09-04'],
  ['2026-09', '2026-10-02'],
  ['2026-10', '2026-11-06'],
  ['2026-11', '2026-12-04'],
  ['2026-12', '2027-01-08'],
  ['2027-01', '2027-02-05'],
  ['2027-02', '2027-03-05'],
  ['2027-03', '2027-04-02'],
  ['2027-04', '2027-05-07'],
  ['2027-05', '2027-06-04'],
  ['2027-06', '2027-07-02'],
  ['2027-07', '2027-08-06'],
  ['2027-08', '2027-09-03'],
  ['2027-09', '2027-10-08'],
  ['2027-10', '2027-11-05'],
  ['2027-11', '2027-12-03'],
];

export const BLS_SCHEDULE: readonly BlsScheduleEntry[] = [
  ...cpi.map(([referencePeriod, releaseDate]) => ({ indicatorCode: 'US_CPI' as const, referencePeriod, releaseDate })),
  ...nfp.map(([referencePeriod, releaseDate]) => ({ indicatorCode: 'US_NFP' as const, referencePeriod, releaseDate })),
];
