import type { FastifyInstance } from 'fastify';
import { requireEntitlement, FEATURE_CODES } from '../authorization/entitlements.js';
import { listEventsInRange } from '../repositories/homeRepository.js';
import { listSpeechesInRange } from '../repositories/speechesRepository.js';
import { calendarQuerySchema } from '../schemas/calendar.js';
import { buildCalendarItems } from '../domain/calendar.js';

/** SCR-010 経済指標カレンダー — GET /calendar (api-design.md §14.6).
 * Same Entitlement as GET /speeches. The range is capped at 62 days, so
 * there is no pagination; importance/currency are applied in
 * buildCalendarItems over the range's rows. */
export function registerCalendarRoutes(app: FastifyInstance): void {
  app.get('/calendar', async (request) => {
    await requireEntitlement(app.supabase, request.user!.id, FEATURE_CODES.VIEW_BASIC_EVENT);

    const query = calendarQuerySchema.parse(request.query);
    const [events, speeches] = await Promise.all([
      listEventsInRange(app.supabase, query.from, query.to),
      listSpeechesInRange(app.supabase, query.from, query.to),
    ]);

    return {
      from: query.from,
      to: query.to,
      items: buildCalendarItems(events, speeches, { importance: query.importance, currency: query.currency }),
    };
  });
}
