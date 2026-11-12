import type { FastifyInstance } from 'fastify';
import { searchCurrencies } from '../domain/currencies.js';
import { searchEventsByIndicator, searchFxPairs, searchIndicators } from '../repositories/searchRepository.js';
import { searchQuerySchema } from '../schemas/search.js';
import { parsePagination } from '../utils/pagination.js';

/** GET /search — api-design.md §23. MVP is partial match only (pg_trgm +
 * GIN, db-design.md §12); Full Text Search is out of scope. */
export function registerSearchRoutes(app: FastifyInstance): void {
  app.get('/search', async (request) => {
    const query = searchQuerySchema.parse(request.query);
    const { limit } = parsePagination(query);

    const results: {
      indicators?: Awaited<ReturnType<typeof searchIndicators>>;
      events?: Awaited<ReturnType<typeof searchEventsByIndicator>>;
      fx_pairs?: Awaited<ReturnType<typeof searchFxPairs>>;
      currencies?: ReturnType<typeof searchCurrencies>;
    } = {};

    if (query.type === 'all' || query.type === 'indicator') {
      results.indicators = await searchIndicators(app.supabase, query.q, limit);
    }
    if (query.type === 'all' || query.type === 'event') {
      results.events = await searchEventsByIndicator(app.supabase, query.q, limit);
    }
    if (query.type === 'all' || query.type === 'fx_pair') {
      results.fx_pairs = await searchFxPairs(app.supabase, query.q, limit);
    }
    if (query.type === 'all' || query.type === 'currency') {
      results.currencies = searchCurrencies(query.q);
    }

    return { q: query.q, type: query.type, ...results };
  });
}
