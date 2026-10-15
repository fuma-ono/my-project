import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  EventPatch,
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
      const { data, error } = await supabase.from('fx_pairs').select('id, symbol, pip_size, price_precision');
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

    async insertIngestionLog(row: IngestionLogRow): Promise<void> {
      const { error } = await supabase.from('ingestion_logs').insert(row);
      if (error) throw error;
    },
  };
}
