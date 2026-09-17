import type { FastifyInstance } from 'fastify';
import { ApiError } from '../errors/ApiError.js';
import { FEATURE_CODES, hasEntitlement, requireEntitlement } from '../authorization/entitlements.js';
import { getEventById, getLatestExplanation, getReleaseSnapshot } from '../repositories/eventsRepository.js';
import { getIndicatorById, listRelatedFxPairs } from '../repositories/indicatorsRepository.js';
import {
  listAllReleasedEventIds,
  listAvailableReactionsForComparison,
  listReleasedEventsForIndicator,
} from '../repositories/historicalRepository.js';
import { listReactionsForPair } from '../repositories/reactionsRepository.js';
import { computeAdvancedHistoricalStats, computeHistoricalStats } from '../domain/historicalStatistics.js';
import { gateAdvancedStatistics } from '../domain/advancedStatistics.js';
import { comparisonQuerySchema } from '../schemas/historical.js';
import { buildMeta, parsePagination, rangeFor } from '../utils/pagination.js';

const ALL_TIMEFRAMES = ['1m', '5m', '15m', '30m', '60m'] as const;

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

    const [snapshot, explanation, relatedFxPairs] = await Promise.all([
      getReleaseSnapshot(app.supabase, eventId),
      getLatestExplanation(app.supabase, eventId),
      listRelatedFxPairs(app.supabase, event.indicator_id),
    ]);

    const reactionsByPair = await Promise.all(
      relatedFxPairs.map(async (pair) => ({
        fx_pair_id: pair.fx_pair_id,
        symbol: pair.symbol,
        reactions: await listReactionsForPair(app.supabase, eventId, pair.fx_pair_id),
      })),
    );

    return {
      indicator_id: event.indicator_id,
      event: {
        id: event.id,
        indicator_name: event.indicator_name,
        release_datetime: event.release_datetime,
        importance: event.importance,
      },
      snapshot: snapshot ?? null,
      explanation: explanation ?? null,
      related_fx_pairs: reactionsByPair,
    };
  });

  // GET /indicators/{indicator_id}/comparison — api-design.md §21.
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
    const hasAdvanced = await hasEntitlement(app.supabase, userId, FEATURE_CODES.VIEW_ADVANCED_STATS);

    const { rows: events, total } = await listReleasedEventsForIndicator(
      app.supabase,
      indicatorId,
      rangeFor(pagination.page, pagination.limit),
    );
    const allEventIds = await listAllReleasedEventIds(app.supabase, indicatorId);

    const timeframes = query.timeframe === 'all' ? [...ALL_TIMEFRAMES] : [query.timeframe];
    const reactionRows = await listAvailableReactionsForComparison(
      app.supabase,
      allEventIds,
      query.fx_pair_id,
      timeframes,
    );
    const analyzableEventIds = new Set(reactionRows.map((row) => row.event_id));

    if (query.timeframe !== 'all') {
      const rowsForStats = reactionRows.map((row) => ({ movement: row.movement ?? 0, pips: row.pips ?? 0 }));
      const stats = computeHistoricalStats(rowsForStats);
      const advanced = computeAdvancedHistoricalStats(rowsForStats);

      return {
        indicator: { id: indicator.id, code: indicator.code, name: indicator.name },
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
        events,
        meta: buildMeta(pagination.page, pagination.limit, total),
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
      indicator: { id: indicator.id, code: indicator.code, name: indicator.name },
      fx_pair_id: query.fx_pair_id,
      total_events: allEventIds.length,
      analyzable_events: analyzableEventIds.size,
      stats_by_timeframe: statsByTimeframe,
      events,
      meta: buildMeta(pagination.page, pagination.limit, total),
    };
  });
}
