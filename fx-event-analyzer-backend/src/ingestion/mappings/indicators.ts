/**
 * Indicator ↔ source mapping table (data-sources.md §3). CODE-REVIEWED
 * CONFIG: only indicators listed here are ingested, and every number the
 * Ingestion Worker accepts is interpreted through exactly one entry —
 * which provider row it is, what kind of value it is, in which unit, how
 * it is rounded, and which official series can verify it.
 *
 * Changing an entry changes what users see. Review rules:
 * - `code` must equal economic_indicators.code (rows not in the DB are skipped and logged).
 * - Provider keys are the provider's own identifiers; the paid ones are
 *   from public docs and MUST be re-checked against real responses after
 *   signing (`npm run eval:providers` reports unmapped rows) — 要確認.
 * - Official series ids / transforms were checked against FRED/BLS
 *   (data-sources.md §4 lists the evidence). FRED is NOT used as an official
 *   source: its API terms forbid storing FRED content (HQ判断 2026-10-16,
 *   data-sources.md §11, §13). Official values come from BLS only.
 */
import type { MappedUnit, SeasonalAdjustment, ValueKind } from '../types.js';

export type OfficialTransform = 'LEVEL' | 'YOY_PCT' | 'MOM_PCT' | 'DIFF';

export interface OfficialSeriesRef {
  source: 'FRED' | 'BLS';
  seriesId: string;
  /** How to turn the series' observations into the comparable value. */
  transform: OfficialTransform;
}

export interface IndicatorMapping {
  /** economic_indicators.code */
  code: string;
  description: string;
  valueKind: ValueKind;
  seasonalAdjustment: SeasonalAdjustment;
  unit: MappedUnit;
  /** Decimals the agency publishes the headline number with; used for rounding-aware comparison. */
  decimals: number;
  /** Sanity range for actual / forecast / previous (anything outside → PENDING_REVIEW). */
  expectedRange: { min: number; max: number };
  /** |actual − previous| above this → OUTLIER_VS_PREVIOUS (PENDING_REVIEW). Same unit as the value. */
  maxAbsChangeFromPrevious: number;
  /** Scheduled local release time; a provider time that differs → RELEASE_TIME_UNEXPECTED. */
  release: { timeZone: string; localTimes: readonly string[] };
  /** Official agency shown as event_snapshots.source / source_url. */
  agency: { name: string; url: string };
  /** Keys per paid calendar provider. */
  providers: {
    tradingeconomics?: { country: string; event: string };
    finnhub?: { country: string; event: string };
    fmp?: { country: string; event: string };
    /**
     * HQ判断(2026-10-17): 有料カレンダーに依存しない独立経路。BLSの公式発表
     * スケジュール(mappings/blsSchedule.ts、無料・登録不要)から直接
     * economic_events を作る指標だけが持つ(US_CPI・US_NFP。2026-10-26 から
     * US_CORE_CPI・US_UNEMPLOYMENT_RATE・US_AVG_HOURLY_EARNINGS も)。
     */
    bls_schedule?: { country: string; event: string };
  };
  /** Official series used to verify the actual, in priority order (first available wins). */
  official: readonly OfficialSeriesRef[];
  /** Absolute tolerance after rounding both sides to `decimals` (0 = must match exactly). */
  officialTolerance: number;
  /**
   * true: an actual is published only after it matches an official value
   * (until then it waits as AWAITING_OFFICIAL, not shown). false: when no
   * official value can be computed it is published as SINGLE_SOURCE.
   */
  requireOfficialMatch: boolean;
  /** Accept provider values with no unit/suffix as already being in `unit`. */
  allowMissingUnit: boolean;
  /**
   * Months between the reference period and the release month (US CPI /
   * NFP / retail sales: data for month M−1 is released in month M). Used
   * only when a provider gives no reference period; an inferred period is
   * never trusted on its own — the value must still match the official
   * series for that period (a wrong guess shows up as OFFICIAL_MISMATCH).
   */
  referencePeriodLagMonths: number;
  /**
   * HQ指示(2026-10-25)「過去イベント比較の表も前月と前年必要だと思う」:
   * この指標の本来の値(valueKind、例: 米国CPIはYOY_PCT)に加えて、同じ
   * 公式系列を別の変換で見せたい場合だけ設定する(米国CPIはMOM_PCTを追加
   * = 前月比)。新しい外部データ源は増やさず、既にingestion/verification
   * で取得しているBLS系列を別の変換で計算するだけ。
   * 現時点ではbls_schedule経路(blsCalendar.ts)だけが対応しており、
   * 有料カレンダー経路(economicCalendar.ts)はこのフィールドを読まない
   * (プロバイダがMoM%を別イベントとして報告することが多く、そちらは
   * 別指標として追加する方が自然なため — data-sources.md参照)。
   */
  secondary?: { valueKind: ValueKind; official: OfficialSeriesRef };
}

const BLS = { name: 'U.S. Bureau of Labor Statistics', url: 'https://www.bls.gov/' };
const CENSUS = { name: 'U.S. Census Bureau', url: 'https://www.census.gov/retail/' };
const US_RELEASE_0830 = { timeZone: 'America/New_York', localTimes: ['08:30'] } as const;

export const INDICATOR_MAPPINGS: readonly IndicatorMapping[] = [
  {
    // Headline CPI YoY is published by BLS on the NOT seasonally adjusted
    // index (CPI-U, all items, U.S. city average) — SA would give a
    // different number.
    code: 'US_CPI',
    description: 'US CPI (CPI-U all items) YoY, NSA',
    valueKind: 'YOY_PCT',
    seasonalAdjustment: 'NSA',
    unit: 'PERCENT',
    decimals: 1,
    expectedRange: { min: -5, max: 15 },
    maxAbsChangeFromPrevious: 1.5,
    release: US_RELEASE_0830,
    agency: { ...BLS, url: 'https://www.bls.gov/cpi/' },
    providers: {
      tradingeconomics: { country: 'United States', event: 'Inflation Rate YoY' },
      finnhub: { country: 'US', event: 'CPI YoY' },
      fmp: { country: 'US', event: 'CPI YoY' },
      bls_schedule: { country: 'US', event: 'US_CPI' },
    },
    official: [{ source: 'BLS', seriesId: 'CUUR0000SA0', transform: 'YOY_PCT' }],
    officialTolerance: 0,
    requireOfficialMatch: true,
    allowMissingUnit: false,
    referencePeriodLagMonths: 1,
    // HQ指示(2026-10-25): 過去イベント比較・イベント詳細に前月比(MoM%)も
    // 併記する。同じ系列(CUUR0000SA0)をMOM_PCTで計算するだけで、新しい
    // 外部データ源は不要。
    secondary: { valueKind: 'MOM_PCT', official: { source: 'BLS', seriesId: 'CUUR0000SA0', transform: 'MOM_PCT' } },
  },
  {
    // Core CPI (all items less food and energy) YoY, NSA — like US_CPI, the
    // headline YoY is on the NOT seasonally adjusted index. Same release
    // (CPI news release) as US_CPI. economic_indicators row: migration
    // 20261026000001 (HQ指示 2026-10-26「米国コアCPI・失業率・平均時給の追加」).
    code: 'US_CORE_CPI',
    description: 'US Core CPI (less food and energy) YoY, NSA',
    valueKind: 'YOY_PCT',
    seasonalAdjustment: 'NSA',
    unit: 'PERCENT',
    decimals: 1,
    expectedRange: { min: -3, max: 12 },
    maxAbsChangeFromPrevious: 1.0,
    release: US_RELEASE_0830,
    agency: { ...BLS, url: 'https://www.bls.gov/cpi/' },
    providers: {
      tradingeconomics: { country: 'United States', event: 'Core Inflation Rate YoY' },
      finnhub: { country: 'US', event: 'Core CPI YoY' },
      fmp: { country: 'US', event: 'Core CPI YoY' },
      bls_schedule: { country: 'US', event: 'US_CORE_CPI' },
    },
    official: [{ source: 'BLS', seriesId: 'CUUR0000SA0L1E', transform: 'YOY_PCT' }],
    officialTolerance: 0,
    requireOfficialMatch: true,
    allowMissingUnit: false,
    referencePeriodLagMonths: 1,
    // 前月比は BLS の発表どおり季節調整済みの系列(CUSR0000SA0L1E)で計算する。
    // 前年比(季節調整なし CUUR0000SA0L1E)とは別の系列なので、BLS の取得が1系列増える。
    secondary: { valueKind: 'MOM_PCT', official: { source: 'BLS', seriesId: 'CUSR0000SA0L1E', transform: 'MOM_PCT' } },
  },
  {
    // Nonfarm payrolls: monthly CHANGE of the seasonally adjusted level
    // (thousands). The official change is level(t) − level(t−1) where
    // level(t−1) is the value as revised in the same release, which is why
    // the comparison uses point-in-time data as of the release date.
    code: 'US_NFP',
    description: 'US Nonfarm Payrolls, monthly change, SA, thousands',
    valueKind: 'CHANGE',
    seasonalAdjustment: 'SA',
    unit: 'THOUSANDS',
    decimals: 0,
    expectedRange: { min: -1500, max: 1500 },
    maxAbsChangeFromPrevious: 600,
    release: US_RELEASE_0830,
    agency: { ...BLS, url: 'https://www.bls.gov/ces/' },
    providers: {
      tradingeconomics: { country: 'United States', event: 'Non Farm Payrolls' },
      finnhub: { country: 'US', event: 'Nonfarm Payrolls' },
      fmp: { country: 'US', event: 'Nonfarm Payrolls' },
      bls_schedule: { country: 'US', event: 'US_NFP' },
    },
    official: [{ source: 'BLS', seriesId: 'CES0000000001', transform: 'DIFF' }],
    officialTolerance: 0,
    requireOfficialMatch: true,
    allowMissingUnit: false,
    referencePeriodLagMonths: 1,
  },
  {
    // Unemployment rate (U-3), SA, the level itself (no MoM/YoY transform).
    // Same release (Employment Situation) as US_NFP. economic_indicators
    // row: migration 20261026000001.
    code: 'US_UNEMPLOYMENT_RATE',
    description: 'US Unemployment Rate (U-3), SA',
    valueKind: 'LEVEL',
    seasonalAdjustment: 'SA',
    unit: 'PERCENT',
    decimals: 1,
    expectedRange: { min: 2, max: 20 },
    maxAbsChangeFromPrevious: 1.0,
    release: US_RELEASE_0830,
    agency: { ...BLS, url: 'https://www.bls.gov/cps/' },
    providers: {
      tradingeconomics: { country: 'United States', event: 'Unemployment Rate' },
      finnhub: { country: 'US', event: 'Unemployment Rate' },
      fmp: { country: 'US', event: 'Unemployment Rate' },
      bls_schedule: { country: 'US', event: 'US_UNEMPLOYMENT_RATE' },
    },
    official: [{ source: 'BLS', seriesId: 'LNS14000000', transform: 'LEVEL' }],
    officialTolerance: 0,
    requireOfficialMatch: true,
    allowMissingUnit: false,
    referencePeriodLagMonths: 1,
  },
  {
    // Average hourly earnings of all employees, total private (CES, SA, dollars).
    // The headline is the MoM % change of the SA level; BLS also states the
    // YoY % change of the same SA series (secondary). Same release
    // (Employment Situation) as US_NFP. Only the bls_schedule path —
    // the paid-calendar keys are not mapped (要確認 after signing, like the others).
    // BLS publishes the level rounded to cents and the % is recomputed here
    // from those published levels. Whether BLS's own headline % uses the
    // rounded or unrounded level is not confirmed (要確認, data-sources.md §16):
    // if unrounded, a month can differ from the news release by 0.1.
    code: 'US_AVG_HOURLY_EARNINGS',
    description: 'US Average Hourly Earnings (all employees, total private) MoM, SA',
    valueKind: 'MOM_PCT',
    seasonalAdjustment: 'SA',
    unit: 'PERCENT',
    decimals: 1,
    expectedRange: { min: -3, max: 5 },
    maxAbsChangeFromPrevious: 2,
    release: US_RELEASE_0830,
    agency: { ...BLS, url: 'https://www.bls.gov/ces/' },
    providers: {
      bls_schedule: { country: 'US', event: 'US_AVG_HOURLY_EARNINGS' },
    },
    official: [{ source: 'BLS', seriesId: 'CES0500000003', transform: 'MOM_PCT' }],
    officialTolerance: 0,
    requireOfficialMatch: true,
    allowMissingUnit: false,
    referencePeriodLagMonths: 1,
    secondary: { valueKind: 'YOY_PCT', official: { source: 'BLS', seriesId: 'CES0500000003', transform: 'YOY_PCT' } },
  },
  {
    // Producer Price Index for final demand. The headline is the MoM % change of the
    // seasonally adjusted index (WPSFD4); BLS states the 12-month change on the NOT
    // seasonally adjusted index (WPUFD4) — so the secondary uses that series.
    // HQ指示(2026-10-27「米国PPI・コアPPI」)。予定は bls.gov/schedule(2026・2027 の年間予定)。
    code: 'US_PPI',
    description: 'US PPI final demand MoM, SA',
    valueKind: 'MOM_PCT',
    seasonalAdjustment: 'SA',
    unit: 'PERCENT',
    decimals: 1,
    expectedRange: { min: -5, max: 5 },
    maxAbsChangeFromPrevious: 3,
    release: US_RELEASE_0830,
    agency: { ...BLS, url: 'https://www.bls.gov/ppi/' },
    providers: { bls_schedule: { country: 'US', event: 'US_PPI' } },
    official: [{ source: 'BLS', seriesId: 'WPSFD4', transform: 'MOM_PCT' }],
    officialTolerance: 0,
    requireOfficialMatch: true,
    allowMissingUnit: false,
    referencePeriodLagMonths: 1,
    secondary: { valueKind: 'YOY_PCT', official: { source: 'BLS', seriesId: 'WPUFD4', transform: 'YOY_PCT' } },
  },
  {
    // PPI final demand less foods and energy (the usual "core PPI"). WPSFD4131 is
    // FINISHED GOODS less foods and energy — not this. Same SA / NSA split as US_PPI.
    code: 'US_CORE_PPI',
    description: 'US PPI final demand less foods and energy MoM, SA',
    valueKind: 'MOM_PCT',
    seasonalAdjustment: 'SA',
    unit: 'PERCENT',
    decimals: 1,
    expectedRange: { min: -4, max: 4 },
    maxAbsChangeFromPrevious: 2,
    release: US_RELEASE_0830,
    agency: { ...BLS, url: 'https://www.bls.gov/ppi/' },
    providers: { bls_schedule: { country: 'US', event: 'US_CORE_PPI' } },
    official: [{ source: 'BLS', seriesId: 'WPSFD49104', transform: 'MOM_PCT' }],
    officialTolerance: 0,
    requireOfficialMatch: true,
    allowMissingUnit: false,
    referencePeriodLagMonths: 1,
    secondary: { valueKind: 'YOY_PCT', official: { source: 'BLS', seriesId: 'WPUFD49104', transform: 'YOY_PCT' } },
  },
  {
    // JOLTS job openings, total nonfarm, SA, level in thousands. Released 10:00 New York,
    // two months after the reference month (Sept data on 11/03) — the referencePeriod and
    // date come from the table, so the lag only matters for paid calendars (not mapped).
    code: 'US_JOLTS',
    description: 'US JOLTS job openings, total nonfarm, SA, thousands',
    valueKind: 'LEVEL',
    seasonalAdjustment: 'SA',
    unit: 'THOUSANDS',
    decimals: 0,
    expectedRange: { min: 2000, max: 20000 },
    maxAbsChangeFromPrevious: 2500,
    release: { timeZone: 'America/New_York', localTimes: ['10:00'] },
    agency: { ...BLS, url: 'https://www.bls.gov/jlt/' },
    providers: { bls_schedule: { country: 'US', event: 'US_JOLTS' } },
    official: [{ source: 'BLS', seriesId: 'JTS000000000000000JOL', transform: 'LEVEL' }],
    officialTolerance: 0,
    requireOfficialMatch: true,
    allowMissingUnit: false,
    referencePeriodLagMonths: 2,
  },
  {
    // Advance retail and food services sales MoM, SA (Census, not BLS —
    // no BLS series). No US_RETAIL_SALES row yet — skipped until added.
    // Census computes the % change from unrounded millions; FRED RSAFS is
    // in millions too, so recomputing gives the published rounding.
    code: 'US_RETAIL_SALES',
    description: 'US Advance Retail Sales (retail and food services) MoM, SA',
    valueKind: 'MOM_PCT',
    seasonalAdjustment: 'SA',
    unit: 'PERCENT',
    decimals: 1,
    expectedRange: { min: -20, max: 20 },
    maxAbsChangeFromPrevious: 5,
    release: US_RELEASE_0830,
    agency: CENSUS,
    providers: {
      tradingeconomics: { country: 'United States', event: 'Retail Sales MoM' },
      finnhub: { country: 'US', event: 'Retail Sales MoM' },
      fmp: { country: 'US', event: 'Retail Sales MoM' },
    },
    // 公式値は Census(米国勢調査局)が出す。FRED(RSAFS)は保存が規約で認められないため外した
    // (HQ判断 2026-10-16、data-sources.md 13章)。Census の API の利用条件を確認して足すまで照合元が無いので、
    // requireOfficialMatch: true のこの指標は公開されない(公式待ちのまま)。
    official: [],
    officialTolerance: 0,
    requireOfficialMatch: true,
    allowMissingUnit: false,
    referencePeriodLagMonths: 1,
  },
];

/** FRED release ids used for release-date cross-checks (data-sources.md §4). */
export const FRED_RELEASE_IDS: Readonly<Record<string, number>> = {
  US_CPI: 10,
  US_CORE_CPI: 10,
  US_NFP: 50,
  US_UNEMPLOYMENT_RATE: 50,
  US_AVG_HOURLY_EARNINGS: 50,
  US_PPI: 46,
  US_CORE_PPI: 46,
  US_JOLTS: 192,
  US_RETAIL_SALES: 9,
};

export type CalendarProviderId = keyof IndicatorMapping['providers'];

function key(country: string, event: string): string {
  return `${country.trim().toLowerCase()}|${event.trim().toLowerCase()}`;
}

/** "country|event" key as adapters build it (NormalizedCalendarRelease.providerIndicatorKey). */
export function providerIndicatorKey(country: string, event: string): string {
  return key(country, event);
}

/** Index from a provider's indicator key to its mapping. Throws on duplicate keys (a config bug). */
export function buildMappingIndex(
  provider: CalendarProviderId,
  mappings: readonly IndicatorMapping[] = INDICATOR_MAPPINGS,
): Map<string, IndicatorMapping> {
  const index = new Map<string, IndicatorMapping>();
  for (const mapping of mappings) {
    const ref = mapping.providers[provider];
    if (!ref) continue;
    const k = key(ref.country, ref.event);
    if (index.has(k)) throw new Error(`Duplicate ${provider} mapping key "${k}"`);
    index.set(k, mapping);
  }
  return index;
}

export function findMappingByCode(
  code: string,
  mappings: readonly IndicatorMapping[] = INDICATOR_MAPPINGS,
): IndicatorMapping | undefined {
  return mappings.find((mapping) => mapping.code === code);
}
