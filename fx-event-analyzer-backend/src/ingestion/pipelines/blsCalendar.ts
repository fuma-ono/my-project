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

  for (const entry of entries) {
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
    });
  }
  return { releases, notYetAvailable, overdue, unmapped };
}
