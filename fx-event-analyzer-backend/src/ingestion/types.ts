/**
 * Provider-independent ("normalized") shapes the Ingestion Worker works
 * with (design.md §4.3: Provider Adapter → Normalized Domain Model →
 * EconomicEvent / EventSnapshot / FxPrice). Every instant is an ISO 8601
 * UTC string ("...Z"); adapters convert from whatever the provider uses.
 */
import type { ReleaseDatetimePrecision } from '../domain/dataQuality.js';

export type { ReleaseDatetimePrecision };

/** What a number measures — the mapping table fixes one per indicator. */
export type ValueKind =
  /** The level itself (unemployment rate %, policy rate %, index level). */
  | 'LEVEL'
  /** % change vs the same period one year earlier. */
  | 'YOY_PCT'
  /** % change vs the previous period. */
  | 'MOM_PCT'
  /** Change in level vs the previous period (e.g. NFP, thousands of jobs). */
  | 'CHANGE';

export type SeasonalAdjustment = 'SA' | 'NSA';

/** Unit of the value as stored (event_snapshots.unit = MappedUnit's display string). */
export type MappedUnit = 'PERCENT' | 'THOUSANDS';

export type ReleaseStatus = 'PRELIMINARY' | 'REVISED' | 'FINAL' | 'UNKNOWN';

/** A number exactly as the provider reported it, plus its unit/suffix ("%", "K", "M", "" …). */
export interface ProviderValue {
  value: number;
  /** Raw unit or magnitude suffix from the provider, or null if none was given. */
  unit: string | null;
}

/** One calendar row from a paid economic calendar (①). */
export interface NormalizedCalendarRelease {
  provider: string;
  providerEventId: string;
  /** The key the mapping table matches on (e.g. "United States|Inflation Rate YoY"). */
  providerIndicatorKey: string;
  eventName: string;
  /** Scheduled release instant (UTC). */
  releaseAt: string;
  releaseAtPrecision: ReleaseDatetimePrecision;
  /** Reference period, 'YYYY-MM' for monthly indicators; null if the provider gave none. */
  referencePeriod: string | null;
  actual: ProviderValue | null;
  forecast: ProviderValue | null;
  previous: ProviderValue | null;
  /** The provider's revised figure for `previous`, when it reports one. */
  revisedPrevious: ProviderValue | null;
  fetchedAt: string;
  /**
   * HQ指示(2026-10-25)「過去イベント比較の表も前月と前年必要」: この指標の
   * 本来の値(valueKind)とは別の変換(mappings/indicators.tsのsecondary、
   * 例: 米国CPIのMoM%)で見た値。既にmapping.unitの単位に変換済みの数値
   * そのもの(ProviderValueでラップしない) — BLSの公式系列から自前で計算
   * した値であり、providerが報告した値ではないため。この経路
   * (blsCalendar.ts)だけが設定し、他の経路(paid calendar)はundefined。
   */
  secondaryActual?: number | null;
  secondaryPrevious?: number | null;
}

/** One observation of an official statistics series (②). */
export interface OfficialObservation {
  source: 'FRED' | 'BLS';
  seriesId: string;
  /** First day of the period, 'YYYY-MM-DD' (monthly: 'YYYY-MM-01'). */
  periodStart: string;
  /** null = the source reported the observation as missing (FRED "."). */
  value: number | null;
  /** 'YYYY-MM-DD' the value is "as of" (FRED realtime date / BLS fetch date). */
  asOfDate: string;
  releaseStatus: ReleaseStatus;
}

/** A 1-minute candle (③/⑤). `openTime` is the candle's OPEN time (db-design.md §3.11). */
export interface NormalizedCandle {
  provider: string;
  /** Internal symbol, e.g. "USDJPY". */
  symbol: string;
  openTime: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
}

export type SpeechKind = 'SPEECH' | 'DISCUSSION' | 'TESTIMONY' | 'INTERVIEW' | 'PRESS_CONFERENCE' | 'OTHER';

/** One central-bank speech / appearance (④). */
export interface NormalizedSpeech {
  provider: string;
  providerEventId: string;
  /** Speaker name exactly as the source writes it (with the role words removed). */
  speakerName: string;
  /** Organization of the source ('FRB', 'ECB', …) — speakers.organization. */
  organization: string;
  kind: SpeechKind;
  /** Topic / headline in the source's language. */
  topic: string | null;
  startsAt: string;
  /**
   * EXACT = the source states the scheduled time of the appearance.
   * PUBLICATION_TIME = only the time the text was published is known
   * (e.g. RSS pubDate) — never used as statement_datetime by default,
   * because speech reactions are computed per minute from it.
   */
  timePrecision: 'EXACT' | 'PUBLICATION_TIME';
  url: string | null;
}

export interface DateRange {
  /** Inclusive, 'YYYY-MM-DD'. */
  from: string;
  /** Inclusive, 'YYYY-MM-DD'. */
  to: string;
}

export interface InstantRange {
  /** Inclusive ISO instant. */
  from: string;
  /** Exclusive ISO instant. */
  to: string;
}
