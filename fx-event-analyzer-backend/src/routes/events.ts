import type { FastifyInstance } from 'fastify';
import { ApiError } from '../errors/ApiError.js';
import { requireEntitlement, FEATURE_CODES } from '../authorization/entitlements.js';
import {
  countRevisions,
  getEventById,
  getLatestExplanation,
  getReleaseSnapshot,
  listRevisions,
} from '../repositories/eventsRepository.js';
import { listRelatedFxPairs } from '../repositories/indicatorsRepository.js';
import {
  getFxPairById,
  getReaction,
  listChartPrices,
  listReactionsForPair,
  listReactionsForTimeframe,
} from '../repositories/reactionsRepository.js';
import {
  availableTimeframes,
  resolveTimeframeAnalysisStatus,
  type ReleaseDatetimePrecision,
} from '../domain/dataQuality.js';
import { resolveRevisionStatus } from '../domain/revisionStatus.js';
import { buildMeta, parsePagination, rangeFor } from '../utils/pagination.js';

const RELATED_FX_PAIR_SUMMARY_TIMEFRAME = '5m';
const VALID_TIMEFRAMES = ['1m', '5m', '15m', '30m', '60m'] as const;
type ValidTimeframe = (typeof VALID_TIMEFRAMES)[number];

function isValidTimeframe(value: unknown): value is ValidTimeframe {
  return typeof value === 'string' && (VALID_TIMEFRAMES as readonly string[]).includes(value);
}

export function registerEventRoutes(app: FastifyInstance): void {
  app.get<{ Params: { event_id: string } }>('/events/:event_id', async (request) => {
    const userId = request.user!.id;
    await requireEntitlement(app.supabase, userId, FEATURE_CODES.VIEW_BASIC_EVENT);

    const { event_id: eventId } = request.params;
    const event = await getEventById(app.supabase, eventId);
    if (!event) {
      throw new ApiError('EVENT_NOT_FOUND', 'Event not found.');
    }

    const precision = event.release_datetime_precision as ReleaseDatetimePrecision;

    const [snapshot, explanation, revisionCount, relatedFxPairs] = await Promise.all([
      getReleaseSnapshot(app.supabase, eventId),
      getLatestExplanation(app.supabase, eventId),
      countRevisions(app.supabase, eventId),
      listRelatedFxPairs(app.supabase, event.indicator_id),
    ]);

    const reactions = await listReactionsForTimeframe(
      app.supabase,
      eventId,
      relatedFxPairs.map((pair) => pair.fx_pair_id),
      RELATED_FX_PAIR_SUMMARY_TIMEFRAME,
    );
    const reactionByFxPairId = new Map(reactions.map((reaction) => [reaction.fx_pair_id, reaction]));

    return {
      event: {
        id: event.id,
        indicator_id: event.indicator_id,
        indicator_name: event.indicator_name,
        country_code: event.country_code,
        currency_code: event.currency_code,
        release_datetime: event.release_datetime,
        release_datetime_precision: event.release_datetime_precision,
        importance: event.importance,
        status: event.status,
        data_status: event.data_status,
        revision_status: resolveRevisionStatus(revisionCount),
      },
      snapshot: snapshot ?? null,
      analysis: {
        surprise: snapshot?.surprise ?? null,
        surprise_direction: snapshot?.surprise_direction ?? null,
      },
      explanation: explanation ?? null,
      related_fx_pairs: relatedFxPairs.map((pair) => {
        const reaction = reactionByFxPairId.get(pair.fx_pair_id);
        return {
          fx_pair_id: pair.fx_pair_id,
          symbol: pair.symbol,
          priority: pair.priority,
          reaction: {
            timeframe: RELATED_FX_PAIR_SUMMARY_TIMEFRAME,
            pips: reaction?.pips ?? null,
            change_percent: reaction?.change_percent ?? null,
            analysis_status: resolveTimeframeAnalysisStatus(
              RELATED_FX_PAIR_SUMMARY_TIMEFRAME,
              precision,
              (reaction?.data_status as 'PENDING' | 'AVAILABLE' | 'UNAVAILABLE') ?? 'PENDING',
            ),
          },
        };
      }),
      available_timeframes: availableTimeframes(precision),
    };
  });

  app.get<{ Params: { event_id: string }; Querystring: { page?: string; limit?: string } }>(
    '/events/:event_id/revisions',
    async (request) => {
      // api-design.md §27.1: no Entitlement required, authenticated only.
      const { event_id: eventId } = request.params;
      const event = await getEventById(app.supabase, eventId);
      if (!event) {
        throw new ApiError('EVENT_NOT_FOUND', 'Event not found.');
      }

      const pagination = parsePagination(request.query);
      const { rows, total } = await listRevisions(app.supabase, eventId, rangeFor(pagination.page, pagination.limit));

      return {
        data: rows.map((row) => ({ event_id: eventId, ...row })),
        meta: buildMeta(pagination.page, pagination.limit, total),
      };
    },
  );

  app.get<{ Params: { event_id: string }; Querystring: { fx_pair_id?: string; timeframe?: string } }>(
    '/events/:event_id/reaction',
    async (request) => {
      const userId = request.user!.id;
      await requireEntitlement(app.supabase, userId, FEATURE_CODES.VIEW_MARKET_REACTION);

      const { event_id: eventId } = request.params;
      const { fx_pair_id: fxPairId, timeframe } = request.query;
      if (!fxPairId) {
        throw ApiError.validation('fx_pair_id is required.');
      }

      const event = await getEventById(app.supabase, eventId);
      if (!event) {
        throw new ApiError('EVENT_NOT_FOUND', 'Event not found.');
      }
      const fxPair = await getFxPairById(app.supabase, fxPairId);
      if (!fxPair) {
        throw new ApiError('FX_PAIR_NOT_FOUND', 'FX pair not found.');
      }

      const precision = event.release_datetime_precision as ReleaseDatetimePrecision;

      if (timeframe === 'all' || !timeframe) {
        const reactions = await listReactionsForPair(app.supabase, eventId, fxPairId);
        const byTimeframe = new Map(reactions.map((reaction) => [reaction.timeframe, reaction]));
        const preReleasePrice = reactions[0]?.pre_release_price ?? null;

        return {
          event_id: eventId,
          fx_pair_id: fxPairId,
          pre_release_price: preReleasePrice,
          reactions: VALID_TIMEFRAMES.map((tf) => {
            const reaction = byTimeframe.get(tf);
            return {
              timeframe: tf,
              post_release_price: reaction?.post_release_price ?? null,
              movement: reaction?.movement ?? null,
              pips: reaction?.pips ?? null,
              change_percent: reaction?.change_percent ?? null,
              max_upward: reaction?.max_upward ?? null,
              max_downward: reaction?.max_downward ?? null,
              max_upward_pips: reaction?.max_upward_pips ?? null,
              max_downward_pips: reaction?.max_downward_pips ?? null,
              analysis_status: resolveTimeframeAnalysisStatus(
                tf,
                precision,
                (reaction?.data_status as 'PENDING' | 'AVAILABLE' | 'UNAVAILABLE') ?? 'PENDING',
              ),
            };
          }),
        };
      }

      if (!isValidTimeframe(timeframe)) {
        throw ApiError.validation('timeframe must be one of 1m, 5m, 15m, 30m, 60m, all.');
      }

      const reaction = await getReaction(app.supabase, eventId, fxPairId, timeframe);
      return {
        event_id: eventId,
        fx_pair_id: fxPairId,
        timeframe,
        pre_release_price: reaction?.pre_release_price ?? null,
        post_release_price: reaction?.post_release_price ?? null,
        movement: reaction?.movement ?? null,
        pips: reaction?.pips ?? null,
        change_percent: reaction?.change_percent ?? null,
        max_upward: reaction?.max_upward ?? null,
        max_downward: reaction?.max_downward ?? null,
        max_upward_pips: reaction?.max_upward_pips ?? null,
        max_downward_pips: reaction?.max_downward_pips ?? null,
        analysis_status: resolveTimeframeAnalysisStatus(
          timeframe,
          precision,
          (reaction?.data_status as 'PENDING' | 'AVAILABLE' | 'UNAVAILABLE') ?? 'PENDING',
        ),
      };
    },
  );

  app.get<{ Params: { event_id: string }; Querystring: { fx_pair_id?: string; timeframe?: string } }>(
    '/events/:event_id/reaction/chart',
    async (request) => {
      const userId = request.user!.id;
      await requireEntitlement(app.supabase, userId, FEATURE_CODES.VIEW_MARKET_REACTION);

      const { event_id: eventId } = request.params;
      const { fx_pair_id: fxPairId, timeframe } = request.query;
      if (!fxPairId || !isValidTimeframe(timeframe)) {
        throw ApiError.validation('fx_pair_id and a valid timeframe are required.');
      }

      const event = await getEventById(app.supabase, eventId);
      if (!event) {
        throw new ApiError('EVENT_NOT_FOUND', 'Event not found.');
      }

      // MVP Chart Window: release -30min to +60min (api-design.md §19).
      const releaseTime = new Date(event.release_datetime);
      const from = new Date(releaseTime.getTime() - 30 * 60_000).toISOString();
      const to = new Date(releaseTime.getTime() + 60 * 60_000).toISOString();

      const prices = await listChartPrices(app.supabase, fxPairId, timeframe, from, to);

      return {
        event_id: eventId,
        fx_pair_id: fxPairId,
        timeframe,
        release_datetime: event.release_datetime,
        prices,
      };
    },
  );
}
