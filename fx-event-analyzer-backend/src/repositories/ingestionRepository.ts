import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  ApiCreditReservation,
  EventForReactionRef,
  EventPatch,
  EventPriceReactionRow,
  FxIngestionLogSample,
  FxPairRef,
  FxPriceRow,
  IndicatorRef,
  IngestionLogRow,
  IngestionStore,
  NewEvent,
  NewReleaseSnapshot,
  NewRevision,
  NewStagedValue,
  OfficialObservationRow,
  ProviderEventRow,
  UnreleasedEventRef,
  SpeakerRef,
  SpeechEventRow,
  StagedValue,
  StagedVerificationStatus,
  StoredEvent,
  StoredSnapshot,
} from '../ingestion/store.js';

/**
 * Supabase (service_role) implementation of the Ingestion Worker's store
 * (src/ingestion/store.ts). Write-side only — the Read API never imports
 * this file, and in particular never reads ingestion_staged_values.
 *
 * economic_events has a PARTIAL unique index on (provider,
 * provider_event_id), which PostgREST's on_conflict cannot target, so
 * events are looked up first and then inserted / updated by id.
 */
const EVENT_COLUMNS = 'id, indicator_id, release_datetime, release_datetime_precision, status, data_status';
const STAGED_COLUMNS =
  'id, event_id, kind, revision_field, provider, provider_event_id, indicator_code, reference_period, forecast, actual, previous, old_value, new_value, unit, source, source_url, release_status, fetched_at, official_actual, official_source, verification_status, reasons, economic_events!inner(release_datetime)';

const num = (value: unknown): number | null => (value === null || value === undefined ? null : Number(value));

function toStaged(row: Record<string, unknown>): StagedValue {
  const event = row.economic_events as { release_datetime: string };
  return {
    id: row.id as string,
    event_id: row.event_id as string,
    kind: row.kind as StagedValue['kind'],
    revision_field: (row.revision_field as StagedValue['revision_field']) ?? null,
    provider: row.provider as string,
    provider_event_id: row.provider_event_id as string,
    indicator_code: row.indicator_code as string,
    reference_period: (row.reference_period as string | null) ?? null,
    forecast: num(row.forecast),
    actual: num(row.actual),
    previous: num(row.previous),
    old_value: num(row.old_value),
    new_value: num(row.new_value),
    unit: (row.unit as string | null) ?? null,
    source: (row.source as string | null) ?? null,
    source_url: (row.source_url as string | null) ?? null,
    release_status: row.release_status as StagedValue['release_status'],
    fetched_at: row.fetched_at as string,
    official_actual: num(row.official_actual),
    official_source: (row.official_source as string | null) ?? null,
    verification_status: row.verification_status as StagedVerificationStatus,
    reasons: (row.reasons as string[] | null) ?? [],
    release_datetime: event.release_datetime,
  };
}

const UPSERT_CHUNK = 500;
/** PostgREST returns at most 1000 rows per request — longer lists are paged with .range(). */
const PAGE_SIZE = 1000;
const FX_ROW_COLUMNS =
  'fx_pair_id, timestamp, timeframe, open, high, low, close, volume, source, verification_status, cross_check_source, cross_check_close, cross_check_diff_pips';

interface Page {
  data: unknown[] | null;
  error: unknown;
}

/** Calls `page(from, to)` (inclusive offsets, stable order) until a short page comes back. */
async function allPages<T>(page: (from: number, to: number) => PromiseLike<Page>): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await page(offset, offset + PAGE_SIZE - 1);
    if (error) throw error instanceof Error ? error : new Error(JSON.stringify(error));
    const chunk = (data ?? []) as T[];
    rows.push(...chunk);
    if (chunk.length < PAGE_SIZE) return rows;
  }
}

function toFxRow(row: Record<string, unknown>): FxPriceRow {
  return {
    fx_pair_id: row.fx_pair_id as string,
    timestamp: new Date(row.timestamp as string).toISOString(),
    timeframe: row.timeframe as FxPriceRow['timeframe'],
    open: Number(row.open),
    high: Number(row.high),
    low: Number(row.low),
    close: Number(row.close),
    volume: num(row.volume),
    source: (row.source as string | null) ?? '',
    verification_status: row.verification_status as FxPriceRow['verification_status'],
    cross_check_source: (row.cross_check_source as string | null) ?? null,
    cross_check_close: num(row.cross_check_close),
    cross_check_diff_pips: num(row.cross_check_diff_pips),
  };
}

export function createIngestionRepository(supabase: SupabaseClient): IngestionStore {
  return {
    async findIndicatorsByCode(codes: readonly string[]): Promise<Map<string, IndicatorRef>> {
      const map = new Map<string, IndicatorRef>();
      if (codes.length === 0) return map;
      const { data, error } = await supabase
        .from('economic_indicators')
        .select('id, code, importance, favorable_direction')
        .in('code', [...codes]);
      if (error) throw error;
      for (const row of (data ?? []) as IndicatorRef[]) map.set(row.code, row);
      return map;
    },

    async listEventsByProvider(provider: string): Promise<ProviderEventRow[]> {
      return allPages<ProviderEventRow>((from, to) =>
        supabase
          .from('economic_events')
          .select(`${EVENT_COLUMNS}, provider_event_id, is_provisional`)
          .eq('provider', provider)
          .not('provider_event_id', 'is', null)
          .order('id', { ascending: true })
          .range(from, to),
      );
    },

    async listUnreleasedEventsByProvider(provider: string): Promise<UnreleasedEventRef[]> {
      return allPages<UnreleasedEventRef>((from, to) =>
        supabase
          .from('economic_events')
          .select('id, provider_event_id, status, release_datetime')
          .eq('provider', provider)
          .neq('status', 'RELEASED')
          .not('provider_event_id', 'is', null)
          .order('id', { ascending: true })
          .range(from, to),
      );
    },

    async findEventByProviderId(provider: string, providerEventId: string): Promise<StoredEvent | null> {
      const { data, error } = await supabase
        .from('economic_events')
        .select(EVENT_COLUMNS)
        .eq('provider', provider)
        .eq('provider_event_id', providerEventId)
        .maybeSingle();
      if (error) throw error;
      return data ?? null;
    },

    async insertEvent(event: NewEvent): Promise<StoredEvent> {
      const { data, error } = await supabase.from('economic_events').insert(event).select(EVENT_COLUMNS).single();
      if (error) throw error;
      return data;
    },

    async updateEvent(eventId: string, patch: EventPatch): Promise<void> {
      const { error } = await supabase.from('economic_events').update(patch).eq('id', eventId);
      if (error) throw error;
    },

    async getReleaseSnapshot(eventId: string): Promise<StoredSnapshot | null> {
      const { data, error } = await supabase
        .from('event_snapshots')
        .select('forecast, actual, previous')
        .eq('event_id', eventId)
        .eq('snapshot_type', 'RELEASE')
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return { forecast: num(data.forecast), actual: num(data.actual), previous: num(data.previous) };
    },

    async insertReleaseSnapshot(snapshot: NewReleaseSnapshot): Promise<void> {
      const { error } = await supabase.from('event_snapshots').insert({ ...snapshot, snapshot_type: 'RELEASE' });
      if (error) throw error;
    },

    async latestRevisionValues(eventId: string): Promise<{ ACTUAL: number | null; PREVIOUS: number | null }> {
      const { data, error } = await supabase
        .from('event_revisions')
        .select('field_name, new_value, effective_at, created_at')
        .eq('event_id', eventId)
        .order('effective_at', { ascending: false })
        .order('created_at', { ascending: false });
      if (error) throw error;
      const result: { ACTUAL: number | null; PREVIOUS: number | null } = { ACTUAL: null, PREVIOUS: null };
      for (const row of (data ?? []) as { field_name: 'ACTUAL' | 'PREVIOUS'; new_value: unknown }[]) {
        if (result[row.field_name] === null) result[row.field_name] = num(row.new_value);
      }
      return result;
    },

    async insertRevision(revision: NewRevision): Promise<void> {
      const { error } = await supabase.from('event_revisions').insert(revision);
      if (error) throw error;
    },

    async findOpenStagedValue(eventId, kind, revisionField): Promise<StagedValue | null> {
      let query = supabase
        .from('ingestion_staged_values')
        .select(STAGED_COLUMNS)
        .eq('event_id', eventId)
        .eq('kind', kind)
        .in('verification_status', ['AWAITING_OFFICIAL', 'PENDING_REVIEW']);
      query = revisionField === null ? query.is('revision_field', null) : query.eq('revision_field', revisionField);
      const { data, error } = await query.maybeSingle();
      if (error) throw error;
      return data ? toStaged(data) : null;
    },

    async insertStagedValue(value: NewStagedValue): Promise<void> {
      const { error } = await supabase.from('ingestion_staged_values').insert(value);
      if (error) throw error;
    },

    async updateStagedValue(id: string, patch): Promise<void> {
      const { error } = await supabase.from('ingestion_staged_values').update(patch).eq('id', id);
      if (error) throw error;
    },

    async listStagedValues(status: StagedVerificationStatus): Promise<StagedValue[]> {
      const { data, error } = await supabase
        .from('ingestion_staged_values')
        .select(STAGED_COLUMNS)
        .eq('verification_status', status)
        .order('created_at', { ascending: true })
        .limit(500);
      if (error) throw error;
      return ((data ?? []) as Record<string, unknown>[]).map(toStaged);
    },

    async upsertOfficialObservations(rows: readonly OfficialObservationRow[]): Promise<number> {
      let count = 0;
      for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
        const chunk = rows.slice(i, i + UPSERT_CHUNK);
        const { error } = await supabase
          .from('official_observations')
          .upsert(chunk, { onConflict: 'source,series_id,period_start,as_of_date' });
        if (error) throw error;
        count += chunk.length;
      }
      return count;
    },

    async listSpeakers(): Promise<SpeakerRef[]> {
      const { data, error } = await supabase.from('speakers').select('id, name, organization');
      if (error) throw error;
      return data ?? [];
    },

    async upsertSpeechEvents(rows: readonly SpeechEventRow[]): Promise<number> {
      const { error } = await supabase
        .from('speech_events')
        .upsert([...rows], { onConflict: 'provider,provider_event_id' });
      if (error) throw error;
      return rows.length;
    },

    async listScheduledSpeechIds(provider: string, fromIso: string, toIso: string): Promise<string[]> {
      const { data, error } = await supabase
        .from('speech_events')
        .select('provider_event_id')
        .eq('provider', provider)
        .eq('status', 'SCHEDULED')
        .gte('statement_datetime', fromIso)
        .lt('statement_datetime', toIso);
      if (error) throw error;
      return ((data ?? []) as { provider_event_id: string }[]).map((row) => row.provider_event_id);
    },

    async listFxPairs(): Promise<FxPairRef[]> {
      const { data, error } = await supabase
        .from('fx_pairs')
        .select('id, symbol, pip_size, price_precision, base_currency, quote_currency');
      if (error) throw error;
      return ((data ?? []) as FxPairRef[]).map((row) => ({
        ...row,
        pip_size: Number(row.pip_size),
        price_precision: Number(row.price_precision),
      }));
    },

    async upsertFxPrices(rows: readonly FxPriceRow[]): Promise<number> {
      let count = 0;
      for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
        const chunk = rows.slice(i, i + UPSERT_CHUNK);
        const { error } = await supabase
          .from('fx_prices')
          .upsert(chunk, { onConflict: 'fx_pair_id,timeframe,timestamp' });
        if (error) throw error;
        count += chunk.length;
      }
      return count;
    },

    async listFxMinuteTimestamps(fxPairId: string, fromIso: string, toIso: string): Promise<string[]> {
      const rows = await allPages<{ timestamp: string }>((from, to) =>
        supabase
          .from('fx_prices')
          .select('timestamp')
          .eq('fx_pair_id', fxPairId)
          .eq('timeframe', '1m')
          .gte('timestamp', fromIso)
          .lt('timestamp', toIso)
          .order('timestamp', { ascending: true })
          .range(from, to),
      );
      return rows.map((row) => new Date(row.timestamp).toISOString());
    },

    async firstFxMinute(fxPairId: string): Promise<string | null> {
      const { data, error } = await supabase
        .from('fx_prices')
        .select('timestamp')
        .eq('fx_pair_id', fxPairId)
        .eq('timeframe', '1m')
        .order('timestamp', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      const row: { timestamp: string } | null = data;
      return row ? new Date(row.timestamp).toISOString() : null;
    },

    async listFxMinuteRows(fxPairId: string, fromIso: string, toIso: string): Promise<FxPriceRow[]> {
      const rows = await allPages<Record<string, unknown>>((from, to) =>
        supabase
          .from('fx_prices')
          .select(FX_ROW_COLUMNS)
          .eq('fx_pair_id', fxPairId)
          .eq('timeframe', '1m')
          .gte('timestamp', fromIso)
          .lt('timestamp', toIso)
          .order('timestamp', { ascending: true })
          .range(from, to),
      );
      return rows.map(toFxRow);
    },

    async listRecentFxIngestionLogs(sinceIso: string): Promise<FxIngestionLogSample[]> {
      // Only the one details key the gap repair needs (not the whole details JSON).
      const rows = await allPages<{ started_at: string; no_data_unconfirmed: unknown }>((from, to) =>
        supabase
          .from('ingestion_logs')
          .select('id, started_at, no_data_unconfirmed:details->no_data_unconfirmed')
          .eq('job', 'ingest:fx-prices')
          .gte('started_at', sinceIso)
          .order('started_at', { ascending: true })
          .order('id', { ascending: true })
          .range(from, to),
      );
      return rows.map((row) => ({
        started_at: new Date(row.started_at).toISOString(),
        details: { no_data_unconfirmed: row.no_data_unconfirmed ?? undefined },
      }));
    },

    async reserveApiCredits(reservation: ApiCreditReservation): Promise<boolean> {
      const { data, error } = await supabase.rpc('reserve_api_credits', {
        p_provider: reservation.provider,
        p_job: reservation.job,
        p_run_id: reservation.runId,
        p_credits: reservation.credits,
        p_mode: reservation.mode,
      });
      if (error) throw error;
      return data === true;
    },

    async todayApiCredits(provider: string): Promise<number> {
      const { data, error } = await supabase.rpc('api_credits_used_today', { p_provider: provider });
      if (error) throw error;
      return Number(data ?? 0);
    },

    async insertIngestionLog(row: IngestionLogRow): Promise<void> {
      const { error } = await supabase.from('ingestion_logs').insert(row);
      if (error) throw error;
    },

    async listReleasedEventsForReactions(sinceIso: string): Promise<EventForReactionRef[]> {
      const rows = await allPages<{
        id: string;
        release_datetime: string;
        release_datetime_precision: string;
        economic_indicators: { currency_code: string } | null;
      }>((from, to) =>
        supabase
          .from('economic_events')
          .select('id, release_datetime, release_datetime_precision, economic_indicators!inner(currency_code)')
          .eq('status', 'RELEASED')
          .gte('release_datetime', sinceIso)
          .order('release_datetime', { ascending: true })
          .order('id', { ascending: true })
          .range(from, to),
      );
      return rows.map((row) => ({
        id: row.id,
        release_datetime: row.release_datetime,
        release_datetime_precision: row.release_datetime_precision as EventForReactionRef['release_datetime_precision'],
        currency_code: row.economic_indicators?.currency_code ?? '',
      }));
    },

    async upsertEventPriceReactions(rows: readonly EventPriceReactionRow[]): Promise<number> {
      let count = 0;
      for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
        const chunk = rows.slice(i, i + UPSERT_CHUNK);
        const { error } = await supabase
          .from('event_price_reactions')
          .upsert(chunk, { onConflict: 'event_id,fx_pair_id,timeframe' });
        if (error) throw error;
        count += chunk.length;
      }
      return count;
    },
  };
}
