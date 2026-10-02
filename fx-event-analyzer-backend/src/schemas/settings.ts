import { z } from 'zod';

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
        pre_release: z.boolean(),
        result: z.boolean(),
        favorites: z.boolean(),
        min_importance: z.number().int().min(1).max(5),
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
