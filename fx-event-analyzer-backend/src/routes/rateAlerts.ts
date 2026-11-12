import type { FastifyInstance } from 'fastify';
import { resolvePlan } from '../authorization/plan.js';
import { ApiError } from '../errors/ApiError.js';
import { checkRateAlertCreate, rateAlertLimitFor } from '../domain/planLimits.js';
import { toRateAlertItem } from '../domain/rateAlerts.js';
import { getActiveFxPairById } from '../repositories/fxPairsRepository.js';
import {
  countActiveRateAlerts,
  deleteRateAlert,
  insertRateAlert,
  listRateAlertsForUser,
} from '../repositories/rateAlertsRepository.js';
import { createRateAlertBodySchema, rateAlertParamsSchema } from '../schemas/rateAlerts.js';

/**
 * レートアラート — GET/POST /rate-alerts, DELETE /rate-alerts/{id}
 * (api-design.md §24.12-§24.14). Authenticated, no feature_code (like
 * /settings); scoped to request.user.id. The alerts fire into the inbox
 * from GET /notifications and `npm run jobs:evaluate-rate-alerts`.
 */
export function registerRateAlertRoutes(app: FastifyInstance): void {
  app.get('/rate-alerts', async (request) => {
    const userId = request.user!.id;
    const [rows, plan] = await Promise.all([
      listRateAlertsForUser(app.supabase, userId),
      resolvePlan(app.supabase, userId),
    ]);
    return { items: rows.map(toRateAlertItem), limit: rateAlertLimitFor(plan) };
  });

  app.post('/rate-alerts', async (request, reply) => {
    const userId = request.user!.id;
    const body = createRateAlertBodySchema.parse(request.body);

    // Validation (422) first, then the plan (403) — same order as PATCH /settings.
    const pair = await getActiveFxPairById(app.supabase, body.fx_pair_id);
    if (!pair) {
      throw ApiError.validation('fx_pair_id: unknown FX pair.');
    }

    const [plan, activeCount] = await Promise.all([
      resolvePlan(app.supabase, userId),
      countActiveRateAlerts(app.supabase, userId),
    ]);
    const verdict = checkRateAlertCreate(plan, activeCount);
    if (verdict.kind === 'PLAN_LIMIT_EXCEEDED') {
      throw ApiError.planLimitExceeded(
        `rate alerts: at most ${verdict.max} active alert(s) on the ${plan} plan.`,
        verdict.requiredPlan,
      );
    }
    if (verdict.kind === 'OUT_OF_RANGE') {
      throw ApiError.validation(`rate alerts: at most ${verdict.max} active alert(s) on the ${plan} plan.`);
    }

    const row = await insertRateAlert(app.supabase, {
      user_id: userId,
      fx_pair_id: body.fx_pair_id,
      direction: body.direction,
      target_price: body.target_price,
    });
    return reply.code(201).send(toRateAlertItem(row));
  });

  app.delete('/rate-alerts/:id', async (request, reply) => {
    const { id } = rateAlertParamsSchema.parse(request.params);
    const deleted = await deleteRateAlert(app.supabase, request.user!.id, id);
    if (!deleted) {
      throw ApiError.notFound('Rate alert not found.');
    }
    return reply.code(204).send();
  });
}
