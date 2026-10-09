import type { FastifyInstance } from 'fastify';
import { getActiveSubscription } from '../repositories/subscriptionsRepository.js';

export function registerSubscriptionRoutes(app: FastifyInstance): void {
  app.get('/subscription', async (request) => {
    const userId = request.user!.id;
    const subscription = await getActiveSubscription(app.supabase, userId);

    if (!subscription) {
      // No subscriptions row at all is a legitimate state (never
      // subscribed) — api-design.md §25/§26 don't define this edge case
      // explicitly, so the safest, most defensible default is: report the
      // implicit FREE tier rather than a 404 (this is not an error state).
      // Flagged as a minor design-clarification candidate in the Phase 2
      // report, not applied as a silent spec change.
      return { plan: 'FREE', status: null, started_at: null, expires_at: null };
    }

    return subscription;
  });
}
