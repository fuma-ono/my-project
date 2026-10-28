import { attributionForOrganization } from '../domain/attribution.js';
import type { FastifyInstance } from 'fastify';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ApiError } from '../errors/ApiError.js';
import { requireEntitlement, FEATURE_CODES, listActiveFeatureCodes } from '../authorization/entitlements.js';
import {
  getSpeakerById,
  getSpeechById,
  listDeliveredSpeechesForSpeaker,
  listSpeeches,
  type SpeechSummary,
} from '../repositories/speechesRepository.js';
import { listActiveFxPairs } from '../repositories/fxPairsRepository.js';
import { getFxPairById, listChartPrices } from '../repositories/reactionsRepository.js';
import {
  listSpeechesQuerySchema,
  speakerComparisonQuerySchema,
  speakerParamsSchema,
  speechChartQuerySchema,
  speechParamsSchema,
  speechReactionQuerySchema,
} from '../schemas/speeches.js';
import { buildMeta, parsePagination } from '../utils/pagination.js';
import { resolvePublicBaseUrl, resolveSpeakerPhotoUrl, withResolvedSpeakerPhoto } from '../domain/speakerPhotos.js';
import { withTiming } from '../utils/requestTiming.js';
import { chartWindow } from '../domain/chartWindow.js';
import { historyLimitFor, planFromFeatures, planLimitsFor } from '../domain/planLimits.js';
import {
  computeSpeechPairReaction,
  pipsByTimeframe,
  selectSpeechFxPairs,
  speechCandleRange,
  SPEECH_REACTION_TIMEFRAMES,
  SPEECH_SUMMARY_TIMEFRAMES,
  TIMEFRAME_MINUTES,
  type PriceCandle,
  type SpeechPairReaction,
  type SpeechReactionTimeframe,
} from '../domain/speechReactions.js';

/** Real 1m candles around the statement, enough for timeframes up to `timeframes`' longest. */
async function speechPairReaction(
  supabase: SupabaseClient,
  speech: SpeechSummary,
  fxPair: { fx_pair_id: string; symbol: string },
  timeframes: readonly SpeechReactionTimeframe[],
): Promise<SpeechPairReaction> {
  let candles: PriceCandle[] = [];
  if (speech.status === 'DELIVERED' && speech.statement_time_precision === 'EXACT') {
    const maxMinutes = Math.max(...timeframes.map((timeframe) => TIMEFRAME_MINUTES[timeframe]));
    const { from, to } = speechCandleRange(speech.statement_datetime, maxMinutes);
    const rows = await listChartPrices(supabase, fxPair.fx_pair_id, '1m', from, to);
    candles = rows.map((row) => ({
      timestamp: row.timestamp,
      high: Number(row.high),
      low: Number(row.low),
      close: Number(row.close),
    }));
  }
  return computeSpeechPairReaction({
    status: speech.status,
    timePrecision: speech.statement_time_precision,
    statementDatetime: speech.statement_datetime,
    symbol: fxPair.symbol,
    candles,
    timeframes,
    now: new Date(),
  });
}

async function requireSpeech(supabase: SupabaseClient, rawParams: unknown): Promise<SpeechSummary> {
  const { speech_id: speechId } = speechParamsSchema.parse(rawParams);
  const speech = await getSpeechById(supabase, speechId);
  if (!speech) {
    throw new ApiError('SPEECH_NOT_FOUND', 'Speech not found.');
  }
  return speech;
}

/** 要人発言 (HQ指示 2026-10-05) — GET /speeches, GET /speeches/{speech_id}
 * (api-design.md §14.4/§14.5). Same Entitlement as Event Detail. 値動き
 * (v1.28, §14.8〜§14.10) is computed on the fly from fx_prices
 * (src/domain/speechReactions.ts) — there is no speech reaction table. */
export function registerSpeechRoutes(app: FastifyInstance): void {
  app.get('/speeches', async (request) =>
    withTiming('GET /speeches', async () => {
      await requireEntitlement(app.supabase, request.user!.id, FEATURE_CODES.VIEW_BASIC_EVENT);

      const query = listSpeechesQuerySchema.parse(request.query);
      const pagination = parsePagination(query);
      const { rows, total } = await listSpeeches(
        app.supabase,
        {
          from: query.from,
          to: query.to,
          importance: query.importance,
          currency: query.currency,
          includeCancelled: query.include_cancelled,
        },
        pagination,
      );

      const baseUrl = resolvePublicBaseUrl(app.env.PUBLIC_BASE_URL, request);
      return {
        data: rows.map((row) => withResolvedSpeakerPhoto(row, baseUrl)),
        meta: buildMeta(pagination.page, pagination.limit, total),
      };
    }),
  );

  app.get('/speeches/:speech_id', async (request) => {
    await requireEntitlement(app.supabase, request.user!.id, FEATURE_CODES.VIEW_BASIC_EVENT);

    const speech = await requireSpeech(app.supabase, request.params);

    // v1.28: the major pairs of the speaker's currency × 1m/5m/15m pips. Only DELIVERED speeches.
    let reactions: {
      fx_pair_id: string;
      symbol: string;
      pre_statement_price: number | null;
      pips: Record<string, number | null>;
    }[] = [];
    // 公開の時刻しか無い発言(ポッドキャスト等)は相場反応を出さない(HQ判断 2026-10-28)
    if (speech.status === 'DELIVERED' && speech.statement_time_precision === 'EXACT') {
      const pairs = selectSpeechFxPairs(await listActiveFxPairs(app.supabase), speech.speaker.currency_code);
      reactions = await Promise.all(
        pairs.map(async (pair) => {
          const reaction = await speechPairReaction(app.supabase, speech, pair, SPEECH_SUMMARY_TIMEFRAMES);
          return {
            fx_pair_id: pair.fx_pair_id,
            symbol: pair.symbol,
            pre_statement_price: reaction.pre_release_price,
            pips: pipsByTimeframe(reaction),
          };
        }),
      );
    }

    return {
      ...withResolvedSpeakerPhoto(speech, resolvePublicBaseUrl(app.env.PUBLIC_BASE_URL, request)),
      reactions,
    };
  });

  // Same shape as GET /events/{id}/reaction (§18.1): event_id = the speech id.
  app.get('/speeches/:speech_id/reaction', async (request) => {
    await requireEntitlement(app.supabase, request.user!.id, FEATURE_CODES.VIEW_MARKET_REACTION);

    const query = speechReactionQuerySchema.parse(request.query);
    const speech = await requireSpeech(app.supabase, request.params);
    const fxPair = await getFxPairById(app.supabase, query.fx_pair_id);
    if (!fxPair) {
      throw new ApiError('FX_PAIR_NOT_FOUND', 'FX pair not found.');
    }
    const pair = { fx_pair_id: fxPair.id, symbol: fxPair.symbol };

    if (query.timeframe === 'all') {
      const reaction = await speechPairReaction(app.supabase, speech, pair, SPEECH_REACTION_TIMEFRAMES);
      return {
        event_id: speech.speech_id,
        fx_pair_id: fxPair.id,
        pre_release_price: reaction.pre_release_price,
        reactions: reaction.reactions,
      };
    }

    const reaction = await speechPairReaction(app.supabase, speech, pair, [query.timeframe]);
    return {
      event_id: speech.speech_id,
      fx_pair_id: fxPair.id,
      pre_release_price: reaction.pre_release_price,
      ...reaction.reactions[0]!,
    };
  });

  // Same shape and window rule as GET /events/{id}/reaction/chart (§19); release_datetime = statement_datetime.
  app.get('/speeches/:speech_id/reaction/chart', async (request) => {
    await requireEntitlement(app.supabase, request.user!.id, FEATURE_CODES.VIEW_MARKET_REACTION);

    const query = speechChartQuerySchema.parse(request.query);
    const speech = await requireSpeech(app.supabase, request.params);

    const { from, to } = chartWindow(speech.statement_datetime, query.timeframe);
    const prices = await listChartPrices(app.supabase, query.fx_pair_id, query.timeframe, from, to);

    return {
      event_id: speech.speech_id,
      fx_pair_id: query.fx_pair_id,
      timeframe: query.timeframe,
      release_datetime: speech.statement_datetime,
      window_from: from,
      window_to: to,
      prices,
    };
  });

  // 要人ごとの過去比較 (v1.28, §14.10): the speaker's DELIVERED speeches, newest
  // first, capped like GET /indicators/{id}/comparison (history_events_max).
  app.get('/speakers/:speaker_id/comparison', async (request) => {
    const userId = request.user!.id;
    await requireEntitlement(app.supabase, userId, FEATURE_CODES.VIEW_HISTORICAL);

    const { speaker_id: speakerId } = speakerParamsSchema.parse(request.params);
    const query = speakerComparisonQuerySchema.parse(request.query);
    const speaker = await getSpeakerById(app.supabase, speakerId);
    if (!speaker) {
      throw new ApiError('SPEAKER_NOT_FOUND', 'Speaker not found.');
    }

    let pair: { fx_pair_id: string; symbol: string } | null;
    if (query.fx_pair_id) {
      const fxPair = await getFxPairById(app.supabase, query.fx_pair_id);
      if (!fxPair) {
        throw new ApiError('FX_PAIR_NOT_FOUND', 'FX pair not found.');
      }
      pair = { fx_pair_id: fxPair.id, symbol: fxPair.symbol };
    } else {
      pair = selectSpeechFxPairs(await listActiveFxPairs(app.supabase), speaker.currency_code)[0] ?? null;
    }

    const features = await listActiveFeatureCodes(app.supabase, userId);
    const plan = planFromFeatures(features);
    const historyMax = planLimitsFor(plan).history_events_max;
    const speeches = await listDeliveredSpeechesForSpeaker(app.supabase, speakerId, historyMax);

    const events = await Promise.all(
      speeches.map(async (speech) => {
        const pips = pair
          ? pipsByTimeframe(await speechPairReaction(app.supabase, speech, pair, SPEECH_SUMMARY_TIMEFRAMES))
          : Object.fromEntries(SPEECH_SUMMARY_TIMEFRAMES.map((timeframe) => [timeframe, null]));
        return {
          speech_id: speech.speech_id,
          title: speech.title,
          statement_datetime: speech.statement_datetime,
          importance: speech.importance,
          pips_by_timeframe: pips,
        };
      }),
    );

    return {
      speaker: {
        ...speaker,
        photo_url: resolveSpeakerPhotoUrl(speaker.photo_url, resolvePublicBaseUrl(app.env.PUBLIC_BASE_URL, request)),
      },
      fx_pair_id: pair?.fx_pair_id ?? null,
      symbol: pair?.symbol ?? null,
      /** 出典と告知(api-design v1.39)。要人の機関から(ECB: 告知つき、FRB: 出典だけ、他: null)。 */
      attribution: attributionForOrganization(speaker.organization),
      events,
      history_limit: historyLimitFor(plan, speeches.length),
    };
  });
}
