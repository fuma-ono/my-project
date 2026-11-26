import type { FastifyInstance } from 'fastify';
import {
  requireTechnicalAnalysis,
  requireTechnicalRights,
  TECHNICAL_FEATURES,
} from '../authorization/technicalAnalysis.js';
import {
  buildTechnicalChart,
  type IndicatorRequest,
  lookbackMs,
  maxCandlesForPlan,
  sourceRowBudget,
  TIMEFRAME_PLANS,
} from '../domain/technical/technicalChart.js';
import { TWELVEDATA_FREE_INTERNAL_SOURCE_ID } from '../domain/technical/rightsRegistry.js';
import { ApiError } from '../errors/ApiError.js';
import { getFxPairById } from '../repositories/reactionsRepository.js';
import { SupabaseBarSource } from '../repositories/technicalBarSource.js';
import { technicalParamsSchema, technicalQuerySchema } from '../schemas/technical.js';

/**
 * GET /fx-pairs/{fx_pair_id}/technical (api-design.md v1.55): candles + indicator series aligned 1:1 to the
 * candles (null = warm-up) + key price zones, computed by the pure engine in domain/technical.
 *
 * Gate order (nothing below runs before the one above):
 *  1. TECHNICAL_ANALYSIS_ENABLED and PRICE_FEATURES_ENABLED both true, else 404 NOT_FOUND (no DB read).
 *  2. Rights ledger of the data source grants chartHistory/technicalIndicators/keyZones with evidence,
 *     else 403 DATA_RIGHTS_UNCONFIRMED (static registry, still no DB read).
 *  3. Input validation (422 VALIDATION_ERROR, the repo's existing validation status).
 */
export function registerTechnicalRoutes(app: FastifyInstance): void {
  app.get('/fx-pairs/:fx_pair_id/technical', async (request) => {
    requireTechnicalAnalysis(app);
    // The only data source today. BarSource.id is also the rights ledger key.
    requireTechnicalRights(app, TWELVEDATA_FREE_INTERNAL_SOURCE_ID);

    const { fx_pair_id: fxPairId } = technicalParamsSchema.parse(request.params);
    const query = technicalQuerySchema.parse(request.query);

    const pair = await getFxPairById(app.supabase, fxPairId);
    if (!pair) throw new ApiError('FX_PAIR_NOT_FOUND', 'FX pair not found.');

    const plan = TIMEFRAME_PLANS[query.timeframe];
    const limit = Math.min(query.limit, maxCandlesForPlan(plan));
    const source = new SupabaseBarSource(app.supabase, sourceRowBudget(plan, limit));
    const toMs = Date.now();
    const bars = await source.fetchBars({
      pair: fxPairId,
      timeframe: plan.source,
      fromMs: toMs - lookbackMs(plan, limit),
      toMs,
    });

    const requests: IndicatorRequest[] = query.indicators.map((spec) => ({
      kind: spec.kind,
      key: spec.key,
      ...('period' in spec ? { period: spec.period } : {}),
    }));
    const chart = buildTechnicalChart(bars, plan, limit, requests, source.truncated);
    const entry = app.technicalRightsLedger.find((e) => e.sourceId === source.id)!;

    return {
      data: {
        fx_pair_id: pair.id,
        symbol: pair.symbol,
        timeframe: query.timeframe,
        candles: chart.candles.map((c) => ({ t: new Date(c.t).toISOString(), o: c.o, h: c.h, l: c.l, c: c.c })),
        indicators: chart.indicators,
        key_zones: chart.keyZones,
        meta: {
          timeframe: query.timeframe,
          convention: 'NY17',
          bar_count: chart.candles.length,
          requested_limit: query.limit,
          applied_limit: limit,
          source_row_cap_hit: source.truncated,
          source_bar_count: chart.gaps.sourceBarCount,
          expected_source_bars: chart.gaps.expectedSourceBars,
          has_gaps: chart.gaps.hasGaps,
          partial_last: chart.partialLast,
          data_source: source.id,
          rights_ledger: {
            entry_id: entry.sourceId,
            status: 'confirmed',
            features: [...TECHNICAL_FEATURES],
            evidence_urls: [
              ...new Set(
                Object.values(entry.rights)
                  .map((r) => r.evidenceUrl)
                  .filter((u): u is string => typeof u === 'string' && u.trim() !== ''),
              ),
            ],
          },
        },
      },
    };
  });
}
