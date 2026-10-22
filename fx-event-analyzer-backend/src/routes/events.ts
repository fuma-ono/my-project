import type { FastifyInstance } from 'fastify';
import { chartWindow } from '../domain/chartWindow.js';
import { ApiError } from '../errors/ApiError.js';
import { FEATURE_CODES } from '../authorization/entitlements.js';
import { requireEntitlementAndResolvePlan } from '../authorization/plan.js';
import {
  countRevisions,
  getEventById,
  getLatestExplanation,
  getReleaseSnapshot,
  listRevisions,
  type EventRow,
} from '../repositories/eventsRepository.js';
import {
  requireUnlockedEvent,
  requireUnlockedEventForPlan,
  resolvePastReleaseAccessForPlan,
} from '../authorization/pastReleaseAccess.js';
import {
  LOCKED,
  LOCKED_ANALYSIS_STATUS,
  LOCKED_REVISION_STATUS,
  nullFields,
  RELEASE_VALUE_FIELDS,
  UNLOCKED,
} from '../domain/pastReleaseAccess.js';
import { listRelatedFxPairs } from '../repositories/indicatorsRepository.js';
import { listActiveFxPairs } from '../repositories/fxPairsRepository.js';
import {
  getFxPairById,
  getReaction,
  listChartPrices,
  listReactionsForPair,
  listReactionsForPairsAndTimeframes,
  listReactionsForTimeframe,
} from '../repositories/reactionsRepository.js';
import { buildMajorFxReactions, MAJOR_FX_REACTION_TIMEFRAMES, selectMajorFxPairs } from '../domain/majorFxReactions.js';
import {
  availableTimeframes,
  mapEventDataStatus,
  resolveTimeframeAnalysisStatus,
  type EconomicEventDbStatus,
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

/**
 * GET /events/{id} for an event locked by the past-release limit (HQ判断
 * 2026-10-22): same shape as the unlocked response, but every field that
 * carries released values or their analysis is null — snapshot
 * forecast/actual/previous/surprise/surprise_direction, `analysis`,
 * `explanation`, and the pips / change_percent of every reaction.
 * `event.revision_status` and each reaction's `analysis_status` get fixed
 * placeholders (LOCKED_REVISION_STATUS / LOCKED_ANALYSIS_STATUS) instead of
 * null, so older app builds that decode them as non-optional still open the
 * screen; they never depend on the hidden data. Dates, status, data_status,
 * indicator info, the snapshot's unit/source/captured_at and the pair lists
 * stay. Explanations, revisions and reactions are not even read.
 */
async function lockedEventDetail(app: FastifyInstance, event: EventRow, precision: ReleaseDatetimePrecision) {
  const [snapshot, relatedFxPairs, activeFxPairs] = await Promise.all([
    getReleaseSnapshot(app.supabase, event.id),
    listRelatedFxPairs(app.supabase, event.indicator_id),
    listActiveFxPairs(app.supabase),
  ]);
  const majorFxPairs = selectMajorFxPairs(activeFxPairs, relatedFxPairs, event.currency_code);

  return {
    event: {
      id: event.id,
      indicator_id: event.indicator_id,
      indicator_name: event.indicator_name,
      display_name: event.indicator_display_name,
      country_code: event.country_code,
      currency_code: event.currency_code,
      release_datetime: event.release_datetime,
      release_datetime_precision: event.release_datetime_precision,
      importance: event.importance,
      status: event.status,
      data_status: mapEventDataStatus(event.data_status as EconomicEventDbStatus),
      revision_status: LOCKED_REVISION_STATUS,
      ...LOCKED,
    },
    snapshot: snapshot ? nullFields(snapshot, RELEASE_VALUE_FIELDS) : null,
    analysis: { surprise: null, surprise_direction: null },
    explanation: null,
    related_fx_pairs: relatedFxPairs.map((pair) => ({
      fx_pair_id: pair.fx_pair_id,
      symbol: pair.symbol,
      priority: pair.priority,
      reaction: {
        timeframe: RELATED_FX_PAIR_SUMMARY_TIMEFRAME,
        pips: null,
        change_percent: null,
        analysis_status: LOCKED_ANALYSIS_STATUS,
      },
    })),
    major_fx_reactions: majorFxPairs.map((pair) => ({
      fx_pair_id: pair.fx_pair_id,
      symbol: pair.symbol,
      reactions: MAJOR_FX_REACTION_TIMEFRAMES.map((timeframe) => ({
        timeframe,
        pips: null,
        change_percent: null,
        analysis_status: LOCKED_ANALYSIS_STATUS,
      })),
    })),
    available_timeframes: availableTimeframes(precision),
  };
}

export function registerEventRoutes(app: FastifyInstance): void {
  app.get<{ Params: { event_id: string } }>('/events/:event_id', async (request) => {
    const userId = request.user!.id;
    // 機能の確認とプランを1回の読み込みで(このリクエストではもう読まない)。
    const plan = await requireEntitlementAndResolvePlan(app.supabase, userId, FEATURE_CODES.VIEW_BASIC_EVENT);

    const { event_id: eventId } = request.params;
    const event = await getEventById(app.supabase, eventId);
    if (!event) {
      throw new ApiError('EVENT_NOT_FOUND', 'Event not found.');
    }

    const precision = event.release_datetime_precision as ReleaseDatetimePrecision;

    // HQ判断 2026-10-22: FREE は指標ごとに直近3回の発表だけ値を見られる。
    // ロックされた発表も 403 にはせず、値を隠して locked: true で返す。
    const lockedIds = await resolvePastReleaseAccessForPlan(app.supabase, plan, [event]);
    if (lockedIds.has(event.id)) {
      return lockedEventDetail(app, event, precision);
    }

    const [snapshot, explanation, revisionCount, relatedFxPairs, activeFxPairs] = await Promise.all([
      getReleaseSnapshot(app.supabase, eventId),
      getLatestExplanation(app.supabase, eventId),
      countRevisions(app.supabase, eventId),
      listRelatedFxPairs(app.supabase, event.indicator_id),
      listActiveFxPairs(app.supabase),
    ]);

    const majorFxPairs = selectMajorFxPairs(activeFxPairs, relatedFxPairs, event.currency_code);
    const [reactions, majorReactionRows] = await Promise.all([
      listReactionsForTimeframe(
        app.supabase,
        eventId,
        relatedFxPairs.map((pair) => pair.fx_pair_id),
        RELATED_FX_PAIR_SUMMARY_TIMEFRAME,
      ),
      listReactionsForPairsAndTimeframes(
        app.supabase,
        eventId,
        majorFxPairs.map((pair) => pair.fx_pair_id),
        MAJOR_FX_REACTION_TIMEFRAMES,
      ),
    ]);
    const reactionByFxPairId = new Map(reactions.map((reaction) => [reaction.fx_pair_id, reaction]));

    return {
      event: {
        id: event.id,
        indicator_id: event.indicator_id,
        indicator_name: event.indicator_name,
        display_name: event.indicator_display_name,
        country_code: event.country_code,
        currency_code: event.currency_code,
        release_datetime: event.release_datetime,
        release_datetime_precision: event.release_datetime_precision,
        importance: event.importance,
        status: event.status,
        data_status: mapEventDataStatus(event.data_status as EconomicEventDbStatus),
        revision_status: resolveRevisionStatus(revisionCount),
        ...UNLOCKED,
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
      major_fx_reactions: buildMajorFxReactions(majorFxPairs, majorReactionRows, precision),
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
      // HQ判断 2026-10-22: 親の発表がロックされていれば 403 PLAN_LIMIT_EXCEEDED。
      await requireUnlockedEvent(app.supabase, request.user!.id, event);

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
      const plan = await requireEntitlementAndResolvePlan(app.supabase, userId, FEATURE_CODES.VIEW_MARKET_REACTION);

      const { event_id: eventId } = request.params;
      const { fx_pair_id: fxPairId, timeframe } = request.query;
      if (!fxPairId) {
        throw ApiError.validation('fx_pair_id is required.');
      }

      const event = await getEventById(app.supabase, eventId);
      if (!event) {
        throw new ApiError('EVENT_NOT_FOUND', 'Event not found.');
      }
      await requireUnlockedEventForPlan(app.supabase, plan, event);
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
      const plan = await requireEntitlementAndResolvePlan(app.supabase, userId, FEATURE_CODES.VIEW_MARKET_REACTION);

      const { event_id: eventId } = request.params;
      const { fx_pair_id: fxPairId, timeframe } = request.query;
      if (!fxPairId || !isValidTimeframe(timeframe)) {
        throw ApiError.validation('fx_pair_id and a valid timeframe are required.');
      }

      const event = await getEventById(app.supabase, eventId);
      if (!event) {
        throw new ApiError('EVENT_NOT_FOUND', 'Event not found.');
      }
      await requireUnlockedEventForPlan(app.supabase, plan, event);

      // MVP Chart Window: release -30min to +60min (api-design.md §19).
      // 時間足ごとに、発表時刻を基準にした表示範囲(domain/chartWindow.ts)。
      const { from, to } = chartWindow(event.release_datetime, timeframe);

      const prices = await listChartPrices(app.supabase, fxPairId, timeframe, from, to);

      return {
        event_id: eventId,
        fx_pair_id: fxPairId,
        timeframe,
        release_datetime: event.release_datetime,
        window_from: from,
        window_to: to,
        prices,
      };
    },
  );
}
