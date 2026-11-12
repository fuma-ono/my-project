import { z } from 'zod';
import { RATE_ALERT_DIRECTIONS } from '../domain/rateAlerts.js';

/** POST /rate-alerts (api-design.md §24.13). target_price fits rate_alerts.target_price numeric(12, 6). */
export const createRateAlertBodySchema = z.object({
  fx_pair_id: z.guid(),
  direction: z.enum(RATE_ALERT_DIRECTIONS),
  target_price: z.number().positive().lt(1_000_000),
});

/** DELETE /rate-alerts/{id} (§24.14). z.guid() like inboxNotificationParamsSchema. */
export const rateAlertParamsSchema = z.object({
  id: z.guid(),
});
