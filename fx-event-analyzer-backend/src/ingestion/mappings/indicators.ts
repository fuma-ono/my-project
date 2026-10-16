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
    },
    official: [{ source: 'BLS', seriesId: 'CUUR0000SA0', transform: 'YOY_PCT' }],
    officialTolerance: 0,
    requireOfficialMatch: true,
    allowMissingUnit: false,
    referencePeriodLagMonths: 1,
  },
  {
    // Core CPI (all items less food and energy) YoY, NSA. economic_indicators
    // has no US_CORE_CPI row yet — skipped (and logged) until HQ adds one.
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
    },
    official: [{ source: 'BLS', seriesId: 'CUUR0000SA0L1E', transform: 'YOY_PCT' }],
    officialTolerance: 0,
    requireOfficialMatch: true,
    allowMissingUnit: false,
    referencePeriodLagMonths: 1,
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
    },
    official: [{ source: 'BLS', seriesId: 'CES0000000001', transform: 'DIFF' }],
    officialTolerance: 0,
    requireOfficialMatch: true,
    allowMissingUnit: false,
    referencePeriodLagMonths: 1,
  },
  {
    // Unemployment rate (U-3), SA. No US_UNEMPLOYMENT_RATE row yet — skipped until added.
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
    },
    official: [{ source: 'BLS', seriesId: 'LNS14000000', transform: 'LEVEL' }],
    officialTolerance: 0,
    requireOfficialMatch: true,
    allowMissingUnit: false,
    referencePeriodLagMonths: 1,
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
