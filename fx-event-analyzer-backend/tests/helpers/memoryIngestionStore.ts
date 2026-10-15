import type {
  FxPairRef,
  FxPriceRow,
  IndicatorRef,
  IngestionLogRow,
  IngestionStore,
  NewReleaseSnapshot,
  NewRevision,
  NewStagedValue,
  OfficialObservationRow,
  SpeakerRef,
  SpeechEventRow,
  StagedValue,
  StoredEvent,
} from '../../src/ingestion/store.js';

/**
 * In-memory IngestionStore for pipeline unit tests. Mirrors the DB rules
 * the pipelines rely on: unique (provider, provider_event_id) for events,
 * UQ(event_id, snapshot_type) + RELEASE immutability for snapshots, the
 * "one open staged value per event/kind/field" index, and upsert keys.
 */
export class MemoryIngestionStore implements IngestionStore {
  indicators: IndicatorRef[] = [];
  events: (StoredEvent & { provider: string; provider_event_id: string; importance: string })[] = [];
  snapshots: NewReleaseSnapshot[] = [];
  revisions: (NewRevision & { created_at: string })[] = [];
  staged: (NewStagedValue & { id: string; resolved_at?: string | null })[] = [];
  observations: OfficialObservationRow[] = [];
  speakers: SpeakerRef[] = [];
  speeches: SpeechEventRow[] = [];
  fxPairs: FxPairRef[] = [];
  fxPrices: FxPriceRow[] = [];
  logs: IngestionLogRow[] = [];
  private seq = 0;

  private nextId(prefix: string): string {
    this.seq += 1;
    return `${prefix}-${this.seq}`;
  }

  findIndicatorsByCode(codes: readonly string[]): Promise<Map<string, IndicatorRef>> {
    return Promise.resolve(new Map(this.indicators.filter((i) => codes.includes(i.code)).map((i) => [i.code, i])));
  }

  findEventByProviderId(provider: string, providerEventId: string): Promise<StoredEvent | null> {
    return Promise.resolve(
      this.events.find((e) => e.provider === provider && e.provider_event_id === providerEventId) ?? null,
    );
  }

  insertEvent(event: Parameters<IngestionStore['insertEvent']>[0]): Promise<StoredEvent> {
    if (this.events.some((e) => e.provider === event.provider && e.provider_event_id === event.provider_event_id)) {
      return Promise.reject(new Error('duplicate key uq_economic_events_provider_event'));
    }
    const row = { id: this.nextId('event'), ...event };
    this.events.push(row);
    return Promise.resolve(row);
  }

  updateEvent(eventId: string, patch: Parameters<IngestionStore['updateEvent']>[1]): Promise<void> {
    const event = this.events.find((e) => e.id === eventId);
    if (!event) return Promise.reject(new Error(`no event ${eventId}`));
    Object.assign(event, patch);
    return Promise.resolve();
  }

  getReleaseSnapshot(eventId: string) {
    const s = this.snapshots.find((snapshot) => snapshot.event_id === eventId);
    return Promise.resolve(s ? { forecast: s.forecast, actual: s.actual, previous: s.previous } : null);
  }

  insertReleaseSnapshot(snapshot: NewReleaseSnapshot): Promise<void> {
    if (this.snapshots.some((s) => s.event_id === snapshot.event_id)) {
      return Promise.reject(new Error('duplicate key event_snapshots (event_id, snapshot_type)'));
    }
    this.snapshots.push(snapshot);
    return Promise.resolve();
  }

  latestRevisionValues(eventId: string) {
    const result: { ACTUAL: number | null; PREVIOUS: number | null } = { ACTUAL: null, PREVIOUS: null };
    for (const revision of [...this.revisions].reverse()) {
      if (revision.event_id === eventId && result[revision.field_name] === null) {
        result[revision.field_name] = revision.new_value;
      }
    }
    return Promise.resolve(result);
  }

  insertRevision(revision: NewRevision): Promise<void> {
    this.revisions.push({ ...revision, created_at: new Date().toISOString() });
    return Promise.resolve();
  }

  private toStaged(row: NewStagedValue & { id: string }): StagedValue {
    const event = this.events.find((e) => e.id === row.event_id);
    return { ...row, release_datetime: event?.release_datetime ?? '' };
  }

  findOpenStagedValue(eventId: string, kind: 'RELEASE' | 'REVISION', revisionField: 'ACTUAL' | 'PREVIOUS' | null) {
    const row = this.staged.find(
      (s) =>
        s.event_id === eventId &&
        s.kind === kind &&
        s.revision_field === revisionField &&
        (s.verification_status === 'AWAITING_OFFICIAL' || s.verification_status === 'PENDING_REVIEW'),
    );
    return Promise.resolve(row ? this.toStaged(row) : null);
  }

  async insertStagedValue(value: NewStagedValue): Promise<void> {
    if (await this.findOpenStagedValue(value.event_id, value.kind, value.revision_field)) {
      throw new Error('duplicate key uq_ingestion_staged_values_open');
    }
    this.staged.push({ ...value, id: this.nextId('staged') });
  }

  updateStagedValue(id: string, patch: Partial<NewStagedValue> & { resolved_at?: string | null }): Promise<void> {
    const row = this.staged.find((s) => s.id === id);
    if (!row) return Promise.reject(new Error(`no staged ${id}`));
    Object.assign(row, patch);
    return Promise.resolve();
  }

  listStagedValues(status: StagedValue['verification_status']): Promise<StagedValue[]> {
    return Promise.resolve(this.staged.filter((s) => s.verification_status === status).map((s) => this.toStaged(s)));
  }

  upsertOfficialObservations(rows: readonly OfficialObservationRow[]): Promise<number> {
    for (const row of rows) {
      const index = this.observations.findIndex(
        (o) =>
          o.source === row.source &&
          o.series_id === row.series_id &&
          o.period_start === row.period_start &&
          o.as_of_date === row.as_of_date,
      );
      if (index === -1) this.observations.push(row);
      else this.observations[index] = row;
    }
    return Promise.resolve(rows.length);
  }

  listSpeakers(): Promise<SpeakerRef[]> {
    return Promise.resolve(this.speakers);
  }

  upsertSpeechEvents(rows: readonly SpeechEventRow[]): Promise<number> {
    for (const row of rows) {
      const index = this.speeches.findIndex(
        (s) => s.provider === row.provider && s.provider_event_id === row.provider_event_id,
      );
      if (index === -1) this.speeches.push(row);
      else this.speeches[index] = row;
    }
    return Promise.resolve(rows.length);
  }

  listScheduledSpeechIds(provider: string, fromIso: string, toIso: string): Promise<string[]> {
    return Promise.resolve(
      this.speeches
        .filter(
          (s) =>
            s.provider === provider &&
            s.status === 'SCHEDULED' &&
            Date.parse(s.statement_datetime) >= Date.parse(fromIso) &&
            Date.parse(s.statement_datetime) < Date.parse(toIso),
        )
        .map((s) => s.provider_event_id),
    );
  }

  listFxPairs(): Promise<FxPairRef[]> {
    return Promise.resolve(this.fxPairs);
  }

  upsertFxPrices(rows: readonly FxPriceRow[]): Promise<number> {
    for (const row of rows) {
      const index = this.fxPrices.findIndex(
        (p) => p.fx_pair_id === row.fx_pair_id && p.timeframe === row.timeframe && p.timestamp === row.timestamp,
      );
      if (index === -1) this.fxPrices.push(row);
      else this.fxPrices[index] = row;
    }
    return Promise.resolve(rows.length);
  }

  insertIngestionLog(row: IngestionLogRow): Promise<void> {
    this.logs.push(row);
    return Promise.resolve();
  }
}

/** Reads a JSON / text fixture from tests/fixtures/ingestion. */
export async function fixture(name: string): Promise<string> {
  const { readFile } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  return readFile(fileURLToPath(new URL(`../fixtures/ingestion/${name}`, import.meta.url)), 'utf8');
}

export async function jsonFixture(name: string): Promise<unknown> {
  const text = await fixture(name);
  return JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text) as unknown;
}

/** A fetch stub that serves `body` for every request and records the URLs. */
export function stubFetch(
  responses: (url: string, init?: RequestInit) => { status?: number; body: string; headers?: Record<string, string> },
): { fetch: typeof fetch; calls: { url: string; init?: RequestInit }[] } {
  const calls: { url: string; init?: RequestInit }[] = [];
  const impl = (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    calls.push(init === undefined ? { url } : { url, init });
    const response = responses(url, init);
    return Promise.resolve(
      new Response(response.body, { status: response.status ?? 200, headers: response.headers ?? {} }),
    );
  };
  return { fetch: impl, calls };
}

/** No-op sleep so retry/backoff/rate-limit tests run instantly. */
export const noSleep = (): Promise<void> => Promise.resolve();
