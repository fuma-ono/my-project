import type { FastifyInstance } from 'fastify';
import { requireEntitlement, FEATURE_CODES } from '../authorization/entitlements.js';
import { resolvePlan } from '../authorization/plan.js';
import { ApiError } from '../errors/ApiError.js';
import { listEventsInRange } from '../repositories/homeRepository.js';
import { listSpeechesInRange } from '../repositories/speechesRepository.js';
import { calendarQuerySchema } from '../schemas/calendar.js';
import { buildCalendarItems } from '../domain/calendar.js';
import { formatIsoSeconds } from '../domain/notifications.js';
import { checkCalendarRange } from '../domain/planLimits.js';

/** SCR-010 経済指標カレンダー — GET /calendar (api-design.md §14.6).
 * Same Entitlement as GET /speeches. The range is capped at 62 days, so
 * there is no pagination; importance/currency are applied in
 * buildCalendarItems over the range's rows. How far back/ahead the range
 * may go depends on the plan (§28.1): past what PRO allows → 403
 * PLAN_LIMIT_EXCEEDED, past what any plan allows → 422. */
export function registerCalendarRoutes(app: FastifyInstance): void {
  app.get('/calendar', async (request) => {
    const userId = request.user!.id;
    await requireEntitlement(app.supabase, userId, FEATURE_CODES.VIEW_BASIC_EVENT);

    const query = calendarQuerySchema.parse(request.query);
    const plan = await resolvePlan(app.supabase, userId);
    const verdict = checkCalendarRange(plan, new Date(query.from), new Date(query.to), new Date(), query.timezone);
    if (verdict.kind === 'PLAN_LIMIT_EXCEEDED') {
      throw ApiError.planLimitExceeded(
        `from: the ${plan} plan can go back to ${formatIsoSeconds(verdict.bound)} (${query.timezone}).`,
        verdict.requiredPlan,
      );
    }
    if (verdict.kind === 'OUT_OF_RANGE') {
      throw ApiError.validation(
        verdict.field === 'from'
          ? `from: must be ${formatIsoSeconds(verdict.bound)} or later.`
          : `to: must be ${formatIsoSeconds(verdict.bound)} or earlier.`,
      );
    }

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
