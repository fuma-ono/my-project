/**
 * Storage boundary of the Ingestion Worker. The Supabase implementation is
 * src/repositories/ingestionRepository.ts; tests use an in-memory one
 * (tests/helpers/memoryIngestionStore.ts). Every write is idempotent with
 * respect to its natural key (provider + provider_event_id, series +
 * period + as-of date, pair + timeframe + candle open time), so re-running
 * a job never duplicates rows.
 */
import type { ReleaseDatetimePrecision } from './types.js';

export interface IndicatorRef {
  id: string;
  code: string;
  importance: 'LOW' | 'MEDIUM' | 'HIGH';
  favorable_direction: 'HIGHER_IS_POSITIVE' | 'LOWER_IS_POSITIVE' | 'NEUTRAL';
}

export interface StoredEvent {
  id: string;
  indicator_id: string;
  release_datetime: string;
  release_datetime_precision: ReleaseDatetimePrecision;
  status: 'SCHEDULED' | 'RELEASED' | 'CANCELLED';
  data_status: 'PENDING' | 'AVAILABLE' | 'PARTIAL' | 'UNAVAILABLE';
}

export interface NewEvent {
  /** economic_events.is_provisional (migration 20261022000002, DB default false). Only the FOMC schedule sets it. */
  is_provisional?: boolean;
  indicator_id: string;
  provider: string;
  provider_event_id: string;
  release_datetime: string;
  release_datetime_precision: ReleaseDatetimePrecision;
  importance: 'LOW' | 'MEDIUM' | 'HIGH';
  status: 'SCHEDULED' | 'RELEASED' | 'CANCELLED';
  /** UNAVAILABLE only together with status CANCELLED (no value will ever come; BLS予定の取りやめ、v1.36). */
  data_status: 'PENDING' | 'UNAVAILABLE';
}

export type EventPatch = Partial<
  Pick<StoredEvent, 'release_datetime' | 'release_datetime_precision' | 'status' | 'data_status'> & {
    is_provisional: boolean;
  }
>;

/** An economic_events row of one provider, as the FOMC schedule job compares it with its table. */
export interface ProviderEventRow extends StoredEvent {
  provider_event_id: string;
  is_provisional: boolean;
}

export interface StoredSnapshot {
  forecast: number | null;
  actual: number | null;
  previous: number | null;
}

export interface NewReleaseSnapshot {
  event_id: string;
  forecast: number | null;
  actual: number;
  previous: number | null;
  unit: string;
  source: string;
  source_url: string;
  captured_at: string;
  surprise: number | null;
  surprise_direction: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL' | null;
  verification_status: 'VERIFIED' | 'SINGLE_SOURCE';
  verification_source: string | null;
  official_actual: number | null;
  /** HQ指示(2026-10-25)「過去イベント比較の表も前月と前年必要」: mapping.secondaryが設定された指標だけ埋まる(今は米国CPIのMOM_PCT)。 */
  secondary_value_kind: 'LEVEL' | 'YOY_PCT' | 'MOM_PCT' | 'CHANGE' | null;
  secondary_actual: number | null;
  secondary_forecast: number | null;
  secondary_previous: number | null;
}

export interface NewRevision {
  event_id: string;
  field_name: 'ACTUAL' | 'PREVIOUS';
  old_value: number;
  new_value: number;
  effective_at: string;
  source: string;
}

export type StagedVerificationStatus =
  'AWAITING_OFFICIAL' | 'PENDING_REVIEW' | 'VERIFIED' | 'SINGLE_SOURCE' | 'REJECTED';

export interface StagedValue {
  id: string;
  event_id: string;
  kind: 'RELEASE' | 'REVISION';
  revision_field: 'ACTUAL' | 'PREVIOUS' | null;
  provider: string;
  provider_event_id: string;
  indicator_code: string;
  reference_period: string | null;
  forecast: number | null;
  actual: number | null;
  previous: number | null;
  old_value: number | null;
  new_value: number | null;
  unit: string | null;
  source: string | null;
  source_url: string | null;
  release_status: 'PRELIMINARY' | 'REVISED' | 'FINAL' | 'UNKNOWN';
  fetched_at: string;
  official_actual: number | null;
  official_source: string | null;
  verification_status: StagedVerificationStatus;
  reasons: string[];
  /** Release instant of the event (for official as-of dates). Not a column — joined from economic_events. */
  release_datetime: string;
}

export type NewStagedValue = Omit<StagedValue, 'id' | 'release_datetime'>;

export interface OfficialObservationRow {
  source: 'FRED' | 'BLS';
  series_id: string;
  period_start: string;
  as_of_date: string;
  value: number | null;
  release_status: 'PRELIMINARY' | 'REVISED' | 'FINAL' | 'UNKNOWN';
  fetched_at: string;
}

export interface SpeakerRef {
  id: string;
  name: string;
  organization: string;
}

export interface SpeechEventRow {
  speaker_id: string;
  provider: string;
  provider_event_id: string;
  title: string;
  statement_datetime: string;
  importance: 'LOW' | 'MEDIUM' | 'HIGH';
  status: 'SCHEDULED' | 'DELIVERED';
}

export type SpeechStatus = 'SCHEDULED' | 'DELIVERED' | 'CANCELLED';

/** A stored speech_events row of one provider, as the reconciliation reads it (pipelines/speeches.ts). */
export interface StoredSpeechRef {
  provider_event_id: string;
  speaker_id: string;
  title: string;
  statement_datetime: string;
  status: SpeechStatus;
}

/** Columns the reconciliation changes on an existing speech_events row. */
export type SpeechEventPatch = Partial<
  Pick<SpeechEventRow, 'provider_event_id' | 'title' | 'statement_datetime' | 'importance'> & {
    status: SpeechStatus;
  }
>;

export interface FxPairRef {
  id: string;
  symbol: string;
  pip_size: number;
  price_precision: number;
  /** For currency-relevant pair filtering (event_price_reactions writer). Optional: existing
   * callers/fixtures that don't need it are unaffected. */
  base_currency?: string;
  quote_currency?: string;
}

export interface FxPriceRow {
  fx_pair_id: string;
  timestamp: string;
  /** 1m comes from the provider; 5m–60m are built from it (pipelines/fxPrices.ts). */
  timeframe: '1m' | '5m' | '15m' | '30m' | '60m';
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
  source: string;
  verification_status: 'VERIFIED' | 'SINGLE_SOURCE' | 'UNVERIFIED';
  cross_check_source: string | null;
  cross_check_close: number | null;
  cross_check_diff_pips: number | null;
}

export interface IngestionLogRow {
  provider: string;
  data_type: 'ECONOMIC_EVENT' | 'FX_PRICE' | 'EVENT_REACTION' | 'OTHER';
  job: string;
  started_at: string;
  completed_at: string;
  status: 'SUCCESS' | 'FAILURE' | 'PARTIAL';
  fetched_count: number;
  success_count: number;
  error_count: number;
  skipped_count: number;
  review_count: number;
  error_message: string | null;
  details: Record<string, unknown>;
}

/** ingestion_logs row of ingest:fx-prices, reduced to what the gap repair reads back. */
export interface FxIngestionLogSample {
  started_at: string;
  details: { no_data_unconfirmed?: unknown };
}

/**
 * A RELEASED economic event, as needed to compute event_price_reactions
 * (HQ決定 2026-10-18「経済指標の価格反応計算」). currency_code comes from
 * the event's indicator (economic_indicators.currency_code), joined —
 * economic_events itself has no currency column.
 */
export interface EventForReactionRef {
  id: string;
  release_datetime: string;
  release_datetime_precision: ReleaseDatetimePrecision;
  currency_code: string;
}

export interface EventPriceReactionRow {
  event_id: string;
  fx_pair_id: string;
  timeframe: '1m' | '5m' | '15m' | '30m' | '60m';
  pre_release_price: number | null;
  post_release_price: number | null;
  movement: number | null;
  pips: number | null;
  change_percent: number | null;
  max_upward: number | null;
  max_downward: number | null;
  max_upward_pips: number | null;
  max_downward_pips: number | null;
  /** 'PENDING' is never written (db-design.md §3.12) — a timeframe not ready yet is simply
   * not written, and the API already defaults a missing row to DATA_PENDING. */
  data_status: 'AVAILABLE' | 'UNAVAILABLE';
  calculated_at: string;
}

export interface ApiCreditReservation {
  provider: string;
  job: string;
  runId: string;
  credits: number;
  /**
   * AUTOMATIC (scheduled) or MANUAL (--manual, eval:providers). The limits live in the DB
   * (api_credit_limits, migration 20261016000003), not in the caller: AUTOMATIC succeeds only if
   * today's total of ALL reservations + credits ≤ automatic_cap (700), MANUAL only if ≤ daily_total_cap (800).
   */
  mode: CreditMode;
}

export type CreditMode = 'AUTOMATIC' | 'MANUAL';

/** An un-released (SCHEDULED / CANCELLED) economic_events row of one provider (BLS予定の点検用、v1.36)。 */
export interface UnreleasedEventRef {
  id: string;
  provider_event_id: string;
  status: 'SCHEDULED' | 'CANCELLED';
  release_datetime: string;
}

export interface IngestionStore {
  findIndicatorsByCode(codes: readonly string[]): Promise<Map<string, IndicatorRef>>;
  /**
   * economic_events rows of `provider` whose status is not RELEASED (SCHEDULED / CANCELLED).
   * is_provisional を読まないので、FOMC の列(migration 20261022000002)が無い DB でも動く。
   */
  listUnreleasedEventsByProvider(provider: string): Promise<UnreleasedEventRef[]>;
  /** Every economic_events row of `provider` that has a provider_event_id (with is_provisional). */
  listEventsByProvider(provider: string): Promise<ProviderEventRow[]>;
  findEventByProviderId(provider: string, providerEventId: string): Promise<StoredEvent | null>;
  insertEvent(event: NewEvent): Promise<StoredEvent>;
  updateEvent(eventId: string, patch: EventPatch): Promise<void>;
  getReleaseSnapshot(eventId: string): Promise<StoredSnapshot | null>;
  insertReleaseSnapshot(snapshot: NewReleaseSnapshot): Promise<void>;
  /** Latest revision value per field for the event (to skip re-recording the same revision). */
  latestRevisionValues(eventId: string): Promise<{ ACTUAL: number | null; PREVIOUS: number | null }>;
  insertRevision(revision: NewRevision): Promise<void>;
  /** The open (AWAITING_OFFICIAL / PENDING_REVIEW) staged value for event + kind + field, if any. */
  findOpenStagedValue(
    eventId: string,
    kind: 'RELEASE' | 'REVISION',
    revisionField: 'ACTUAL' | 'PREVIOUS' | null,
  ): Promise<StagedValue | null>;
  insertStagedValue(value: NewStagedValue): Promise<void>;
  updateStagedValue(id: string, patch: Partial<NewStagedValue> & { resolved_at?: string | null }): Promise<void>;
  listStagedValues(status: StagedVerificationStatus): Promise<StagedValue[]>;
  upsertOfficialObservations(rows: readonly OfficialObservationRow[]): Promise<number>;
  listSpeakers(): Promise<SpeakerRef[]>;
  upsertSpeechEvents(rows: readonly SpeechEventRow[]): Promise<number>;
  /** provider_event_ids of SCHEDULED speeches of `provider` with statement_datetime in [fromIso, toIso). */
  listScheduledSpeechIds(provider: string, fromIso: string, toIso: string): Promise<string[]>;
  /** speech_events of `provider` (any status) with statement_datetime in [fromIso, toIso). */
  listSpeechRefs(provider: string, fromIso: string, toIso: string): Promise<StoredSpeechRef[]>;
  /** Updates one row found by (provider, provider_event_id). The DB trigger records CANCELLED / RESCHEDULED. */
  updateSpeechEvent(provider: string, providerEventId: string, patch: SpeechEventPatch): Promise<void>;
  listFxPairs(): Promise<FxPairRef[]>;
  upsertFxPrices(rows: readonly FxPriceRow[]): Promise<number>;
  /** 1m candle open times of the pair in [fromIso, toIso), ascending (ISO strings). */
  listFxMinuteTimestamps(fxPairId: string, fromIso: string, toIso: string): Promise<string[]>;
  /** Earliest stored 1m open time of the pair (= when ingestion started for it), or null. */
  firstFxMinute(fxPairId: string): Promise<string | null>;
  /** Full 1m rows of the pair in [fromIso, toIso), ascending. */
  listFxMinuteRows(fxPairId: string, fromIso: string, toIso: string): Promise<FxPriceRow[]>;
  /** ingest:fx-prices log rows started at or after sinceIso (no_data_unconfirmed history). */
  listRecentFxIngestionLogs(sinceIso: string): Promise<FxIngestionLogSample[]>;
  /** Atomic check-and-reserve in the API-credit ledger; false = cap reached, nothing reserved. */
  reserveApiCredits(reservation: ApiCreditReservation): Promise<boolean>;
  /** Credits reserved today (UTC) for the provider, all jobs. */
  todayApiCredits(provider: string): Promise<number>;
  insertIngestionLog(row: IngestionLogRow): Promise<void>;
  /** RELEASED events with release_datetime >= sinceIso (bounds the scan to the repair horizon). */
  listReleasedEventsForReactions(sinceIso: string): Promise<EventForReactionRef[]>;
  /** Upsert by (event_id, fx_pair_id, timeframe) — re-running never duplicates a row. */
  upsertEventPriceReactions(rows: readonly EventPriceReactionRow[]): Promise<number>;
  /** Stored reaction rows of these events (read only; compared before writing — HQ指示 2026-10-27). */
  listEventPriceReactions(eventIds: readonly string[]): Promise<EventPriceReactionRow[]>;
}
