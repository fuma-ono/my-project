/**
 * Provider Adapter interfaces (design.md §4.3, data-sources.md §2). One
 * implementation per external source under src/ingestion/adapters/. The
 * pipelines only ever see these interfaces and the normalized types, so a
 * provider can be swapped without touching validation or storage.
 */
import type {
  DateRange,
  InstantRange,
  NormalizedCalendarRelease,
  NormalizedCandle,
  NormalizedSpeech,
  OfficialObservation,
} from './types.js';

/** ① Paid economic calendar: schedule, forecast, actual, revisions. */
export interface EconomicCalendarProvider {
  readonly name: string;
  fetchCalendar(range: DateRange): Promise<NormalizedCalendarRelease[]>;
}

export interface ObservationQuery {
  seriesId: string;
  /** 'YYYY-MM-DD' inclusive. */
  observationStart: string;
  /** 'YYYY-MM-DD' inclusive. */
  observationEnd: string;
  /**
   * 'YYYY-MM-DD': return the values as they were known on that day
   * (point-in-time). Sources without vintages (BLS) ignore it and return
   * the current values — see OfficialStatsProvider.supportsPointInTime.
   */
  asOfDate?: string;
}

/** ② Free official statistics used to VERIFY actual values. */
export interface OfficialStatsProvider {
  readonly name: 'FRED' | 'BLS';
  /** true when asOfDate is honoured (FRED/ALFRED vintages). */
  readonly supportsPointInTime: boolean;
  fetchObservations(query: ObservationQuery): Promise<OfficialObservation[]>;
}

/** ③ / ⑤ 1-minute FX candles. */
export interface FxPriceProvider {
  readonly name: string;
  /** Candles whose open time is in [range.from, range.to). Gaps are returned as gaps — never filled. */
  fetchOneMinuteCandles(symbol: string, range: InstantRange): Promise<NormalizedCandle[]>;
}

/** ④ Central-bank speech schedules. */
export interface SpeechScheduleProvider {
  readonly name: string;
  fetchSpeeches(): Promise<NormalizedSpeech[]>;
}
