import { z } from 'zod';
import { sortImportancesDesc } from '../domain/importance.js';
import { NOTIFICATION_LEAD_MINUTES, NOTIFICATION_TIME_PATTERN } from '../domain/notifications.js';

/** IANA zone names only — rejects anything `Intl` can't resolve, so a bad
 * value never reaches timezone-scoped APIs like Home (api-design.md §6). */
function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** PATCH /settings body (api-design.md §24.4). Every field is optional —
 * only the fields present are changed — and unknown fields are rejected. */
export const updateSettingsBodySchema = z
  .object({
    notifications: z
      .object({
        push: z.boolean(),
        indicators: z.boolean(),
        speeches: z.boolean(),
        // null = すべての通貨ペア. Whether each symbol exists in fx_pairs is
        // checked against the DB by the route (422 on an unknown one).
        fx_pairs: z
          .array(z.string().min(1))
          .min(1)
          .refine((symbols) => new Set(symbols).size === symbols.length, 'must not contain duplicate symbols')
          .nullable(),
        // Duplicates are harmless here, so they are folded rather than rejected.
        importances: z
          .array(z.enum(['HIGH', 'MEDIUM', 'LOW']))
          .min(1)
          .transform(sortImportancesDesc),
        lead_minutes: z.literal(NOTIFICATION_LEAD_MINUTES),
        // 通知しない時間帯. "HH:MM" local time in display.timezone; start ==
        // end is allowed (= suppresses nothing).
        quiet_hours_enabled: z.boolean(),
        quiet_start: z.string().regex(NOTIFICATION_TIME_PATTERN, 'must be HH:MM (00:00-23:59)'),
        quiet_end: z.string().regex(NOTIFICATION_TIME_PATTERN, 'must be HH:MM (00:00-23:59)'),
      })
      .partial()
      .strict()
      .optional(),
    display: z
      .object({
        language: z.enum(['ja', 'en']),
        region: z.string().regex(/^[A-Z]{2}$/, 'must be an ISO 3166-1 alpha-2 code'),
        timezone: z.string().min(1).refine(isValidTimeZone, 'must be a valid IANA time zone'),
      })
      .partial()
      .strict()
      .optional(),
    chart: z
      .object({
        default_fx_pair_symbol: z.string().min(1).nullable(),
        default_timeframe: z.enum(['1m', '5m', '15m', '30m', '60m']),
      })
      .partial()
      .strict()
      .optional(),
  })
  .strict();

export type UpdateSettingsBody = z.infer<typeof updateSettingsBodySchema>;
