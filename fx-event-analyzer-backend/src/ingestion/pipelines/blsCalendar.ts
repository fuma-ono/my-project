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
 */

/** `notYetAvailable` entries whose scheduled date is this many days or more in the past with still no BLS value — probably means BLS rescheduled and the static table is stale, not a normal wait. */
export const OVERDUE_AFTER_DAYS = 45;
import type { OfficialStatsProvider } from '../providers.js';
import { findMappingByCode, type IndicatorMapping } from '../mappings/indicators.js';
import { BLS_SCHEDULE, type BlsScheduleEntry } from '../mappings/blsSchedule.js';
import { providerIndicatorKey } from '../mappings/indicators.js';
import { localDate, monthStart, shiftMonth, zonedWallTimeToUtc } from '../time.js';
import type { NormalizedCalendarRelease, OfficialObservation } from '../types.js';
import type { JobCounters } from '../runner.js';
import type { IngestionStore } from '../store.js';
import { computeOfficialValue, type OfficialValueResolver } from '../verification/official.js';
import { displayUnit } from '../values.js';

export const BLS_SCHEDULE_PROVIDER = 'bls_schedule';

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

/**
 * Resolves a mapping's `secondary` official series (HQ指示 2026-10-25) the
 * same way createBlsNativeResolver() resolves the primary one — fetched
 * ONCE per series and cached across periods. A separate resolver instance
 * (rather than extending createBlsNativeResolver/OfficialValueResolver) to
 * avoid touching the shared resolver interface other pipelines/tests
 * depend on; the extra fetch this causes is at most one per distinct
 * secondary series per run (CUUR0000SA0 for US_CPI today), well under the
 * BLS v1 API's unauthenticated 25 requests/day limit.
 */
export function createBlsSecondaryResolver(
  bls: OfficialStatsProvider,
  range: { start: string; end: string },
  onError: (error: unknown) => void = () => undefined,
): OfficialValueResolver {
  const cache = new Map<string, Promise<OfficialObservation[]>>();
  return {
    async resolve(mapping, period, asOfDate) {
      const ref = mapping.secondary?.official;
      if (!ref || ref.source !== 'BLS') return null;
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
  /**
   * Schedule entries in the future, or whose BLS value is not published yet
   * (never guessed). A future entry here also gets a SCHEDULED row in
   * `releases` (actual/forecast null) — this list is for the
   * overdue/unmapped bookkeeping below, not "nothing was written".
   */
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
  /**
   * Entries marked `cancelled` (BLS officially cancelled the release). Never built into a
   * release here — otherwise ingestCalendarReleases would write the row back to SCHEDULED.
   * reconcileBlsScheduleRows marks their un-released rows CANCELLED (HQ指示 2026-10-26).
   */
  cancelled: BlsScheduleEntry[];
}

/**
 * Turns BLS_SCHEDULE into NormalizedCalendarRelease rows ready for
 * ingestCalendarReleases('bls_schedule', …). Two kinds of rows:
 * - Already published (releaseAt is in the past and BLS has the value):
 *   `actual` is the real published number — never fabricated. `official`
 *   is used for BOTH `actual` and the resolver the caller passes to
 *   ingestCalendarReleases, so they always agree (see file header).
 * - Not yet published (releaseAt is in the future, or BLS hasn't posted
 *   the value yet): `actual`/`forecast` are always null (HQ指示
 *   2026-10-24「無料の公式カレンダー経路」— BLSの公開スケジュール自体は
 *   事前に分かっている事実なので、SCHEDULEDの行だけ先に作る。予想値は
 *   作らない)。`previous`は直前期間の既に発表済みの実績値。
 */
export async function buildBlsScheduleReleases(deps: {
  official: OfficialValueResolver;
  /** HQ指示(2026-10-25)。createBlsSecondaryResolver() の実装を渡す。省略時は副指標を一切計算しない(既存の挙動のまま)。 */
  officialSecondary?: OfficialValueResolver;
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
      cancelled.push(entry);
      continue;
    }
    const mapping = findMappingByCode(entry.indicatorCode, deps.mappings);
    const ref = mapping?.providers.bls_schedule;
    if (!mapping || !ref) {
      unmapped.push(entry);
      continue;
    }
    const [year, month, day] = entry.releaseDate.split('-').map(Number) as [number, number, number];
    const [hour, minute] = mapping.release.localTimes[0]!.split(':').map(Number) as [number, number];
    const releaseAt = zonedWallTimeToUtc(year, month, day, hour, minute, mapping.release.timeZone);
    if (!releaseAt || releaseAt.getTime() > now.getTime()) {
      notYetAvailable.push(entry);
      // HQ指示(2026-10-24「無料の公式カレンダー経路を調査・実装する」):
      // BLSは自分の発表スケジュールを事前に公開している(blsSchedule.ts
      // 冒頭のコメント参照、2026-10-17取得・利用条件確認済み・無料・キー
      // 不要)。未来の分も、日付だけはすでに分かっている事実であり、予想
      // 値を作るわけではない(actual/forecastは常にnull。previousは
      // 直前の期間の既に発表済みの実績値で、こちらも推測ではない)。
      // ingestCalendarReleases()はactual===nullの行をSCHEDULEDとして
      // そのまま書き込む設計(economicCalendar.ts upsertSchedule)なので、
      // 既存の仕組みを変えずにそのまま使う。
      if (releaseAt) {
        const scheduledAsOf = localDate(now, mapping.release.timeZone);
        const previousPeriod = shiftMonth(entry.referencePeriod, -1);
        const previous = await deps.official.resolve(mapping, previousPeriod, scheduledAsOf);
        const unit = displayUnit(mapping.unit);
        const secondaryPrevious = mapping.secondary
          ? await deps.officialSecondary?.resolve(mapping, previousPeriod, scheduledAsOf)
          : null;
        releases.push({
          provider: BLS_SCHEDULE_PROVIDER,
          providerEventId: `${BLS_SCHEDULE_PROVIDER}:${entry.indicatorCode}:${entry.referencePeriod}`,
          providerIndicatorKey: providerIndicatorKey(ref.country, ref.event),
          eventName: mapping.description,
          releaseAt: releaseAt.toISOString(),
          releaseAtPrecision: 'EXACT',
          referencePeriod: entry.referencePeriod,
          actual: null,
          forecast: null,
          previous: previous ? { value: previous.value, unit } : null,
          revisedPrevious: previous ? { value: previous.value, unit } : null,
          fetchedAt: now.toISOString(),
          secondaryActual: null,
          secondaryPrevious: secondaryPrevious ? secondaryPrevious.value : null,
        });
      }
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
    // HQ指示(2026-10-25)。副指標(例: 米国CPIのMoM%)はmapping.secondaryが
    // 設定された指標だけ、同じ公式系列を別の変換(createBlsSecondaryResolver)
    // で解決する — 新しい外部データ源は増やさない。
    const secondaryActual = mapping.secondary
      ? await deps.officialSecondary?.resolve(mapping, entry.referencePeriod, asOfDate)
      : null;
    const secondaryPrevious = mapping.secondary
      ? await deps.officialSecondary?.resolve(mapping, previousPeriod, asOfDate)
      : null;

    releases.push({
      provider: BLS_SCHEDULE_PROVIDER,
      providerEventId: `${BLS_SCHEDULE_PROVIDER}:${entry.indicatorCode}:${entry.referencePeriod}`,
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
      secondaryActual: secondaryActual ? secondaryActual.value : null,
      secondaryPrevious: secondaryPrevious ? secondaryPrevious.value : null,
    });
  }
  return { releases, notYetAvailable, overdue, unmapped, cancelled };
}

/** The economic_events id of a schedule entry — the same one buildBlsScheduleReleases uses. */
export function blsScheduleEventId(entry: Pick<BlsScheduleEntry, 'indicatorCode' | 'referencePeriod'>): string {
  return `${BLS_SCHEDULE_PROVIDER}:${entry.indicatorCode}:${entry.referencePeriod}`;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * What ingestCalendarReleases is about to do with each built release (HQ指示 2026-10-26
 * 「取り込み結果の内訳をログに記録する」「--dry-run」). Reads only (findEventByProviderId).
 * - scheduled_insert: future entry, no row yet → a new SCHEDULED row
 * - scheduled_reschedule: future entry whose SCHEDULED row has another release time
 *   (the DB trigger records RESCHEDULED)
 * - scheduled_unchanged: future entry already matching its SCHEDULED row
 * - released_insert / released_update: published value for a missing / SCHEDULED row
 * - released_unchanged: the row is already RELEASED (this job never re-writes it)
 * - row_cancelled: the row is CANCELLED but the entry is not (a human must check; noted)
 */
export interface BlsSchedulePlan {
  scheduled_insert: number;
  scheduled_reschedule: number;
  scheduled_unchanged: number;
  released_insert: number;
  released_update: number;
  released_unchanged: number;
  row_cancelled: number;
}

export async function planBlsScheduleWrites(
  store: Pick<IngestionStore, 'findEventByProviderId'>,
  releases: readonly NormalizedCalendarRelease[],
  counters: JobCounters,
): Promise<BlsSchedulePlan> {
  const plan: BlsSchedulePlan = {
    scheduled_insert: 0,
    scheduled_reschedule: 0,
    scheduled_unchanged: 0,
    released_insert: 0,
    released_update: 0,
    released_unchanged: 0,
    row_cancelled: 0,
  };
  for (const release of releases) {
    try {
      const existing = await store.findEventByProviderId(BLS_SCHEDULE_PROVIDER, release.providerEventId);
      const published = release.actual !== null;
      if (existing?.status === 'CANCELLED') {
        plan.row_cancelled += 1;
        counters.note('schedule_entry_conflict', {
          provider_event_id: release.providerEventId,
          entry: published ? 'RELEASED' : 'SCHEDULED',
          row: 'CANCELLED',
        });
      } else if (existing?.status === 'RELEASED') {
        plan.released_unchanged += 1;
      } else if (published) {
        plan[existing ? 'released_update' : 'released_insert'] += 1;
      } else if (!existing) {
        plan.scheduled_insert += 1;
      } else if (Date.parse(existing.release_datetime) === Date.parse(release.releaseAt)) {
        plan.scheduled_unchanged += 1;
      } else {
        plan.scheduled_reschedule += 1;
        counters.note('schedule_rescheduled', {
          provider_event_id: release.providerEventId,
          from: existing.release_datetime,
          to: release.releaseAt,
        });
      }
    } catch (error) {
      counters.error(`plan ${release.providerEventId}: ${errorText(error)}`);
    }
  }
  return plan;
}

/** counters.details keys written by reconcileBlsScheduleRows (ingestion_logs.details). */
export interface BlsScheduleReconcileCounts {
  /** SCHEDULED rows set CANCELLED (or CANCELLED rows inserted) because the entry is `cancelled`. */
  cancelled_applied: number;
  /** `cancelled` entries whose row was already CANCELLED. */
  cancelled_unchanged: number;
  /** `cancelled` entries whose row is RELEASED — never changed, noted as schedule_entry_conflict. */
  cancelled_conflicts: number;
  /** Un-released bls_schedule rows whose id is no longer in the table (noted, never changed). */
  rows_not_in_table: number;
}

/**
 * Applies the parts of the schedule table that ingestCalendarReleases cannot (HQ指示 2026-10-26
 * 「発表予定の取りやめ」「予定表から消えた未発表イベント」), after it has run:
 * - `cancelled` entry: SCHEDULED row → CANCELLED + data_status UNAVAILABLE (the DB trigger records
 *   CANCELLED); no row → inserted CANCELLED so the calendar still shows it (an INSERT fires no
 *   trigger); CANCELLED row → nothing; **RELEASED row → never changed**, noted
 *   (`schedule_entry_conflict`: BLS published it after all — the table is wrong).
 * - An un-released (SCHEDULED / CANCELLED) bls_schedule row whose id is not in the table is noted
 *   (`schedule_rows_not_in_table`) for a human to compare with BLS's page — never auto-cancelled
 *   (a removed line may be a typo fix).
 * Each entry has its own try/catch (counters.error); the caller runs this AFTER the
 * published-value path, in its own try/catch, so a failure here never stops past releases.
 * dryRun: no insertEvent / updateEvent; the writes it would do go to details.dry_run_writes.
 */
export async function reconcileBlsScheduleRows(
  deps: {
    store: IngestionStore;
    entries?: readonly BlsScheduleEntry[];
    mappings?: readonly IndicatorMapping[];
    dryRun?: boolean;
  },
  counters: JobCounters,
): Promise<BlsScheduleReconcileCounts> {
  const entries = deps.entries ?? BLS_SCHEDULE;
  const { store } = deps;
  const dryRun = deps.dryRun ?? false;
  const counts: BlsScheduleReconcileCounts = {
    cancelled_applied: 0,
    cancelled_unchanged: 0,
    cancelled_conflicts: 0,
    rows_not_in_table: 0,
  };
  const write = async (action: string, target: Record<string, string>, run: () => Promise<unknown>) => {
    if (dryRun) counters.note('dry_run_writes', { action, ...target });
    else await run();
  };

  try {
    const cancelledEntries = entries.filter((entry) => entry.cancelled);
    const indicators =
      cancelledEntries.length > 0
        ? await store.findIndicatorsByCode([...new Set(cancelledEntries.map((e) => e.indicatorCode))])
        : new Map<string, never>();
    for (const entry of cancelledEntries) {
      const id = blsScheduleEventId(entry);
      try {
        const existing = await store.findEventByProviderId(BLS_SCHEDULE_PROVIDER, id);
        if (existing?.status === 'RELEASED') {
          counts.cancelled_conflicts += 1;
          counters.note('schedule_entry_conflict', { provider_event_id: id, entry: 'CANCELLED', row: 'RELEASED' });
        } else if (existing?.status === 'CANCELLED') {
          counts.cancelled_unchanged += 1;
        } else if (existing) {
          await write('cancel', { provider_event_id: id, release_datetime: existing.release_datetime }, () =>
            store.updateEvent(existing.id, { status: 'CANCELLED', data_status: 'UNAVAILABLE' }),
          );
          counts.cancelled_applied += 1;
        } else {
          const mapping = findMappingByCode(entry.indicatorCode, deps.mappings);
          const indicator = indicators.get(entry.indicatorCode);
          const releaseAt = mapping ? entryReleaseAt(entry, mapping) : null;
          if (!mapping || !indicator || !releaseAt) {
            counters.note('indicator_not_in_db', entry.indicatorCode);
            continue;
          }
          const row = {
            indicator_id: indicator.id,
            provider: BLS_SCHEDULE_PROVIDER,
            provider_event_id: id,
            release_datetime: releaseAt.toISOString(),
            release_datetime_precision: 'EXACT' as const,
            importance: indicator.importance,
            status: 'CANCELLED' as const,
            data_status: 'UNAVAILABLE' as const,
          };
          await write('insert_cancelled', { provider_event_id: id, release_datetime: row.release_datetime }, () =>
            store.insertEvent(row),
          );
          counts.cancelled_applied += 1;
        }
      } catch (error) {
        counters.error(`cancel ${id}: ${errorText(error)}`);
      }
    }

    const tableIds = new Set(entries.map(blsScheduleEventId));
    let unreleased: Awaited<ReturnType<IngestionStore['listUnreleasedEventsByProvider']>>;
    try {
      unreleased = await store.listUnreleasedEventsByProvider(BLS_SCHEDULE_PROVIDER);
    } catch (error) {
      counters.error(`schedule_rows_not_in_table check failed: ${errorText(error)}`);
      return counts;
    }
    for (const row of unreleased) {
      if (tableIds.has(row.provider_event_id)) continue;
      counts.rows_not_in_table += 1;
      counters.note('schedule_rows_not_in_table', {
        provider_event_id: row.provider_event_id,
        status: row.status,
        release_datetime: row.release_datetime,
      });
    }
    return counts;
  } finally {
    Object.assign(counters.details, counts);
  }
}

/** UTC instant of an entry's release (the mapping's local release time, DST-correct). */
function entryReleaseAt(entry: BlsScheduleEntry, mapping: IndicatorMapping): Date | null {
  const [year, month, day] = entry.releaseDate.split('-').map(Number) as [number, number, number];
  const [hour, minute] = mapping.release.localTimes[0]!.split(':').map(Number) as [number, number];
  return zonedWallTimeToUtc(year, month, day, hour, minute, mapping.release.timeZone);
}

/** Store methods a --dry-run may call (reads). Everything else (insert/update/upsert/reserve…) is refused. */
const READ_ONLY_METHOD = /^(find|get|list|latest|today|first)/;

/**
 * --dry-run 用(HQ指示 2026-10-26): 読む関数だけを通し、書き込む関数は呼ばれた時点で例外にする。
 * dryRun フラグの付け忘れがあっても DB に書かない二重の守り。
 */
export function readOnlyIngestionStore(store: IngestionStore): IngestionStore {
  return new Proxy(store, {
    get(target, prop, receiver) {
      const value: unknown = Reflect.get(target, prop, receiver);
      if (typeof value !== 'function' || typeof prop !== 'string') return value;
      if (!READ_ONLY_METHOD.test(prop)) {
        return () => Promise.reject(new Error(`read-only store: ${prop} is not allowed in a dry run`));
      }
      return (value as (...args: unknown[]) => unknown).bind(target);
    },
  });
}
