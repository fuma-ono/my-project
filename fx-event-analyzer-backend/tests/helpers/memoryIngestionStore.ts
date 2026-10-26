import type {
  ApiCreditReservation,
  EventForReactionRef,
  EventPriceReactionRow,
  FxIngestionLogSample,
  FxPairRef,
  FxPriceRow,
  IndicatorRef,
  IngestionLogRow,
  IngestionStore,
  NewReleaseSnapshot,
  NewRevision,
  NewStagedValue,
  OfficialObservationRow,
  ProviderEventRow,
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
  /** currency_code is optional: only tests exercising event_price_reactions need to set it
   * (it mirrors economic_indicators.currency_code, joined in the real Supabase query). */
  events: (StoredEvent & {
    provider: string;
    provider_event_id: string;
    importance: string;
    currency_code?: string;
    /** economic_events.is_provisional — absent = the DB default (false). */
    is_provisional?: boolean;
  })[] = [];
  eventPriceReactions: EventPriceReactionRow[] = [];
  snapshots: NewReleaseSnapshot[] = [];
  revisions: (NewRevision & { created_at: string })[] = [];
  staged: (NewStagedValue & { id: string; resolved_at?: string | null })[] = [];
  observations: OfficialObservationRow[] = [];
  speakers: SpeakerRef[] = [];
  speeches: SpeechEventRow[] = [];
  fxPairs: FxPairRef[] = [];
  fxPrices: FxPriceRow[] = [];
  logs: IngestionLogRow[] = [];
  /** api_credit_usage rows (usage_date = UTC date of `clock()` at reservation time). */
  creditUsage: (ApiCreditReservation & { usage_date: string; cap: number })[] = [];
  /** api_credit_limits rows (same defaults as migration 20261016000003). */
  creditLimits: Record<string, { daily_total_cap: number; automatic_cap: number }> = {
    twelvedata: { daily_total_cap: 800, automatic_cap: 700 },
  };
  /** Clock of the credit ledger (the DB uses now()). */
  clock: () => Date = () => new Date();
  private seq = 0;
  private fxIndex = new Map<string, number>();
  private fxIndexed: FxPriceRow[] | null = null;

  private nextId(prefix: string): string {
    this.seq += 1;
    return `${prefix}-${this.seq}`;
  }

  findIndicatorsByCode(codes: readonly string[]): Promise<Map<string, IndicatorRef>> {
    return Promise.resolve(new Map(this.indicators.filter((i) => codes.includes(i.code)).map((i) => [i.code, i])));
  }

  listEventsByProvider(provider: string): Promise<ProviderEventRow[]> {
    return Promise.resolve(
      this.events
        .filter((e) => e.provider === provider && e.provider_event_id)
        .map((e) => ({ ...e, is_provisional: e.is_provisional ?? false })),
    );
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

  private fxKey(row: Pick<FxPriceRow, 'fx_pair_id' | 'timeframe' | 'timestamp'>): string {
    return `${row.fx_pair_id}|${row.timeframe}|${Date.parse(row.timestamp)}`;
  }

  /** Index on the upsert key; rebuilt when a test replaced or pushed into fxPrices directly. */
  private fxPriceIndex(): Map<string, number> {
    if (this.fxIndexed !== this.fxPrices || this.fxIndex.size !== this.fxPrices.length) {
      this.fxIndex = new Map(this.fxPrices.map((row, i) => [this.fxKey(row), i]));
      this.fxIndexed = this.fxPrices;
    }
    return this.fxIndex;
  }

  upsertFxPrices(rows: readonly FxPriceRow[]): Promise<number> {
    const index = this.fxPriceIndex();
    for (const row of rows) {
      const key = this.fxKey(row);
      const at = index.get(key);
      if (at === undefined) {
        index.set(key, this.fxPrices.length);
        this.fxPrices.push(row);
      } else {
        this.fxPrices[at] = row;
      }
    }
    return Promise.resolve(rows.length);
  }

  private minuteRows(fxPairId: string, fromIso: string, toIso: string): FxPriceRow[] {
    const from = Date.parse(fromIso);
    const to = Date.parse(toIso);
    return this.fxPrices
      .filter((p) => p.fx_pair_id === fxPairId && p.timeframe === '1m')
      .filter((p) => Date.parse(p.timestamp) >= from && Date.parse(p.timestamp) < to)
      .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  }

  listFxMinuteTimestamps(fxPairId: string, fromIso: string, toIso: string): Promise<string[]> {
    return Promise.resolve(this.minuteRows(fxPairId, fromIso, toIso).map((p) => new Date(p.timestamp).toISOString()));
  }

  firstFxMinute(fxPairId: string): Promise<string | null> {
    let first: number | null = null;
    for (const p of this.fxPrices) {
      if (p.fx_pair_id !== fxPairId || p.timeframe !== '1m') continue;
      const ms = Date.parse(p.timestamp);
      if (first === null || ms < first) first = ms;
    }
    return Promise.resolve(first === null ? null : new Date(first).toISOString());
  }

  listFxMinuteRows(fxPairId: string, fromIso: string, toIso: string): Promise<FxPriceRow[]> {
    return Promise.resolve(this.minuteRows(fxPairId, fromIso, toIso).map((p) => ({ ...p })));
  }

  listRecentFxIngestionLogs(sinceIso: string): Promise<FxIngestionLogSample[]> {
    const since = Date.parse(sinceIso);
    return Promise.resolve(
      this.logs
        .filter((log) => log.job === 'ingest:fx-prices' && Date.parse(log.started_at) >= since)
        .map((log) => ({
          started_at: log.started_at,
          details: { no_data_unconfirmed: log.details.no_data_unconfirmed },
        })),
    );
  }

  private creditsToday(provider: string): number {
    const today = this.clock().toISOString().slice(0, 10);
    return this.creditUsage
      .filter((u) => u.provider === provider && u.usage_date === today)
      .reduce((sum, u) => sum + u.credits, 0);
  }

  /** Same semantics as reserve_api_credits(): limits from creditLimits, total of ALL modes, check + insert with no await in between (atomic in JS). */
  reserveApiCredits(reservation: ApiCreditReservation): Promise<boolean> {
    if (reservation.credits <= 0) return Promise.reject(new Error('p_credits must be positive'));
    if (reservation.mode !== 'AUTOMATIC' && reservation.mode !== 'MANUAL') {
      return Promise.reject(new Error('p_mode must be AUTOMATIC or MANUAL'));
    }
    const limits = this.creditLimits[reservation.provider];
    if (!limits) return Promise.reject(new Error(`no credit limit configured for provider ${reservation.provider}`));
    const cap =
      reservation.mode === 'AUTOMATIC'
        ? Math.min(limits.automatic_cap, limits.daily_total_cap)
        : limits.daily_total_cap;
    if (this.creditsToday(reservation.provider) + reservation.credits > cap) return Promise.resolve(false);
    this.creditUsage.push({ ...reservation, cap, usage_date: this.clock().toISOString().slice(0, 10) });
    return Promise.resolve(true);
  }

  todayApiCredits(provider: string): Promise<number> {
    return Promise.resolve(this.creditsToday(provider));
  }

  insertIngestionLog(row: IngestionLogRow): Promise<void> {
    this.logs.push(row);
    return Promise.resolve();
  }

  listReleasedEventsForReactions(sinceIso: string): Promise<EventForReactionRef[]> {
    const since = Date.parse(sinceIso);
    return Promise.resolve(
      this.events
        .filter((e) => e.status === 'RELEASED' && Date.parse(e.release_datetime) >= since)
        .sort((a, b) => Date.parse(a.release_datetime) - Date.parse(b.release_datetime))
        .map((e) => ({
          id: e.id,
          release_datetime: e.release_datetime,
          release_datetime_precision: e.release_datetime_precision,
          currency_code: e.currency_code ?? '',
        })),
    );
  }

  private eventReactionKey(row: Pick<EventPriceReactionRow, 'event_id' | 'fx_pair_id' | 'timeframe'>): string {
    return `${row.event_id}|${row.fx_pair_id}|${row.timeframe}`;
  }

  upsertEventPriceReactions(rows: readonly EventPriceReactionRow[]): Promise<number> {
    for (const row of rows) {
      const key = this.eventReactionKey(row);
      const index = this.eventPriceReactions.findIndex((r) => this.eventReactionKey(r) === key);
      if (index === -1) this.eventPriceReactions.push(row);
      else this.eventPriceReactions[index] = row;
    }
    return Promise.resolve(rows.length);
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
