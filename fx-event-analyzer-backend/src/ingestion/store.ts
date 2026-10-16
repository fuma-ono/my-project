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
  indicator_id: string;
  provider: string;
  provider_event_id: string;
  release_datetime: string;
  release_datetime_precision: ReleaseDatetimePrecision;
  importance: 'LOW' | 'MEDIUM' | 'HIGH';
  status: 'SCHEDULED' | 'RELEASED';
  data_status: 'PENDING';
}

export type EventPatch = Partial<
  Pick<StoredEvent, 'release_datetime' | 'release_datetime_precision' | 'status' | 'data_status'>
>;

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

export interface FxPairRef {
  id: string;
  symbol: string;
  pip_size: number;
  price_precision: number;
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

export interface IngestionStore {
  findIndicatorsByCode(codes: readonly string[]): Promise<Map<string, IndicatorRef>>;
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
  listFxPairs(): Promise<FxPairRef[]>;
  upsertFxPrices(rows: readonly FxPriceRow[]): Promise<number>;
  insertIngestionLog(row: IngestionLogRow): Promise<void>;
}
