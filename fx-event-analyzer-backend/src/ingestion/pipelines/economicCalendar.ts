/**
 * ① Paid economic calendar → economic_events / event_snapshots /
 * event_revisions, with the accuracy safeguards of data-sources.md §6:
 *
 * - Only mapped indicators (mappings/indicators.ts) are ingested.
 * - Schedule: upsert keyed by provider + provider_event_id. A changed
 *   release time is applied only while the event is SCHEDULED and only if
 *   it is the agency's usual time (otherwise ignored and logged).
 * - Actual: validated, then compared with the official statistics (②).
 *   Only a clean, verified value becomes the RELEASE snapshot (immutable);
 *   anything else waits in ingestion_staged_values (AWAITING_OFFICIAL /
 *   PENDING_REVIEW), which the Read API never reads — the event keeps
 *   data_status = PENDING (API: DATA_PENDING).
 * - Revisions: a later different actual / revised previous never touches
 *   the RELEASE snapshot; once verified it is appended to event_revisions.
 */
import { calculateSurprise } from '../../domain/surprise.js';
import { INGESTION_SETTINGS } from '../config.js';
import {
  buildMappingIndex,
  findMappingByCode,
  INDICATOR_MAPPINGS,
  type CalendarProviderId,
  type IndicatorMapping,
} from '../mappings/indicators.js';
import type { JobCounters } from '../runner.js';
import type { IndicatorRef, IngestionStore, StagedValue, StoredEvent, StoredSnapshot } from '../store.js';
import { localDate, previousReferencePeriod } from '../time.js';
import type { NormalizedCalendarRelease, ReleaseDatetimePrecision } from '../types.js';
import {
  findDuplicateReleases,
  validateRelease,
  withReferencePeriod,
  type NormalizedValues,
  type ReleaseIssueCode,
} from '../validation/economicRelease.js';
import {
  compareWithOfficial,
  type OfficialValueResolver,
  type ResolvedOfficialValue,
} from '../verification/official.js';
import { displayUnit, roundTo } from '../values.js';

export interface CalendarPipelineDeps {
  store: IngestionStore;
  official: OfficialValueResolver;
  mappings?: readonly IndicatorMapping[];
  now?: () => Date;
}

type Issue = ReleaseIssueCode | 'UNPARSEABLE_ACTUAL' | 'REFERENCE_PERIOD_INFERRED';

const SCHEDULE_ISSUES: ReadonlySet<Issue> = new Set(['MISSING_EXACT_TIME', 'RELEASE_TIME_UNEXPECTED']);
/** Issues that concern the release instant only — irrelevant for a revision found later. */
const RELEASE_ONLY_ISSUES: ReadonlySet<Issue> = new Set([
  'MISSING_EXACT_TIME',
  'RELEASE_TIME_UNEXPECTED',
  'FUTURE_DATED_ACTUAL',
  'OUTLIER_VS_PREVIOUS',
]);

function sameInstant(a: string, b: string): boolean {
  return Date.parse(a) === Date.parse(b);
}

async function upsertSchedule(
  store: IngestionStore,
  release: NormalizedCalendarRelease,
  indicator: IndicatorRef,
  issues: readonly Issue[],
  counters: JobCounters,
): Promise<StoredEvent> {
  const scheduleIssues = issues.filter((issue) => SCHEDULE_ISSUES.has(issue));
  const existing = await store.findEventByProviderId(release.provider, release.providerEventId);
  if (!existing) {
    // A time we cannot confirm is never stored as EXACT: 1-minute reactions
    // are excluded for APPROXIMATE (dataQuality.availableTimeframes). With no
    // schedule issue the release's own precision is kept: EXACT, or APPROXIMATE
    // for an indicator whose mapping says its time is approximate (validateRelease).
    const precision: ReleaseDatetimePrecision =
      scheduleIssues.length === 0
        ? release.releaseAtPrecision
        : release.releaseAtPrecision === 'EXACT'
          ? 'APPROXIMATE'
          : release.releaseAtPrecision;
    if (scheduleIssues.length > 0) {
      counters.note('schedule_warnings', { provider_event_id: release.providerEventId, issues: scheduleIssues });
    }
    return store.insertEvent({
      indicator_id: indicator.id,
      provider: release.provider,
      provider_event_id: release.providerEventId,
      release_datetime: release.releaseAt,
      release_datetime_precision: precision,
      importance: indicator.importance,
      status: release.actual !== null ? 'RELEASED' : 'SCHEDULED',
      data_status: 'PENDING',
    });
  }

  const patch: Parameters<IngestionStore['updateEvent']>[1] = {};
  if (existing.status === 'SCHEDULED' && !sameInstant(existing.release_datetime, release.releaseAt)) {
    if (scheduleIssues.length === 0) {
      patch.release_datetime = release.releaseAt;
      patch.release_datetime_precision = release.releaseAtPrecision;
    } else {
      counters.note('schedule_change_ignored', {
        provider_event_id: release.providerEventId,
        stored: existing.release_datetime,
        provider_value: release.releaseAt,
        issues: scheduleIssues,
      });
    }
  }
  if (release.actual !== null && existing.status === 'SCHEDULED') patch.status = 'RELEASED';
  if (Object.keys(patch).length === 0) return existing;
  await store.updateEvent(existing.id, patch);
  return { ...existing, ...patch };
}

interface StageInput {
  kind: 'RELEASE' | 'REVISION';
  revisionField: 'ACTUAL' | 'PREVIOUS' | null;
  event: StoredEvent;
  mapping: IndicatorMapping;
  release: NormalizedCalendarRelease;
  period: string | null;
  values: Pick<NormalizedValues, 'forecast' | 'actual' | 'previous'>;
  oldValue: number | null;
  newValue: number | null;
  status: 'AWAITING_OFFICIAL' | 'PENDING_REVIEW';
  reasons: readonly string[];
  official: ResolvedOfficialValue | null;
}

async function stage(store: IngestionStore, input: StageInput, counters: JobCounters): Promise<void> {
  const row = {
    event_id: input.event.id,
    kind: input.kind,
    revision_field: input.revisionField,
    provider: input.release.provider,
    provider_event_id: input.release.providerEventId,
    indicator_code: input.mapping.code,
    reference_period: input.period,
    forecast: input.values.forecast,
    actual: input.values.actual,
    previous: input.values.previous,
    old_value: input.oldValue,
    new_value: input.newValue,
    unit: displayUnit(input.mapping.unit),
    source: input.mapping.agency.name,
    source_url: input.mapping.agency.url,
    release_status: input.kind === 'REVISION' ? ('REVISED' as const) : ('PRELIMINARY' as const),
    fetched_at: input.release.fetchedAt,
    official_actual: input.official ? roundTo(input.official.value, 4) : null,
    official_source: input.official?.sourceRef ?? null,
    verification_status: input.status,
    reasons: [...input.reasons],
  };
  const open = await store.findOpenStagedValue(input.event.id, input.kind, input.revisionField);
  if (!open) {
    await store.insertStagedValue(row);
  } else if (stagedDiffers(open, row)) {
    await store.updateStagedValue(open.id, row);
  }
  counters.review += 1;
  counters.note('staged', {
    provider_event_id: input.release.providerEventId,
    indicator: input.mapping.code,
    kind: input.kind,
    status: input.status,
    reasons: input.reasons,
  });
}

function stagedDiffers(open: StagedValue, row: Omit<StagedValue, 'id' | 'release_datetime'>): boolean {
  return (
    open.verification_status !== row.verification_status ||
    open.actual !== row.actual ||
    open.forecast !== row.forecast ||
    open.previous !== row.previous ||
    open.new_value !== row.new_value ||
    open.official_actual !== row.official_actual ||
    open.reasons.join(',') !== row.reasons.join(',')
  );
}

async function resolveOfficial(
  official: OfficialValueResolver,
  mapping: IndicatorMapping,
  period: string | null,
  asOfDate: string,
): Promise<ResolvedOfficialValue | null> {
  if (period === null || mapping.official.length === 0) return null;
  return official.resolve(mapping, period, asOfDate);
}

export interface PublishReleaseInput {
  eventId: string;
  indicator: IndicatorRef;
  mapping: IndicatorMapping;
  values: Pick<NormalizedValues, 'forecast' | 'previous'> & { actual: number };
  capturedAt: string;
  official: ResolvedOfficialValue | null;
  /**
   * HQ指示(2026-10-25)「過去イベント比較の表も前月と前年必要」:
   * mapping.secondaryが設定された指標(今は米国CPIのMoM%)のみ渡される。
   * 省略時(reverifyAwaitingOfficial経由など)は副指標なしで書き込む —
   * RELEASEスナップショットは不変なので、後から追加することはできない。
   */
  secondary?: { actual: number | null; previous: number | null } | undefined;
}

/** Writes the immutable RELEASE snapshot and marks the event AVAILABLE. */
export async function publishRelease(store: IngestionStore, input: PublishReleaseInput): Promise<void> {
  const surprise = calculateSurprise(input.values.forecast, input.values.actual, input.indicator.favorable_direction);
  await store.insertReleaseSnapshot({
    event_id: input.eventId,
    forecast: input.values.forecast,
    actual: input.values.actual,
    previous: input.values.previous,
    unit: displayUnit(input.mapping.unit),
    source: input.mapping.agency.name,
    source_url: input.mapping.agency.url,
    captured_at: input.capturedAt,
    surprise: surprise.surprise === null ? null : roundTo(surprise.surprise, 4),
    surprise_direction: surprise.direction,
    verification_status: input.official ? 'VERIFIED' : 'SINGLE_SOURCE',
    verification_source: input.official?.sourceRef ?? null,
    official_actual: input.official ? roundTo(input.official.value, 4) : null,
    secondary_value_kind: input.mapping.secondary ? input.mapping.secondary.valueKind : null,
    secondary_actual: input.secondary?.actual ?? null,
    secondary_forecast: null,
    secondary_previous: input.secondary?.previous ?? null,
  });
  await store.updateEvent(input.eventId, { status: 'RELEASED', data_status: 'AVAILABLE' });
}

async function resolveOpenStaged(
  store: IngestionStore,
  eventId: string,
  kind: 'RELEASE' | 'REVISION',
  field: 'ACTUAL' | 'PREVIOUS' | null,
  status: 'VERIFIED' | 'SINGLE_SOURCE',
  resolvedAt: string,
): Promise<void> {
  const open = await store.findOpenStagedValue(eventId, kind, field);
  if (open) await store.updateStagedValue(open.id, { verification_status: status, resolved_at: resolvedAt });
}

async function processActual(
  deps: Required<CalendarPipelineDeps>,
  input: {
    event: StoredEvent;
    indicator: IndicatorRef;
    mapping: IndicatorMapping;
    release: NormalizedCalendarRelease;
    values: NormalizedValues;
    issues: Issue[];
    periodInferred: boolean;
  },
  counters: JobCounters,
): Promise<void> {
  const { store } = deps;
  const { event, indicator, mapping, release, values } = input;
  const issues = [...input.issues];

  const snapshot = await store.getReleaseSnapshot(event.id);
  if (snapshot) {
    await processRevisions(deps, { ...input, snapshot }, counters);
    counters.success += 1;
    return;
  }

  const period = release.referencePeriod;
  const official = await resolveOfficial(
    deps.official,
    mapping,
    period,
    localDate(new Date(release.releaseAt), mapping.release.timeZone),
  );
  if (values.actual === null) issues.push('UNPARSEABLE_ACTUAL');
  if (values.actual !== null && official) {
    const comparison = compareWithOfficial(values.actual, official.value, mapping.decimals, mapping.officialTolerance);
    if (!comparison.match) issues.push('OFFICIAL_MISMATCH');
  }

  const stageBase = {
    kind: 'RELEASE' as const,
    revisionField: null,
    event,
    mapping,
    release,
    period,
    values,
    oldValue: null,
    newValue: null,
    official,
  };
  if (issues.length > 0 || values.actual === null) {
    await stage(store, { ...stageBase, status: 'PENDING_REVIEW', reasons: issues }, counters);
    return;
  }
  if (!official && mapping.requireOfficialMatch) {
    await stage(store, { ...stageBase, status: 'AWAITING_OFFICIAL', reasons: [] }, counters);
    return;
  }
  if (!official && input.periodInferred) {
    await stage(store, { ...stageBase, status: 'PENDING_REVIEW', reasons: ['REFERENCE_PERIOD_INFERRED'] }, counters);
    return;
  }
  await publishRelease(store, {
    eventId: event.id,
    indicator,
    mapping,
    values: { ...values, actual: values.actual },
    capturedAt: release.fetchedAt,
    official,
    secondary: mapping.secondary
      ? { actual: release.secondaryActual ?? null, previous: release.secondaryPrevious ?? null }
      : undefined,
  });
  await resolveOpenStaged(
    store,
    event.id,
    'RELEASE',
    null,
    official ? 'VERIFIED' : 'SINGLE_SOURCE',
    deps.now().toISOString(),
  );
  // A revised previous reported together with the first actual is a
  // revision of the figure just stored as `previous` (event_revisions).
  await processRevisions(
    deps,
    { ...input, snapshot: { forecast: values.forecast, actual: values.actual, previous: values.previous } },
    counters,
  );
  counters.success += 1;
}

async function processRevisions(
  deps: Required<CalendarPipelineDeps>,
  input: {
    event: StoredEvent;
    mapping: IndicatorMapping;
    release: NormalizedCalendarRelease;
    values: NormalizedValues;
    issues: Issue[];
    snapshot: StoredSnapshot;
  },
  counters: JobCounters,
): Promise<void> {
  const { store } = deps;
  const { event, mapping, release, values, snapshot } = input;
  const differs = (a: number, b: number) => roundTo(a, mapping.decimals) !== roundTo(b, mapping.decimals);

  const candidates: { field: 'ACTUAL' | 'PREVIOUS'; oldValue: number; newValue: number; period: string | null }[] = [];
  if (values.actual !== null && snapshot.actual !== null && differs(values.actual, snapshot.actual)) {
    candidates.push({
      field: 'ACTUAL',
      oldValue: snapshot.actual,
      newValue: values.actual,
      period: release.referencePeriod,
    });
  }
  if (
    values.revisedPrevious !== null &&
    snapshot.previous !== null &&
    differs(values.revisedPrevious, snapshot.previous)
  ) {
    candidates.push({
      field: 'PREVIOUS',
      oldValue: snapshot.previous,
      newValue: values.revisedPrevious,
      period: release.referencePeriod === null ? null : previousReferencePeriod(release.referencePeriod),
    });
  }
  if (candidates.length === 0) return;

  const latest = await store.latestRevisionValues(event.id);
  const today = localDate(deps.now(), mapping.release.timeZone);
  for (const candidate of candidates) {
    const recorded = latest[candidate.field];
    if (recorded !== null && !differs(recorded, candidate.newValue)) continue;
    // A second revision is relative to the last recorded one, not to the snapshot.
    const oldValue = recorded ?? candidate.oldValue;

    const issues: string[] = input.issues.filter((issue) => !RELEASE_ONLY_ISSUES.has(issue));
    const official = await resolveOfficial(deps.official, mapping, candidate.period, today);
    if (official) {
      const comparison = compareWithOfficial(
        candidate.newValue,
        official.value,
        mapping.decimals,
        mapping.officialTolerance,
      );
      if (!comparison.match) issues.push('OFFICIAL_MISMATCH');
    }
    const stageBase = {
      kind: 'REVISION' as const,
      revisionField: candidate.field,
      event,
      mapping,
      release,
      period: candidate.period,
      values: { forecast: null, actual: null, previous: null },
      oldValue,
      newValue: candidate.newValue,
      official,
    };
    if (issues.length > 0) {
      await stage(store, { ...stageBase, status: 'PENDING_REVIEW', reasons: issues }, counters);
      continue;
    }
    if (!official && mapping.requireOfficialMatch) {
      await stage(store, { ...stageBase, status: 'AWAITING_OFFICIAL', reasons: [] }, counters);
      continue;
    }
    await store.insertRevision({
      event_id: event.id,
      field_name: candidate.field,
      old_value: oldValue,
      new_value: candidate.newValue,
      effective_at: release.fetchedAt,
      source: mapping.agency.name,
    });
    await resolveOpenStaged(
      store,
      event.id,
      'REVISION',
      candidate.field,
      official ? 'VERIFIED' : 'SINGLE_SOURCE',
      deps.now().toISOString(),
    );
  }
}

/** Processes one fetch of a calendar provider. Per-release failures are counted, not thrown. */
export async function ingestCalendarReleases(
  provider: CalendarProviderId,
  releases: readonly NormalizedCalendarRelease[],
  deps: CalendarPipelineDeps,
  counters: JobCounters,
): Promise<void> {
  const full: Required<CalendarPipelineDeps> = {
    mappings: INDICATOR_MAPPINGS,
    now: () => new Date(),
    ...deps,
  };
  counters.fetched += releases.length;
  const index = buildMappingIndex(provider, full.mappings);

  // Same provider id twice in one response: keep the last occurrence.
  const byId = new Map<string, NormalizedCalendarRelease>();
  for (const release of releases) byId.set(release.providerEventId, release);
  if (byId.size < releases.length) counters.note('duplicate_provider_ids', releases.length - byId.size);

  const mapped: { release: NormalizedCalendarRelease; mapping: IndicatorMapping }[] = [];
  for (const release of byId.values()) {
    const mapping = index.get(release.providerIndicatorKey);
    if (mapping) mapped.push({ release, mapping });
    else counters.skip('UNMAPPED_INDICATOR');
  }
  const duplicates = findDuplicateReleases(
    mapped.map(({ release, mapping }) => ({ release: withReferencePeriod(release, mapping).release, mapping })),
  );
  const indicators = await full.store.findIndicatorsByCode([...new Set(mapped.map(({ mapping }) => mapping.code))]);

  for (const { release: providerRelease, mapping } of mapped) {
    const { release, inferred } = withReferencePeriod(providerRelease, mapping);
    const indicator = indicators.get(mapping.code);
    if (!indicator) {
      counters.skip('INDICATOR_NOT_IN_DB');
      counters.note('indicator_not_in_db', mapping.code);
      continue;
    }
    try {
      const validation = validateRelease(release, mapping, {
        futureActualToleranceMs: INGESTION_SETTINGS.futureActualToleranceMs,
      });
      const issues: Issue[] = [...validation.issues];
      if (duplicates.has(release.providerEventId)) issues.push('DUPLICATE_IN_BATCH');
      const event = await upsertSchedule(full.store, release, indicator, issues, counters);
      if (release.actual === null) {
        counters.success += 1;
        continue;
      }
      await processActual(
        full,
        { event, indicator, mapping, release, values: validation.values, issues, periodInferred: inferred },
        counters,
      );
    } catch (error) {
      counters.error(`${release.providerEventId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

/**
 * Re-checks values that passed validation but had no official number yet
 * (AWAITING_OFFICIAL). Run by ingest:official after fresh observations
 * are available: match → published; mismatch → PENDING_REVIEW.
 */
export async function reverifyAwaitingOfficial(deps: CalendarPipelineDeps, counters: JobCounters): Promise<void> {
  const mappings = deps.mappings ?? INDICATOR_MAPPINGS;
  const now = deps.now ?? (() => new Date());
  const { store } = deps;
  const waiting = await store.listStagedValues('AWAITING_OFFICIAL');
  counters.fetched += waiting.length;
  if (waiting.length === 0) return;
  const indicators = await store.findIndicatorsByCode([...new Set(waiting.map((item) => item.indicator_code))]);

  for (const item of waiting) {
    try {
      const mapping = findMappingByCode(item.indicator_code, mappings);
      const indicator = indicators.get(item.indicator_code);
      const value = item.kind === 'RELEASE' ? item.actual : item.new_value;
      if (!mapping || !indicator || value === null || item.reference_period === null) {
        counters.skip('NOT_REVERIFIABLE');
        continue;
      }
      const asOfDate =
        item.kind === 'RELEASE'
          ? localDate(new Date(item.release_datetime), mapping.release.timeZone)
          : localDate(now(), mapping.release.timeZone);
      const official = await deps.official.resolve(mapping, item.reference_period, asOfDate);
      if (!official) {
        counters.skip('OFFICIAL_STILL_UNAVAILABLE');
        continue;
      }
      const officialFields = { official_actual: roundTo(official.value, 4), official_source: official.sourceRef };
      const comparison = compareWithOfficial(value, official.value, mapping.decimals, mapping.officialTolerance);
      if (!comparison.match) {
        await store.updateStagedValue(item.id, {
          ...officialFields,
          verification_status: 'PENDING_REVIEW',
          reasons: [...item.reasons, 'OFFICIAL_MISMATCH'],
        });
        counters.review += 1;
        counters.note('staged', { indicator: item.indicator_code, kind: item.kind, status: 'PENDING_REVIEW' });
        continue;
      }
      if (item.kind === 'RELEASE') {
        if (await store.getReleaseSnapshot(item.event_id)) {
          await store.updateStagedValue(item.id, {
            ...officialFields,
            verification_status: 'PENDING_REVIEW',
            reasons: [...item.reasons, 'SNAPSHOT_ALREADY_EXISTS'],
          });
          counters.review += 1;
          continue;
        }
        await publishRelease(store, {
          eventId: item.event_id,
          indicator,
          mapping,
          values: { forecast: item.forecast, previous: item.previous, actual: value },
          capturedAt: item.fetched_at,
          official,
        });
      } else if (item.revision_field !== null && item.old_value !== null) {
        await store.insertRevision({
          event_id: item.event_id,
          field_name: item.revision_field,
          old_value: item.old_value,
          new_value: value,
          effective_at: item.fetched_at,
          source: mapping.agency.name,
        });
      }
      await store.updateStagedValue(item.id, {
        ...officialFields,
        verification_status: 'VERIFIED',
        resolved_at: now().toISOString(),
      });
      counters.success += 1;
    } catch (error) {
      counters.error(`staged ${item.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
