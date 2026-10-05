import type { FastifyInstance } from 'fastify';
import { ApiError } from '../errors/ApiError.js';
import { requireEntitlement, FEATURE_CODES } from '../authorization/entitlements.js';
import { getSpeechById, listSpeeches } from '../repositories/speechesRepository.js';
import { listSpeechesQuerySchema, speechParamsSchema } from '../schemas/speeches.js';
import { buildMeta, parsePagination } from '../utils/pagination.js';

/** 要人発言 (HQ指示 2026-10-05) — GET /speeches, GET /speeches/{speech_id}
 * (api-design.md §14.4/§14.5). Same Entitlement as Event Detail. */
export function registerSpeechRoutes(app: FastifyInstance): void {
  app.get('/speeches', async (request) => {
    await requireEntitlement(app.supabase, request.user!.id, FEATURE_CODES.VIEW_BASIC_EVENT);

    const query = listSpeechesQuerySchema.parse(request.query);
    const pagination = parsePagination(query);
    const { rows, total } = await listSpeeches(
      app.supabase,
      { from: query.from, to: query.to, importance: query.importance, currency: query.currency },
      pagination,
    );

    return { data: rows, meta: buildMeta(pagination.page, pagination.limit, total) };
  });

  app.get('/speeches/:speech_id', async (request) => {
    await requireEntitlement(app.supabase, request.user!.id, FEATURE_CODES.VIEW_BASIC_EVENT);

    const { speech_id: speechId } = speechParamsSchema.parse(request.params);
    const speech = await getSpeechById(app.supabase, speechId);
    if (!speech) {
      throw new ApiError('SPEECH_NOT_FOUND', 'Speech not found.');
    }
    return speech;
  });
}
