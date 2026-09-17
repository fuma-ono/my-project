import type { FastifyInstance } from 'fastify';
import { ApiError } from '../errors/ApiError.js';
import {
  getIndicatorById,
  getLatestEvent,
  listEventsForIndicator,
  listIndicators,
  listRelatedFxPairs,
} from '../repositories/indicatorsRepository.js';
import { listIndicatorEventsQuerySchema, listIndicatorsQuerySchema } from '../schemas/indicators.js';
import { buildMeta, parsePagination, resolveSort } from '../utils/pagination.js';

const SORT_ALLOWLIST = ['name', 'importance', 'created_at'] as const;

export function registerIndicatorRoutes(app: FastifyInstance): void {
  app.get('/indicators', async (request) => {
    const query = listIndicatorsQuerySchema.parse(request.query);
    const pagination = parsePagination(query);
    const sort = resolveSort(query.sort, SORT_ALLOWLIST, 'name');

    const { rows, total } = await listIndicators(
      app.supabase,
      {
        q: query.q,
        countryCode: query.country_code,
        currencyCode: query.currency_code,
        importance: query.importance,
        sort,
      },
      pagination,
    );

    return { data: rows, meta: buildMeta(pagination.page, pagination.limit, total) };
  });

  app.get<{ Params: { indicator_id: string } }>('/indicators/:indicator_id', async (request) => {
    const { indicator_id: indicatorId } = request.params;
    const indicator = await getIndicatorById(app.supabase, indicatorId);
    if (!indicator) {
      throw new ApiError('INDICATOR_NOT_FOUND', 'Indicator not found.');
    }

    const [relatedFxPairs, latestEvent] = await Promise.all([
      listRelatedFxPairs(app.supabase, indicatorId),
      getLatestEvent(app.supabase, indicatorId),
    ]);

    return {
      indicator,
      favorable_direction: indicator.favorable_direction,
      related_fx_pairs: relatedFxPairs,
      latest_event: latestEvent,
    };
  });

  // GET /indicators/{id}/events — api-design.md §13.3. Not yet built in
  // Phase 2 (only §13.1/13.2 were), needed by SCR-003's historical event
  // list (Phase 3). Same auth as the rest of this file — no feature_code
  // required, per §27.1.
  app.get<{ Params: { indicator_id: string }; Querystring: Record<string, string | undefined> }>(
    '/indicators/:indicator_id/events',
    async (request) => {
      const { indicator_id: indicatorId } = request.params;
      const indicator = await getIndicatorById(app.supabase, indicatorId);
      if (!indicator) {
        throw new ApiError('INDICATOR_NOT_FOUND', 'Indicator not found.');
      }

      const query = listIndicatorEventsQuerySchema.parse(request.query);
      const pagination = parsePagination(query);

      const { rows, total } = await listEventsForIndicator(
        app.supabase,
        indicatorId,
        { from: query.from, to: query.to, status: query.status },
        pagination,
      );

      return {
        data: rows.map(({ id, ...rest }) => ({ event_id: id, indicator_id: indicatorId, ...rest })),
        meta: buildMeta(pagination.page, pagination.limit, total),
      };
    },
  );
}
