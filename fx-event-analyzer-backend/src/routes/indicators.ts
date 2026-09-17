import type { FastifyInstance } from 'fastify';
import { ApiError } from '../errors/ApiError.js';
import {
  getIndicatorById,
  getLatestEvent,
  listIndicators,
  listRelatedFxPairs,
} from '../repositories/indicatorsRepository.js';
import { listIndicatorsQuerySchema } from '../schemas/indicators.js';
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
}
