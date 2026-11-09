/**
 * Eurostat's own release calendar for the euro-area indicators of 第1弾 (HQ承認 2026-10-30
 * 「ユーロ圏経済指標 第1弾」: 失業率・HICP速報値). CODE-REVIEWED CONFIG, like blsSchedule.ts: a
 * human adds dates by reading the official calendar, never by computing a pattern.
 *
 * Source (read 2026-10-30, no login, no key): Eurostat release calendar, "Euro indicators",
 * https://ec.europa.eu/eurostat/web/main/news/euro-indicators/release-calendar — the dates are
 * Europe/Luxembourg ("This calendar uses Europe/Luxembourg time zone (CET/CEST)"). The job reads
 * only this table at run time — it never calls the calendar's own (unpublished) JSON feed.
 * The time of day (11:00) is in mappings/indicators.ts and is APPROXIMATE (HQ判断 2026-10-30 2).
 *
 * Release ↔ reference period: "Flash estimate inflation euro area" reports the month just ended
 * (or the current month when published on its last day); "Unemployment" reports two months back
 * (e.g. 2026-10-30 → September). The pairs below are written out, never derived.
 */
import { EUROSTAT_SERIES } from './indicators.js';

export const EUROSTAT_SCHEDULE_INDICATORS = ['EU_HICP', 'EU_UNEMPLOYMENT_RATE'] as const;
export type EurostatScheduleIndicatorCode = (typeof EUROSTAT_SCHEDULE_INDICATORS)[number];

export interface EurostatScheduleEntry {
  /** economic_indicators.code */
  indicatorCode: EurostatScheduleIndicatorCode;
  /** 'YYYY-MM' the release reports on. */
  referencePeriod: string;
  /** 'YYYY-MM-DD', Europe/Luxembourg date of the release. */
  releaseDate: string;
}

/**
 * Whether Eurostat still shows the value as it was first published (HQ判断 2026-10-30 1):
 * - AS_PUBLISHED: the series keeps the published figure (HICP flash: prc_hicp_fpd release=FLS is
 *   not overwritten by the final release), so a past release can be built from it at any age.
 * - LATEST_ONLY: the series holds only the latest revision (une_rt_m). Its value counts as the
 *   published one only when read within FIRST_RELEASE_WINDOW_HOURS of the release; after that the
 *   release is never built (no row is created or published from a possibly revised number) and
 *   is reported as `firstReleaseMissed`. The table therefore starts at the latest release.
 */
export type EurostatValueVintage = 'AS_PUBLISHED' | 'LATEST_ONLY';

export interface EurostatIndicatorSchedule {
  valueVintage: EurostatValueVintage;
  /**
   * Official series for `previous` (the previous reference period). Omitted = the indicator's own
   * series. HICP flash: the previous month's FINAL HICP (published mid-month, before the flash).
   */
  previousSeriesId?: string;
}

/** Hours after the release in which a LATEST_ONLY value is taken as the published one. */
export const FIRST_RELEASE_WINDOW_HOURS = 72;

const hicpFlash: readonly [string, string][] = [
  ['2026-01', '2026-02-04'],
  ['2026-02', '2026-03-03'],
  ['2026-03', '2026-03-31'],
  ['2026-04', '2026-04-30'],
  ['2026-05', '2026-06-02'],
  ['2026-06', '2026-07-01'],
  ['2026-07', '2026-07-31'],
  ['2026-08', '2026-09-01'],
  ['2026-09', '2026-10-02'],
  ['2026-10', '2026-11-04'],
  ['2026-11', '2026-12-01'],
  ['2026-12', '2027-01-06'],
  ['2027-01', '2027-02-02'],
  ['2027-02', '2027-03-02'],
  ['2027-03', '2027-04-01'],
  ['2027-04', '2027-05-03'],
  ['2027-05', '2027-06-01'],
  ['2027-06', '2027-07-01'],
];

// 直近の発表(2026-10-30、9月分)から(HQ判断 2026-10-30 1)。それより前の月は、当時の値を確かめられない
// (une_rt_m は最新の値だけ、過去の版の ei_lm_m_vtg は 2026-09-22 の版で止まっている)ので入れない。
const unemployment: readonly [string, string][] = [
  ['2026-09', '2026-10-30'],
  ['2026-10', '2026-12-02'],
  ['2026-11', '2027-01-07'],
  ['2026-12', '2027-02-01'],
  ['2027-01', '2027-03-04'],
  ['2027-02', '2027-04-02'],
  ['2027-03', '2027-04-30'],
  ['2027-04', '2027-06-01'],
  ['2027-05', '2027-07-01'],
];

export const EUROSTAT_INDICATOR_SCHEDULES: Readonly<Record<EurostatScheduleIndicatorCode, EurostatIndicatorSchedule>> =
  {
    EU_HICP: {
      valueVintage: 'AS_PUBLISHED',
      previousSeriesId: EUROSTAT_SERIES.HICP_FINAL_YOY,
    },
    EU_UNEMPLOYMENT_RATE: { valueVintage: 'LATEST_ONLY' },
  };

export const EUROSTAT_SCHEDULE: readonly EurostatScheduleEntry[] = [
  ...hicpFlash.map(([referencePeriod, releaseDate]) => ({
    indicatorCode: 'EU_HICP' as const,
    referencePeriod,
    releaseDate,
  })),
  ...unemployment.map(([referencePeriod, releaseDate]) => ({
    indicatorCode: 'EU_UNEMPLOYMENT_RATE' as const,
    referencePeriod,
    releaseDate,
  })),
];
