/**
 * Independent calendar path (HQ判断 2026-10-17): builds economic_events
 * directly from BLS's own release schedule (mappings/blsSchedule.ts) and
 * BLS's own observations — no paid calendar involved. The releases this
 * produces are fed through the SAME ingestCalendarReleases() the paid
 * calendars use (economicCalendar.ts is not changed at all): scheduling,
 * staging, revisions and the data-quality report all work unchanged.
 *
 * Unlike the paid-calendar path, there is only one source here (BLS), so
 * "official match" is not a second opinion — createBlsNativeResolver()
 * resolves the SAME BLS series used to build `actual`, which is why these
 * releases become VERIFIED by construction rather than by independent
 * corroboration. That is a real limitation, not a shortcut: this path
 * only ever tells you what BLS itself published, honestly labelled by
 * mapping.agency (BLS). It never asserts a forecast — BLS has none — and
 * it never touches indicators without a BLS official series.
 *
 * createLiveOfficialResolver (officialStats.ts) is deliberately NOT reused
 * here: it refuses values more than CURRENT_VINTAGE_MAX_AGE_DAYS old for a
 * non-point-in-time source (BLS), a safeguard that matters when BLS is
 * being used as a second opinion on a paid provider's claim about the
 * past. That concern does not apply to a release BLS's own schedule says
 * is BLS's own number, at any age — backfilling older months must not be
 * silently limited to the last 20 days.
 *
 * HQ確認(2026-10-17)への回答:
 * - 「一致」は独立検証ではない: actual と official (event_snapshots.verification_status
 *   を決める側) は同じ createBlsNativeResolver インスタンス・同じBLS系列から来るため、
 *   数学的に同じ値になる(トートロジー)。VERIFIED は「BLS自身の値と自己一致した」
 *   ことだけを意味し、2つ目の独立した取得元による裏付けではない。既存の
 *   economicCalendar.ts は provider(有料カレンダー)×BLS(公式)という2者の一致を
 *   VERIFIED としているため、同じ値がこの経路にも付くのは紛らわしい — 区別する
 *   新しいステータスを足すにはスキーマ変更が要るため、ここでは実装せず報告する
 *   (data-sources.md §14 参照)。
 * - releaseAtPrecision: 'EXACT' は「公開時刻が実際に確認された」ことではなく、
 *   既存のTradingEconomicsアダプタ等と同じ意味(発表時刻が具体的に分かっている
 *   = 予定時刻が分かっている)で使っている。BLSの発表時刻を独立した手段で
 *   事後確認する仕組みは無い(米国統計機関が時刻を厳格に守ってきた実績に基づく
 *   前提)。blsSchedule.ts の日付は BLS が予定を変更(例: 2025年10月の政府閉鎖)
 *   した場合に追随する仕組みが無い静的な表なので、スケジュールされた日付を
 *   過去に残したまま値が長期間発表されないエントリは `overdue` として分けて
 *   報告する(下記 BlsScheduleReleaseResult.overdue)。見つかったら人が
 *   blsSchedule.ts の日付を確認・修正する。
 *
 * 将来の予定(HQ承認 Task 2): syncBlsScheduledEvents() が、表にある未来の
 * エントリを発表前から SCHEDULED 行として登録する(値は無し)。発表後は上の
 * 経路が同じ provider_event_id の行を RELEASED に更新するので行は1つのまま。
 * 表の日付を人が直すと同じ行の release_datetime が更新され、DBトリガーが
 * RESCHEDULED を記録する。`cancelled` エントリは CANCELLED、表から消えた行は
 * 自動では何もせず `schedule_rows_not_in_table` として記録する。
 */

/** `notYetAvailable` entries whose scheduled date is this many days or more in the past with still no BLS value — probably means BLS rescheduled and the static table is stale, not a normal wait. */
export const OVERDUE_AFTER_DAYS = 45;
import type { OfficialStatsProvider } from '../providers.js';
import type { JobCounters } from '../runner.js';
import type { IngestionStore } from '../store.js';
import { findMappingByCode, type IndicatorMapping } from '../mappings/indicators.js';
import { BLS_SCHEDULE, type BlsScheduleEntry } from '../mappings/blsSchedule.js';
import { providerIndicatorKey } from '../mappings/indicators.js';
import { localDate, monthStart, shiftMonth, zonedWallTimeToUtc } from '../time.js';
import type { NormalizedCalendarRelease, OfficialObservation } from '../types.js';
import { computeOfficialValue, type OfficialValueResolver } from '../verification/official.js';
import { displayUnit } from '../values.js';

export const BLS_SCHEDULE_PROVIDER = 'bls_schedule';

/** economic_events.provider_event_id of a schedule entry — the SAME id before (SCHEDULED) and after (RELEASED) release. */
export function blsScheduleEventId(entry: Pick<BlsScheduleEntry, 'indicatorCode' | 'referencePeriod'>): string {
  return `${BLS_SCHEDULE_PROVIDER}:${entry.indicatorCode}:${entry.referencePeriod}`;
}

/** UTC instant of the entry's release: releaseDate at the mapping's local release time (08:30 America/New_York), DST-correct. */
function entryReleaseAt(entry: BlsScheduleEntry, mapping: IndicatorMapping): Date | null {
  const [year, month, day] = entry.releaseDate.split('-').map(Number) as [number, number, number];
  const [hour, minute] = mapping.release.localTimes[0]!.split(':').map(Number) as [number, number];
  return zonedWallTimeToUtc(year, month, day, hour, minute, mapping.release.timeZone);
}

/**
 * [start, end] ('YYYY-MM-DD') covering every period buildBlsScheduleReleases
 * will ever ask about for `entries` — 12 months before the earliest
 * referencePeriod (the farthest YOY_PCT needs to look back) through the
 * latest one. Used to fetch each BLS series ONCE (see createBlsNativeResolver)
 * instead of once per period: BLS's unauthenticated v1 API allows only 25
 * requests/day, and this schedule alone has dozens of periods.
 */
export function scheduleObservationRange(entries: readonly BlsScheduleEntry[]): { start: string; end: string } {
  const periods = entries.map((e) => e.referencePeriod);
  const min = periods.reduce((a, b) => (a < b ? a : b));
  const max = periods.reduce((a, b) => (a > b ? a : b));
  return { start: monthStart(shiftMonth(min, -12)), end: monthStart(max) };
}

/**
 * Resolves a mapping's BLS official series directly, at any age — see the
 * file header for why this must not share officialStats.ts's staleness
 * guard. Fetches each series ONCE for the whole `range` and serves every
 * period/asOfDate from that cached set (never once per period — see
 * scheduleObservationRange). onError reports (never throws) a fetch
 * failure for one series so the rest of the schedule still gets processed.
 */
export function createBlsNativeResolver(
  bls: OfficialStatsProvider,
  range: { start: string; end: string },
  onError: (error: unknown) => void = () => undefined,
): OfficialValueResolver {
  const cache = new Map<string, Promise<OfficialObservation[]>>();
  return {
    async resolve(mapping, period, asOfDate) {
      const ref = mapping.official.find((r) => r.source === 'BLS');
      if (!ref) return null;
      let pending = cache.get(ref.seriesId);
      if (!pending) {
        pending = bls
          .fetchObservations({
            seriesId: ref.seriesId,
            observationStart: range.start,
            observationEnd: range.end,
            asOfDate,
          })
          .catch((error: unknown) => {
            onError(error);
            return [];
          });
        cache.set(ref.seriesId, pending);
      }
      const observations = await pending;
      const value = computeOfficialValue(observations, period, ref.transform);
      if (value === null) return null;
      const asOf = observations.find((o) => o.periodStart === `${period}-01`)?.asOfDate ?? asOfDate;
      return { value, sourceRef: `${ref.source}:${ref.seriesId}@${asOf}` };
    },
  };
}

export interface BlsScheduleReleaseResult {
  releases: NormalizedCalendarRelease[];
  /** Schedule entries in the future, or whose BLS value is not published yet (never guessed). */
  notYetAvailable: BlsScheduleEntry[];
  /**
   * Subset of notYetAvailable whose scheduled date is OVERDUE_AFTER_DAYS or
   * more in the past with still no BLS value — a normal wait looks like
   * this too in the days right after the scheduled date, but this long
   * past it, it more likely means BLS rescheduled and blsSchedule.ts's
   * static date for this entry is stale (see file header). Needs a human
   * to check BLS's current schedule and correct the table if so.
   */
  overdue: BlsScheduleEntry[];
  /** Schedule entries for an indicator with no economic_indicators row / no bls_schedule mapping key. */
  unmapped: BlsScheduleEntry[];
  /** Entries marked `cancelled` — never built into a release (syncBlsScheduledEvents marks their rows CANCELLED). */
  cancelled: BlsScheduleEntry[];
}

/**
 * Turns BLS_SCHEDULE into NormalizedCalendarRelease rows ready for
 * ingestCalendarReleases('bls_schedule', …). A release is only produced
 * once BLS has actually published that period's value (never fabricated
 * from the schedule alone) — `official` is used for BOTH `actual` and the
 * resolver the caller passes to ingestCalendarReleases, so they always
 * agree (see file header).
 */
export async function buildBlsScheduleReleases(deps: {
  official: OfficialValueResolver;
  entries?: readonly BlsScheduleEntry[];
  mappings?: readonly IndicatorMapping[];
  now?: () => Date;
}): Promise<BlsScheduleReleaseResult> {
  const entries = deps.entries ?? BLS_SCHEDULE;
  const now = deps.now?.() ?? new Date();
  const releases: NormalizedCalendarRelease[] = [];
  const notYetAvailable: BlsScheduleEntry[] = [];
  const overdue: BlsScheduleEntry[] = [];
  const unmapped: BlsScheduleEntry[] = [];
  const cancelled: BlsScheduleEntry[] = [];

  for (const entry of entries) {
    if (entry.cancelled) {
      // Never published, so never a release — and never `overdue`.
      cancelled.push(entry);
      continue;
    }
    const mapping = findMappingByCode(entry.indicatorCode, deps.mappings);
    const ref = mapping?.providers.bls_schedule;
    if (!mapping || !ref) {
      unmapped.push(entry);
      continue;
    }
    const releaseAt = entryReleaseAt(entry, mapping);
    if (!releaseAt || releaseAt.getTime() > now.getTime()) {
      notYetAvailable.push(entry);
      continue;
    }
    const asOfDate = localDate(releaseAt, mapping.release.timeZone);
    const actual = await deps.official.resolve(mapping, entry.referencePeriod, asOfDate);
    if (!actual) {
      notYetAvailable.push(entry);
      const daysPast = (now.getTime() - releaseAt.getTime()) / 86_400_000;
      if (daysPast >= OVERDUE_AFTER_DAYS) overdue.push(entry);
      continue;
    }
    const previousPeriod = shiftMonth(entry.referencePeriod, -1);
    const previous = await deps.official.resolve(mapping, previousPeriod, asOfDate);
    // The value is already in mapping.unit (it came straight from the BLS
    // series validateRelease verifies against), so the ProviderValue's own
    // unit must say so explicitly — allowMissingUnit is false for these
    // indicators (shared with the paid-calendar path, not changed here).
    const unit = displayUnit(mapping.unit);

    releases.push({
      provider: BLS_SCHEDULE_PROVIDER,
      providerEventId: blsScheduleEventId(entry),
      providerIndicatorKey: providerIndicatorKey(ref.country, ref.event),
      eventName: mapping.description,
      releaseAt: releaseAt.toISOString(),
      releaseAtPrecision: 'EXACT',
      referencePeriod: entry.referencePeriod,
      actual: { value: actual.value, unit },
      forecast: null,
      previous: previous ? { value: previous.value, unit } : null,
      revisedPrevious: previous ? { value: previous.value, unit } : null,
      fetchedAt: now.toISOString(),
    });
  }
  return { releases, notYetAvailable, overdue, unmapped, cancelled };
}

/** counters.details keys written by syncBlsScheduledEvents (numbers; ingestion_logs.details). */
export interface BlsScheduleSyncCounts {
  /** New SCHEDULED rows for future entries. */
  scheduled_inserted: number;
  /** SCHEDULED rows whose release_datetime changed because blsSchedule.ts's date changed (DB trigger → RESCHEDULED). */
  scheduled_updated: number;
  /** SCHEDULED rows already matching the table (no write). */
  scheduled_unchanged: number;
  /** Rows newly set / inserted CANCELLED by a `cancelled` entry in this run. */
  cancelled: number;
  /** `cancelled` entries whose row was already CANCELLED (no write). */
  cancelled_unchanged: number;
}

/**
 * Registers BLS's FUTURE releases as SCHEDULED economic_events rows so the
 * calendar can show upcoming CPI/NFP before they happen — from the
 * code-reviewed table alone (no BLS API call, no key). Writes only
 * economic_events (never snapshots / values / event_schedule_changes —
 * the latter is the DB trigger's job, migration 20261015000002).
 *
 * - Future entry (release instant > now), no row → insert SCHEDULED,
 *   EXACT, data_status PENDING (API: DATA_PENDING = "not released yet").
 *   The id is blsScheduleEventId(), the same one buildBlsScheduleReleases
 *   uses, so after the release ingestCalendarReleases updates THIS row to
 *   RELEASED (no second row).
 * - Future entry, SCHEDULED row at a different instant → update
 *   release_datetime (trigger records RESCHEDULED). Same instant → no write.
 * - Future entry whose row is RELEASED or CANCELLED → left alone, noted
 *   (`schedule_entry_conflict`) for a human: un-cancelling / un-releasing
 *   is never automatic.
 * - `cancelled` entry (any date): SCHEDULED row → CANCELLED + data_status
 *   UNAVAILABLE (trigger records CANCELLED); no row → inserted CANCELLED so
 *   the calendar still shows it (an INSERT fires no trigger: nobody was
 *   ever told about a schedule that was never in the DB, so there is no
 *   change to notify); RELEASED row → left alone, noted (BLS published it
 *   after all — the table is wrong).
 * - Past, not-cancelled entries are not touched here: they stay on the
 *   existing RELEASED path (buildBlsScheduleReleases → ingestCalendarReleases)
 *   and its overdue detection, unchanged.
 * - An un-released bls_schedule row whose id is no longer in the table is
 *   never auto-cancelled: it is noted (`schedule_rows_not_in_table`) for a
 *   human to compare with BLS's official page.
 *
 * Existing counters (fetched / success / skipped / review) are NOT
 * touched; a per-entry failure goes to counters.error.
 */
export async function syncBlsScheduledEvents(
  deps: {
    store: IngestionStore;
    entries?: readonly BlsScheduleEntry[];
    mappings?: readonly IndicatorMapping[];
    now?: () => Date;
  },
  counters: JobCounters,
): Promise<BlsScheduleSyncCounts> {
  const entries = deps.entries ?? BLS_SCHEDULE;
  const now = deps.now?.() ?? new Date();
  const { store } = deps;
  const counts: BlsScheduleSyncCounts = {
    scheduled_inserted: 0,
    scheduled_updated: 0,
    scheduled_unchanged: 0,
    cancelled: 0,
    cancelled_unchanged: 0,
  };
  const indicators = await store.findIndicatorsByCode([...new Set(entries.map((e) => e.indicatorCode))]);

  for (const entry of entries) {
    const id = blsScheduleEventId(entry);
    const mapping = findMappingByCode(entry.indicatorCode, deps.mappings);
    // Unmapped entries are already reported by buildBlsScheduleReleases (`unmapped`).
    if (!mapping?.providers.bls_schedule) continue;
    const releaseAt = entryReleaseAt(entry, mapping);
    if (!releaseAt) {
      counters.error(`${id}: release time does not exist in ${mapping.release.timeZone}`);
      continue;
    }
    if (!entry.cancelled && releaseAt.getTime() <= now.getTime()) continue;
    const indicator = indicators.get(entry.indicatorCode);
    if (!indicator) {
      counters.note('indicator_not_in_db', entry.indicatorCode);
      continue;
    }
    const releaseIso = releaseAt.toISOString();
    const newRow = {
      indicator_id: indicator.id,
      provider: BLS_SCHEDULE_PROVIDER,
      provider_event_id: id,
      release_datetime: releaseIso,
      release_datetime_precision: 'EXACT' as const,
      importance: indicator.importance,
    };
    try {
      const existing = await store.findEventByProviderId(BLS_SCHEDULE_PROVIDER, id);
      if (entry.cancelled) {
        if (!existing) {
          await store.insertEvent({ ...newRow, status: 'CANCELLED', data_status: 'UNAVAILABLE' });
          counts.cancelled += 1;
        } else if (existing.status === 'SCHEDULED') {
          await store.updateEvent(existing.id, { status: 'CANCELLED', data_status: 'UNAVAILABLE' });
          counts.cancelled += 1;
        } else if (existing.status === 'CANCELLED') {
          counts.cancelled_unchanged += 1;
        } else {
          counters.note('schedule_entry_conflict', { provider_event_id: id, entry: 'CANCELLED', row: existing.status });
        }
      } else if (!existing) {
        await store.insertEvent({ ...newRow, status: 'SCHEDULED', data_status: 'PENDING' });
        counts.scheduled_inserted += 1;
      } else if (existing.status !== 'SCHEDULED') {
        counters.note('schedule_entry_conflict', { provider_event_id: id, entry: 'SCHEDULED', row: existing.status });
      } else if (Date.parse(existing.release_datetime) === releaseAt.getTime()) {
        counts.scheduled_unchanged += 1;
      } else {
        const from = existing.release_datetime;
        await store.updateEvent(existing.id, { release_datetime: releaseIso, release_datetime_precision: 'EXACT' });
        counts.scheduled_updated += 1;
        counters.note('schedule_rescheduled', { provider_event_id: id, from, to: releaseIso });
      }
    } catch (error) {
      counters.error(`${id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const tableIds = new Set(entries.map(blsScheduleEventId));
  for (const row of await store.listUnreleasedEventsByProvider(BLS_SCHEDULE_PROVIDER)) {
    if (tableIds.has(row.provider_event_id)) continue;
    counters.note('schedule_rows_not_in_table', {
      provider_event_id: row.provider_event_id,
      status: row.status,
      release_datetime: row.release_datetime,
    });
  }

  Object.assign(counters.details, counts);
  return counts;
}
