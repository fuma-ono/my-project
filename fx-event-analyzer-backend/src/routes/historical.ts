import type { FastifyInstance } from 'fastify';
import { ApiError } from '../errors/ApiError.js';
import { assertEntitlement, FEATURE_CODES, listActiveFeatureCodes } from '../authorization/entitlements.js';
import { requireUnlockedEventForPlan, resolvePastReleaseAccessForPlan } from '../authorization/pastReleaseAccess.js';
import {
  accessFields,
  nullFields,
  pastReleaseLimitFor,
  pastReleasesMaxFor,
  PREVIOUS_VALUE_FIELDS,
  redactRelease,
} from '../domain/pastReleaseAccess.js';
import { requireEntitlementAndResolvePlan } from '../authorization/plan.js';
import { getEventById, getLatestExplanation, getReleaseSnapshot } from '../repositories/eventsRepository.js';
import { getIndicatorById, listRelatedFxPairs } from '../repositories/indicatorsRepository.js';
import {
  listAvailableReactionsForComparison,
  listRecentReleasedEventIds,
  listReleasedEventsForIndicator,
} from '../repositories/historicalRepository.js';
import { listReactionsForPair } from '../repositories/reactionsRepository.js';
import { computeAdvancedHistoricalStats, computeHistoricalStats } from '../domain/historicalStatistics.js';
import { gateAdvancedStatistics } from '../domain/advancedStatistics.js';
import { resolveTimeframeAnalysisStatus, type ReleaseDatetimePrecision } from '../domain/dataQuality.js';
import { capRowRange, historyLimitFor, planFromFeatures, planLimitsFor } from '../domain/planLimits.js';
import { comparisonQuerySchema } from '../schemas/historical.js';
import { buildMeta, parsePagination, rangeFor } from '../utils/pagination.js';

const ALL_TIMEFRAMES = ['1m', '5m', '15m', '30m', '60m'] as const;
/** 過去イベント比較の表の列(HQ指示 2026-10-14、api-design v1.26)。各発表の1分・5分・15分のpips。 */
const TABLE_TIMEFRAMES = ['1m', '5m', '15m'] as const;

/**
 * 各発表に、表の列の時間足ごとのpips(無ければ null)を付ける。無料プランで
 * ロックされた発表(HQ指示 2026-10-22、api-design.md 21章)は、一覧(13.3節)と
 * 同じく forecast/actual/previous/surprise/surprise_direction を null にし、
 * pips もすべて null(キーは残す)にして `locked: true`・`required_plan: "PRO"` を付ける。
 */
function toComparisonRows<T extends { event_id: string }>(
  events: T[],
  reactionRows: { event_id: string; timeframe: string; pips: number | null }[],
  lockedIds: ReadonlySet<string>,
  previousLockedIds: ReadonlySet<string>,
) {
  return events.map((event) => {
    const locked = lockedIds.has(event.event_id);
    const pips: Record<string, number | null> = {};
    for (const timeframe of TABLE_TIMEFRAMES) {
      const row = locked
        ? undefined
        : reactionRows.find((r) => r.event_id === event.event_id && r.timeframe === timeframe);
      pips[timeframe] = row?.pips ?? null;
    }
    return { ...redactRelease(event, locked, previousLockedIds.has(event.event_id)), pips_by_timeframe: pips };
  });
}

export function registerHistoricalRoutes(app: FastifyInstance): void {
  // GET /events/{event_id}/history — api-design.md §20.
  app.get<{ Params: { event_id: string } }>('/events/:event_id/history', async (request) => {
    const userId = request.user!.id;
    const plan = await requireEntitlementAndResolvePlan(app.supabase, userId, FEATURE_CODES.VIEW_HISTORICAL);

    const { event_id: eventId } = request.params;
    const event = await getEventById(app.supabase, eventId);
    if (!event) {
      throw new ApiError('EVENT_NOT_FOUND', 'Event not found.');
    }
    // HQ判断 2026-10-22: 親の発表がロックされていれば 403 PLAN_LIMIT_EXCEEDED。
    // ひとつ前の発表がロックされていれば、「前回」と解説を隠す(GET /events/{id} と同じ)。
    const { previousLocked } = await requireUnlockedEventForPlan(app.supabase, plan, event);

    const [rawSnapshot, explanation, relatedFxPairs] = await Promise.all([
      getReleaseSnapshot(app.supabase, eventId),
      previousLocked ? Promise.resolve(null) : getLatestExplanation(app.supabase, eventId),
      listRelatedFxPairs(app.supabase, event.indicator_id),
    ]);

    const snapshot = rawSnapshot && previousLocked ? nullFields(rawSnapshot, PREVIOUS_VALUE_FIELDS) : rawSnapshot;
    const precision = event.release_datetime_precision as ReleaseDatetimePrecision;

    const reactionsByPair = await Promise.all(
      relatedFxPairs.map(async (pair) => {
        const reactions = await listReactionsForPair(app.supabase, eventId, pair.fx_pair_id);
        return {
          fx_pair_id: pair.fx_pair_id,
          symbol: pair.symbol,
          // api-design.md §7.1: never leak the raw DB data_status value —
          // always the API-contract analysis_status (READY/DATA_PENDING/
          // DATA_UNAVAILABLE/NOT_ANALYZABLE).
          reactions: reactions.map(({ data_status: dataStatus, ...rest }) => ({
            ...rest,
            analysis_status: resolveTimeframeAnalysisStatus(
              rest.timeframe as '1m' | '5m' | '15m' | '30m' | '60m',
              precision,
              dataStatus as 'PENDING' | 'AVAILABLE' | 'UNAVAILABLE',
            ),
          })),
        };
      }),
    );

    return {
      indicator_id: event.indicator_id,
      event: {
        id: event.id,
        indicator_name: event.indicator_name,
        display_name: event.indicator_display_name,
        release_datetime: event.release_datetime,
        importance: event.importance,
        ...accessFields(false, previousLocked),
      },
      snapshot: snapshot ?? null,
      explanation: explanation ?? null,
      related_fx_pairs: reactionsByPair,
    };
  });

  // GET /indicators/{indicator_id}/comparison — api-design.md §21. Only the
  // plan's history_events_max most recent releases are listed — for stats and
  // for the paginated `events` alike (§28.1); `history_limit` reports the cap.
  // FREE (HQ指示 2026-10-22): rows locked by the past-release limit (§28.2,
  // same visible_released_event_ids rule as the list/detail) are listed with
  // their values hidden, and every statistic / count is computed from the
  // unlocked rows only, so locked values cannot be derived from aggregates.
  app.get<{ Params: { indicator_id: string } }>('/indicators/:indicator_id/comparison', async (request) => {
    const userId = request.user!.id;
    // 機能の確認・高度な統計・プランを1回の読み込みで(このリクエストではもう読まない)。
    const features = await listActiveFeatureCodes(app.supabase, userId);
    assertEntitlement(features, FEATURE_CODES.VIEW_HISTORICAL);

    const { indicator_id: indicatorId } = request.params;
    const indicator = await getIndicatorById(app.supabase, indicatorId);
    if (!indicator) {
      throw new ApiError('INDICATOR_NOT_FOUND', 'Indicator not found.');
    }

    const query = comparisonQuerySchema.parse(request.query);
    const pagination = parsePagination(query);
    const hasAdvanced = features.includes(FEATURE_CODES.VIEW_ADVANCED_STATS);
    const plan = planFromFeatures(features);
    const historyMax = planLimitsFor(plan).history_events_max;

    const allEventIds = await listRecentReleasedEventIds(app.supabase, indicatorId, historyMax);
    const pageRange = capRowRange(rangeFor(pagination.page, pagination.limit), historyMax);
    const { rows: events, total: releasedTotal } = pageRange
      ? await listReleasedEventsForIndicator(app.supabase, indicatorId, pageRange)
      : { rows: [], total: allEventIds.length };
    const total = Math.min(releasedTotal, historyMax);
    const historyLimit = historyLimitFor(plan, allEventIds.length);
    const { lockedIds, previousLockedIds } = await resolvePastReleaseAccessForPlan(
      app.supabase,
      plan,
      allEventIds.map((id) => ({ id, indicator_id: indicatorId, status: 'RELEASED' })),
    );
    // 統計・件数に使う発表(ロックされた発表の値は読まない)。
    const statsEventIds = allEventIds.filter((id) => !lockedIds.has(id));
    // FREE: 統計に使う発表以外はすべてロック(2つの読み込みの間に新しい発表が
    // 入って一覧の行がずれても、値を見せる行は statsEventIds の中だけ)。
    const unlockedIds = new Set(statsEventIds);
    const rowLockedIds =
      pastReleasesMaxFor(plan) === null
        ? new Set<string>()
        : new Set(events.map((event) => event.event_id).filter((id) => !unlockedIds.has(id)));

    const timeframes = query.timeframe === 'all' ? [...ALL_TIMEFRAMES] : [query.timeframe];
    // 統計は選んだ時間足だけ。表の1分・5分・15分のために、その3つも一緒に読む。
    const fetchTimeframes = [...new Set<string>([...timeframes, ...TABLE_TIMEFRAMES])];
    const fetchedRows = await listAvailableReactionsForComparison(
      app.supabase,
      statsEventIds,
      query.fx_pair_id,
      fetchTimeframes,
    );
    const reactionRows = fetchedRows.filter((row) => (timeframes as string[]).includes(row.timeframe));
    const analyzableEventIds = new Set(reactionRows.map((row) => row.event_id));
    const eventsWithPips = toComparisonRows(events, fetchedRows, rowLockedIds, previousLockedIds);

    if (query.timeframe !== 'all') {
      const rowsForStats = reactionRows.map((row) => ({ movement: row.movement ?? 0, pips: row.pips ?? 0 }));
      const stats = computeHistoricalStats(rowsForStats);
      const advanced = computeAdvancedHistoricalStats(rowsForStats);

      return {
        indicator: {
          id: indicator.id,
          code: indicator.code,
          name: indicator.name,
          display_name: indicator.display_name,
          country_code: indicator.country_code,
          currency_code: indicator.currency_code,
          unit: indicator.unit,
        },
        fx_pair_id: query.fx_pair_id,
        timeframe: query.timeframe,
        total_events: statsEventIds.length,
        analyzable_events: analyzableEventIds.size,
        stats: stats ?? {
          average_movement: null,
          average_pips: null,
          max_movement: null,
          min_movement: null,
          upward_count: 0,
          downward_count: 0,
          no_change_count: 0,
        },
        advanced_statistics: gateAdvancedStatistics(hasAdvanced, advanced),
        events: eventsWithPips,
        meta: buildMeta(pagination.page, pagination.limit, total),
        history_limit: historyLimit,
        past_release_limit: pastReleaseLimitFor(plan),
      };
    }

    const statsByTimeframe = ALL_TIMEFRAMES.map((timeframe) => {
      const rowsForTimeframe = reactionRows
        .filter((row) => row.timeframe === timeframe)
        .map((row) => ({ movement: row.movement ?? 0, pips: row.pips ?? 0 }));
      return {
        timeframe,
        stats: computeHistoricalStats(rowsForTimeframe),
        advanced_statistics: gateAdvancedStatistics(hasAdvanced, computeAdvancedHistoricalStats(rowsForTimeframe)),
      };
    });

    return {
      indicator: {
        id: indicator.id,
        code: indicator.code,
        name: indicator.name,
        display_name: indicator.display_name,
        country_code: indicator.country_code,
        currency_code: indicator.currency_code,
        unit: indicator.unit,
      },
      fx_pair_id: query.fx_pair_id,
      total_events: statsEventIds.length,
      analyzable_events: analyzableEventIds.size,
      stats_by_timeframe: statsByTimeframe,
      events: eventsWithPips,
      meta: buildMeta(pagination.page, pagination.limit, total),
      history_limit: historyLimit,
      past_release_limit: pastReleaseLimitFor(plan),
    };
  });
}
