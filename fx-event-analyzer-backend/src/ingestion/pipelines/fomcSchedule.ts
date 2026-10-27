/**
 * FOMC schedule → economic_events (HQ承認 2026-10-22 Task 3). Turns the
 * code-reviewed table mappings/fomcSchedule.ts into one SCHEDULED
 * economic_events row per meeting for indicator US_FOMC — the policy
 * announcement (statement) at 14:00 New York time on the meeting's second
 * day. No values are ever written (no snapshots, never RELEASED): the
 * table only knows when the FRB will announce, not what.
 *
 * - provider 'fomc_schedule', provider_event_id `fomc_schedule:<meetingEnd>`
 *   (or `<eventKey>` when the meeting has moved — same row, see the table).
 * - release_datetime = announcement converted from America/New_York with
 *   zonedWallTimeToUtc (DST-correct), precision EXACT.
 * - is_provisional = the table's `provisional` (migration 20261022000002).
 *
 * Idempotent: a re-run with the same table changes nothing. A changed
 * date/time updates the same row's release_datetime (the DB trigger
 * trg_economic_events_schedule_change then records RESCHEDULED). A
 * provisional → confirmed flip updates is_provisional ONLY — that column is
 * not in the trigger's `update of release_datetime, status`, so it is never
 * recorded as a schedule change. `cancelled` → status CANCELLED (the
 * trigger records CANCELLED).
 *
 * Never touched: meetings whose announcement is already past (not created;
 * an existing past row is left as it is), RELEASED rows, and rows whose
 * entry was removed from the table (only listed in the log, never deleted
 * or cancelled — a removal is far more likely an editing mistake than a
 * cancellation, which has its own explicit field).
 */
import { FOMC_MINUTES_SCHEDULE, FOMC_SCHEDULE, type FomcScheduleEntry } from '../mappings/fomcSchedule.js';
import type { JobCounters } from '../runner.js';
import type { EventPatch, IngestionStore, ProviderEventRow } from '../store.js';
import { zonedWallTimeToUtc } from '../time.js';

export const FOMC_SCHEDULE_PROVIDER = 'fomc_schedule';
export const FOMC_INDICATOR_CODE = 'US_FOMC';
/** FOMC 議事要旨(HQ指示 2026-10-27): 会合とは別の指標・別の provider。 */
export const FOMC_MINUTES_PROVIDER = 'fomc_minutes_schedule';
export const FOMC_MINUTES_INDICATOR_CODE = 'US_FOMC_MINUTES';

/** Which indicator / provider a table is applied to. Default: the policy announcements. */
export interface FomcScheduleTarget {
  provider: string;
  indicatorCode: string;
}
export const FOMC_ANNOUNCEMENT_TARGET: FomcScheduleTarget = {
  provider: FOMC_SCHEDULE_PROVIDER,
  indicatorCode: FOMC_INDICATOR_CODE,
};
export const FOMC_MINUTES_TARGET: FomcScheduleTarget = {
  provider: FOMC_MINUTES_PROVIDER,
  indicatorCode: FOMC_MINUTES_INDICATOR_CODE,
};

export function fomcProviderEventId(entry: FomcScheduleEntry): string {
  return `${FOMC_SCHEDULE_PROVIDER}:${entry.eventKey ?? entry.meetingEnd}`;
}

/** `fomc_minutes_schedule:<meetingEnd>` — keyed by the meeting, so a moved release date updates the same row. */
export function fomcMinutesProviderEventId(entry: FomcScheduleEntry): string {
  return `${FOMC_MINUTES_PROVIDER}:${entry.eventKey ?? entry.meetingEnd}`;
}

/** The announcement instant (UTC), or null when the wall time is malformed / does not exist. */
export function fomcAnnouncementUtc(entry: FomcScheduleEntry): Date | null {
  const date = /^(\d{4})-(\d{2})-(\d{2})$/.exec(entry.announcement.date);
  const time = /^(\d{2}):(\d{2})$/.exec(entry.announcement.time);
  if (!date || !time) return null;
  const [year, month, day] = [Number(date[1]), Number(date[2]), Number(date[3])];
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;
  return zonedWallTimeToUtc(year, month, day, Number(time[1]), Number(time[2]), entry.announcement.timeZone);
}

export interface FomcScheduleResult {
  inserted: number;
  updated: number;
  unchanged: number;
  cancelled: number;
  /** Entries written or kept with is_provisional = true. */
  provisional: number;
  /** Entries whose announcement is already past (nothing created or changed). */
  past: number;
  /** provider_event_ids in the DB (future, not cancelled) that the table no longer has — logged only. */
  removed: string[];
}

/**
 * Applies `entries` (default: FOMC_SCHEDULE) to economic_events. Counts go
 * to `counters` (fetched = entries, success = rows inserted/updated/
 * unchanged/cancelled, details = the FomcScheduleResult numbers).
 */
export async function ingestFomcSchedule(
  deps: {
    store: IngestionStore;
    entries?: readonly FomcScheduleEntry[];
    now?: () => Date;
    /** Default FOMC_ANNOUNCEMENT_TARGET (US_FOMC). FOMC_MINUTES_TARGET for the minutes table. */
    target?: FomcScheduleTarget;
  },
  counters: JobCounters,
): Promise<FomcScheduleResult> {
  const target = deps.target ?? FOMC_ANNOUNCEMENT_TARGET;
  const entries = deps.entries ?? (target === FOMC_MINUTES_TARGET ? FOMC_MINUTES_SCHEDULE : FOMC_SCHEDULE);
  const providerEventIdOf = (entry: FomcScheduleEntry) => `${target.provider}:${entry.eventKey ?? entry.meetingEnd}`;
  const now = (deps.now?.() ?? new Date()).getTime();
  const result: FomcScheduleResult = {
    inserted: 0,
    updated: 0,
    unchanged: 0,
    cancelled: 0,
    provisional: 0,
    past: 0,
    removed: [],
  };
  const writeDetails = () => {
    counters.details.inserted = result.inserted;
    counters.details.updated = result.updated;
    counters.details.unchanged = result.unchanged;
    counters.details.cancelled = result.cancelled;
    counters.details.provisional = result.provisional;
    counters.details.past = result.past;
    counters.details.removed = result.removed;
  };
  counters.fetched += entries.length;

  const indicator = (await deps.store.findIndicatorsByCode([target.indicatorCode])).get(target.indicatorCode);
  if (!indicator) {
    counters.error(`economic_indicators has no ${target.indicatorCode} row`);
    writeDetails();
    return result;
  }

  const existing = new Map<string, ProviderEventRow>();
  for (const row of await deps.store.listEventsByProvider(target.provider)) {
    existing.set(row.provider_event_id, row);
  }

  const seen = new Set<string>();
  for (const entry of entries) {
    const providerEventId = providerEventIdOf(entry);
    if (seen.has(providerEventId)) {
      counters.error(`duplicate FOMC entry ${providerEventId}`);
      continue;
    }
    seen.add(providerEventId);
    const releaseAt = fomcAnnouncementUtc(entry);
    if (!releaseAt) {
      counters.error(`invalid FOMC announcement ${entry.announcement.date} ${entry.announcement.time}`);
      continue;
    }
    const row = existing.get(providerEventId);

    if (releaseAt.getTime() <= now || (row && Date.parse(row.release_datetime) <= now)) {
      result.past += 1;
      counters.skip('past_meeting');
      continue;
    }
    if (row?.status === 'RELEASED') {
      counters.skip('already_released');
      continue;
    }

    try {
      if (entry.cancelled) {
        if (!row) {
          // Nothing to cancel — a cancelled meeting is never created.
          counters.skip('cancelled_not_created');
          counters.note('cancelled_not_created', providerEventId);
        } else if (row.status === 'CANCELLED') {
          result.unchanged += 1;
          counters.success += 1;
        } else {
          await deps.store.updateEvent(row.id, { status: 'CANCELLED' });
          result.cancelled += 1;
          counters.success += 1;
          counters.note('cancelled_notes', { provider_event_id: providerEventId, note: entry.cancelled.note });
        }
        continue;
      }

      if (!row) {
        await deps.store.insertEvent({
          indicator_id: indicator.id,
          provider: target.provider,
          provider_event_id: providerEventId,
          release_datetime: releaseAt.toISOString(),
          release_datetime_precision: 'EXACT',
          importance: indicator.importance,
          status: 'SCHEDULED',
          data_status: 'PENDING',
          is_provisional: entry.provisional,
        });
        result.inserted += 1;
        counters.success += 1;
        if (entry.provisional) result.provisional += 1;
        continue;
      }

      const patch: EventPatch = {};
      if (Date.parse(row.release_datetime) !== releaseAt.getTime()) patch.release_datetime = releaseAt.toISOString();
      if (row.release_datetime_precision !== 'EXACT') patch.release_datetime_precision = 'EXACT';
      if (row.is_provisional !== entry.provisional) patch.is_provisional = entry.provisional;
      if (row.status === 'CANCELLED') {
        // The reviewed table says the meeting is on again.
        patch.status = 'SCHEDULED';
        counters.note('uncancelled', providerEventId);
      }
      if (Object.keys(patch).length === 0) {
        result.unchanged += 1;
      } else {
        await deps.store.updateEvent(row.id, patch);
        result.updated += 1;
        if (patch.release_datetime) {
          counters.note('rescheduled', {
            provider_event_id: providerEventId,
            from: row.release_datetime,
            to: patch.release_datetime,
          });
        }
      }
      counters.success += 1;
      if (entry.provisional) result.provisional += 1;
    } catch (error) {
      counters.error(`${providerEventId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  for (const [providerEventId, row] of existing) {
    if (seen.has(providerEventId)) continue;
    if (row.status !== 'SCHEDULED' || Date.parse(row.release_datetime) <= now) continue;
    result.removed.push(providerEventId);
  }
  result.removed.sort();
  writeDetails();
  return result;
}
