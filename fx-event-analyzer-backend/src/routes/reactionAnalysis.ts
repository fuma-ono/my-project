import type { FastifyInstance } from 'fastify';
import { assertEntitlement, FEATURE_CODES, listActiveFeatureCodes } from '../authorization/entitlements.js';
import {
  pricePointsDisplayGranted,
  REACTION_ANALYSIS_SOURCE_ID,
  requireReactionAnalysisRights,
} from '../authorization/reactionAnalysis.js';
import { requirePriceFeatures } from '../authorization/priceFeatures.js';
import { isUsableStrategyPair, selectDefaultStrategyPair } from '../domain/eventStrategyAnalysis.js';
import { groupByMarketEvent, coReleasedRows, summarizeMarketEventCoverage } from '../domain/marketEventGrouping.js';
import { MAJOR_FX_PAIR_ORDER } from '../domain/majorFxReactions.js';
import { minuteIndexOf, requiredMinuteRanges } from '../domain/reactionClassification/baseline.js';
import { DEFAULT_PARAM_SET_ID, getParamSet } from '../domain/reactionClassification/params.js';
import { buildReactionAnalysis, type HistoryEventInput, metaBlock } from '../domain/reactionClassification/response.js';
import { MS_PER_MINUTE } from '../domain/reactionClassification/time.js';
import { pipSizeForSymbol } from '../domain/speechReactions.js';
import { dstMismatchCaution } from '../domain/reactionClassification/dstCaution.js';
import { ApiError } from '../errors/ApiError.js';
import { FX_FETCH_SETTINGS } from '../ingestion/config.js';
import { getEventById } from '../repositories/eventsRepository.js';
import {
  getStrategyPair,
  listCoReleasedEvents,
  listStrategyPairCandidates,
} from '../repositories/historicalRepository.js';
import {
  listMinuteCloses,
  listOverlapCandidates,
  listPastEventsForHistory,
} from '../repositories/reactionAnalysisRepository.js';
import { listReactionsForPair } from '../repositories/reactionsRepository.js';
import { reactionAnalysisParamsSchema, reactionAnalysisQuerySchema } from '../schemas/reactionAnalysis.js';

/**
 * GET /events/{event_id}/reaction-analysis?fx_pair_id= — descriptive classification of the price path after a release
 * (CONTINUATION / PULLBACK / FULL_RETRACE / REVERSAL / UNDETERMINED per window, with evidence, overlaps, a past
 * comparison and the parameter set used). Computed at read time from stored 1-minute bars; nothing is stored.
 * Descriptive only: not a prediction and not trading advice.
 *
 * Gate order (nothing below runs before the one above):
 *  0. Bearer JWT (the /api/v1 auth hook).
 *  1. PRICE_FEATURES_ENABLED, else 404 NOT_FOUND (no DB read).
 *  2. Data rights ledger confirms 'eventReactionAnalysis' for the bar source, else 403 DATA_RIGHTS_UNCONFIRMED
 *     (static ledger, no DB read, same code / detail as GET /fx-pairs/{id}/technical). There is no bypass flag.
 *     Price points (close_price, pre_release_price) are NOT part of that gate: they are omitted from the body unless the
 *     ledger also confirms externalDisplay (meta.price_points_included says which). The endpoint stays open without it.
 *  3. VIEW_BASIC_EVENT (403 FEATURE_NOT_ENTITLED).
 *  4. no VIEW_ADVANCED_STATS: 200 { available: false } (price tables are not read).
 *  5. input validation, 422 VALIDATION_ERROR.   6. event, 404 EVENT_NOT_FOUND.   7. pair, 404 FX_PAIR_NOT_FOUND
 *     (no usable pair at all: 200 with fx_pair null and empty windows).
 */
export function registerReactionAnalysisRoutes(app: FastifyInstance): void {
  app.get<{ Params: { event_id: string } }>('/events/:event_id/reaction-analysis', async (request) => {
    requirePriceFeatures(app);
    requireReactionAnalysisRights(app, REACTION_ANALYSIS_SOURCE_ID);

    const features = await listActiveFeatureCodes(app.supabase, request.user!.id);
    assertEntitlement(features, FEATURE_CODES.VIEW_BASIC_EVENT);
    if (!features.includes(FEATURE_CODES.VIEW_ADVANCED_STATS)) {
      return unavailable(request.params.event_id);
    }

    const { event_id: eventId } = reactionAnalysisParamsSchema.parse(request.params);
    const query = reactionAnalysisQuerySchema.parse(request.query);
    const event = await getEventById(app.supabase, eventId);
    if (!event) throw new ApiError('EVENT_NOT_FOUND', 'Event not found.');

    // The ledger entry is guaranteed by the gate above (the same static registry).
    const ledgerEntry = app.technicalRightsLedger.find((e) => e.sourceId === REACTION_ANALYSIS_SOURCE_ID)!;
    const includePricePoints = pricePointsDisplayGranted(app, REACTION_ANALYSIS_SOURCE_ID);
    const params = getParamSet(DEFAULT_PARAM_SET_ID);
    const nowMs = Date.now();
    const releaseMs = Date.parse(event.release_datetime);

    // Simultaneous releases (same provider and EXACT time) share one path and one label.
    const self = {
      event_id: event.id,
      indicator_id: event.indicator_id,
      indicator_code: event.indicator_code,
      provider: event.provider,
      release_datetime: event.release_datetime,
      release_datetime_precision: event.release_datetime_precision,
    };
    const groups = groupByMarketEvent([self, ...(await listCoReleasedEvents(app.supabase, [self]))]);
    const ownGroup = groups.find((g) => g.events.some((e) => e.event_id === event.id))!;
    const marketEvent = {
      group_key: ownGroup.key.startsWith('__ungrouped__:') ? null : ownGroup.key,
      indicator_count: summarizeMarketEventCoverage([ownGroup]).indicatorEventCount,
      co_released_indicators: coReleasedRows(groups, event.id).map((r) => ({
        indicator_id: r.indicator_id,
        indicator_code: r.indicator_code,
      })),
      group_event_ids: ownGroup.events.map((e) => e.event_id),
    };

    // Pair resolution is the same as strategy-analysis (usable = active and contains the indicator's currency).
    const candidates = await listStrategyPairCandidates(app.supabase, event.indicator_id);
    const defaultPair = selectDefaultStrategyPair(candidates, event.currency_code);
    let pair: { fx_pair_id: string; symbol: string; base_currency: string; quote_currency: string } | null;
    if (query.fx_pair_id) {
      const requested = await getStrategyPair(app.supabase, query.fx_pair_id);
      if (!requested || !isUsableStrategyPair(requested, event.currency_code)) {
        throw new ApiError('FX_PAIR_NOT_FOUND', 'FX pair not found.');
      }
      pair = requested;
    } else {
      pair = defaultPair;
    }
    const selectablePairs = sortUsablePairs(candidates, event.currency_code).map((c) => ({
      fx_pair_id: c.fx_pair_id,
      symbol: c.symbol,
      is_default: c.fx_pair_id === defaultPair?.fx_pair_id,
    }));

    const eventBlock = {
      indicator_id: event.indicator_id,
      indicator_code: event.indicator_code,
      name: event.indicator_display_name ?? event.indicator_name,
      country_code: event.country_code,
      currency_code: event.currency_code,
      release_datetime: new Date(releaseMs).toISOString(),
      release_datetime_precision: event.release_datetime_precision,
    };
    if (!pair) {
      return {
        event_id: eventId,
        available: true,
        required_entitlement: null,
        event: eventBlock,
        fx_pair: null,
        selectable_pairs: selectablePairs,
        market_event: {
          group_key: marketEvent.group_key,
          independent_market_events: 1,
          indicator_count: marketEvent.indicator_count,
          co_released_indicators: marketEvent.co_released_indicators,
          label_shared: marketEvent.indicator_count > 1,
        },
        meta: metaBlock(
          { params, ledgerEntry, dataSource: REACTION_ANALYSIS_SOURCE_ID, nowMs, includePricePoints },
          null,
        ),
        dst_mismatch_caution: dstMismatchCaution(releaseMs),
        reference: null,
        baseline: null,
        initial: null,
        windows: [],
        history: { windows: [] },
      };
    }

    const timeExact = event.release_datetime_precision === 'EXACT';
    const maxWindow = Math.max(...params.windows);
    const windowMs = maxWindow * MS_PER_MINUTE;
    const lookbackMs = params.baseline.lookback_minutes * MS_PER_MINUTE;
    const pastEvents = timeExact
      ? await listPastEventsForHistory(
          app.supabase,
          event.indicator_id,
          event.release_datetime,
          params.history.max_samples,
        )
      : [];

    const [reactions, bars, overlapCandidates] = await Promise.all([
      listReactionsForPair(app.supabase, eventId, pair.fx_pair_id),
      // A release time that is not EXACT is never classified: its bars are not read.
      timeExact
        ? listMinuteCloses(
            app.supabase,
            pair.fx_pair_id,
            requiredMinuteRanges(minuteIndexOf(releaseMs), params, maxWindow),
          )
        : Promise.resolve(new Map<number, number>()),
      listOverlapCandidates(
        app.supabase,
        new Date(releaseMs - lookbackMs).toISOString(),
        new Date(releaseMs + windowMs).toISOString(),
      ),
    ]);

    // Past events one after another: each needs its own bars (about 700 rows) and overlap candidates.
    const history: HistoryEventInput[] = [];
    for (const past of pastEvents) {
      const pastMs = Date.parse(past.release_datetime);
      history.push({
        event_id: past.event_id,
        release_datetime: past.release_datetime,
        bars: await listMinuteCloses(
          app.supabase,
          pair.fx_pair_id,
          requiredMinuteRanges(minuteIndexOf(pastMs), params, maxWindow),
        ),
        candidates: await listOverlapCandidates(
          app.supabase,
          new Date(pastMs).toISOString(),
          new Date(pastMs + windowMs).toISOString(),
        ),
      });
    }

    return buildReactionAnalysis({
      event: { ...eventBlock, event_id: eventId, name: eventBlock.name },
      pair: {
        fx_pair_id: pair.fx_pair_id,
        symbol: pair.symbol,
        pip_size: pipSizeForSymbol(pair.symbol),
        base_currency: pair.base_currency,
        quote_currency: pair.quote_currency,
      },
      selectablePairs,
      marketEvent,
      params,
      ledgerEntry,
      dataSource: REACTION_ANALYSIS_SOURCE_ID,
      includePricePoints,
      reactions,
      bars,
      candidates: overlapCandidates,
      history,
      nowMs,
      finalityMs: FX_FETCH_SETTINGS.finalityLagMinutes * MS_PER_MINUTE,
    });
  });
}

/** 200 body without VIEW_ADVANCED_STATS (staged disclosure, like strategy-analysis). Same keys as the full body, no data. */
function unavailable(eventId: string) {
  return {
    event_id: eventId,
    available: false,
    required_entitlement: 'VIEW_ADVANCED_STATS',
    event: null,
    fx_pair: null,
    selectable_pairs: [],
    market_event: null,
    meta: null,
    dst_mismatch_caution: null,
    reference: null,
    baseline: null,
    initial: null,
    windows: [],
    history: null,
  };
}

/** Usable related pairs in the same order selectDefaultStrategyPair uses (priority, major-pair order, symbol). */
function sortUsablePairs(
  related: Parameters<typeof selectDefaultStrategyPair>[0],
  currency: string | null,
): Parameters<typeof selectDefaultStrategyPair>[0][number][] {
  const rank = (symbol: string) => {
    const index = (MAJOR_FX_PAIR_ORDER as readonly string[]).indexOf(symbol);
    return index === -1 ? MAJOR_FX_PAIR_ORDER.length : index;
  };
  return related
    .filter((pair) => isUsableStrategyPair(pair, currency))
    .sort(
      (a, b) =>
        a.priority - b.priority ||
        rank(a.symbol) - rank(b.symbol) ||
        (a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0),
    );
}
