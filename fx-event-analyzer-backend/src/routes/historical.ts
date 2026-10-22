import type { FastifyInstance } from 'fastify';
import { ApiError } from '../errors/ApiError.js';
import { FEATURE_CODES, listActiveFeatureCodes, requireEntitlement } from '../authorization/entitlements.js';
import { requireUnlockedEvent } from '../authorization/pastReleaseAccess.js';
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

/** 各発表に、表の列の時間足ごとのpips(無ければ null)を付ける。 */
function withPipsByTimeframe<T extends { event_id: string }>(
  events: T[],
  reactionRows: { event_id: string; timeframe: string; pips: number | null }[],
): (T & { pips_by_timeframe: Record<string, number | null> })[] {
  return events.map((event) => {
    const pips: Record<string, number | null> = {};
    for (const timeframe of TABLE_TIMEFRAMES) {
      const row = reactionRows.find((r) => r.event_id === event.event_id && r.timeframe === timeframe);
      pips[timeframe] = row?.pips ?? null;
    }
    return { ...event, pips_by_timeframe: pips };
  });
}

export function registerHistoricalRoutes(app: FastifyInstance): void {
  // GET /events/{event_id}/history — api-design.md §20.
  app.get<{ Params: { event_id: string } }>('/events/:event_id/history', async (request) => {
    const userId = request.user!.id;
    await requireEntitlement(app.supabase, userId, FEATURE_CODES.VIEW_HISTORICAL);

    const { event_id: eventId } = request.params;
    const event = await getEventById(app.supabase, eventId);
    if (!event) {
      throw new ApiError('EVENT_NOT_FOUND', 'Event not found.');
    }
    // HQ判断 2026-10-22: 親の発表がロックされていれば 403 PLAN_LIMIT_EXCEEDED。
    await requireUnlockedEvent(app.supabase, userId, event);

    const [snapshot, explanation, relatedFxPairs] = await Promise.all([
      getReleaseSnapshot(app.supabase, eventId),
      getLatestExplanation(app.supabase, eventId),
      listRelatedFxPairs(app.supabase, event.indicator_id),
    ]);

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
      },
      snapshot: snapshot ?? null,
      explanation: explanation ?? null,
      related_fx_pairs: reactionsByPair,
    };
  });

  // GET /indicators/{indicator_id}/comparison — api-design.md §21. Only the
  // plan's history_events_max most recent releases are used — for stats and
  // for the paginated `events` alike (§28.1); `history_limit` reports the cap.
  app.get<{ Params: { indicator_id: string } }>('/indicators/:indicator_id/comparison', async (request) => {
    const userId = request.user!.id;
    await requireEntitlement(app.supabase, userId, FEATURE_CODES.VIEW_HISTORICAL);

    const { indicator_id: indicatorId } = request.params;
    const indicator = await getIndicatorById(app.supabase, indicatorId);
    if (!indicator) {
      throw new ApiError('INDICATOR_NOT_FOUND', 'Indicator not found.');
    }

    const query = comparisonQuerySchema.parse(request.query);
    const pagination = parsePagination(query);
    const features = await listActiveFeatureCodes(app.supabase, userId);
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

    const timeframes = query.timeframe === 'all' ? [...ALL_TIMEFRAMES] : [query.timeframe];
    // 統計は選んだ時間足だけ。表の1分・5分・15分のために、その3つも一緒に読む。
    const fetchTimeframes = [...new Set<string>([...timeframes, ...TABLE_TIMEFRAMES])];
    const fetchedRows = await listAvailableReactionsForComparison(
      app.supabase,
      allEventIds,
      query.fx_pair_id,
      fetchTimeframes,
    );
    const reactionRows = fetchedRows.filter((row) => (timeframes as string[]).includes(row.timeframe));
    const analyzableEventIds = new Set(reactionRows.map((row) => row.event_id));
    const eventsWithPips = withPipsByTimeframe(events, fetchedRows);

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
        total_events: allEventIds.length,
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
      total_events: allEventIds.length,
      analyzable_events: analyzableEventIds.size,
      stats_by_timeframe: statsByTimeframe,
      events: eventsWithPips,
      meta: buildMeta(pagination.page, pagination.limit, total),
      history_limit: historyLimit,
    };
  });
}
