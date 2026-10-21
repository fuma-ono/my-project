import { z } from 'zod';
import { SUPPORT_BODY_MAX_LENGTH, SUPPORT_CATEGORIES, SUPPORT_KINDS } from '../domain/support.js';

/** Optional device info for bug investigation. Blank → null. Same 100-char
 * limit as the DB CHECKs (supabase/migrations/20261006000003_support_requests.sql). */
const deviceInfo = z
  .string()
  .trim()
  .max(100)
  .nullable()
  .optional()
  .transform((value) => (value ? value : null));

/** POST /support/requests body (api-design.md §24.7). Unknown fields are
 * rejected. `body` is stored trimmed; whether it makes sense is not a
 * validation error — nonsense is accepted (201) and simply not replied to. */
export const createSupportRequestBodySchema = z
  .object({
    kind: z.enum(SUPPORT_KINDS),
    category: z.enum(SUPPORT_CATEGORIES),
    body: z.string().trim().min(1).max(SUPPORT_BODY_MAX_LENGTH),
    app_version: deviceInfo,
    os_version: deviceInfo,
    device_model: deviceInfo,
  })
  .strict();

export type CreateSupportRequestBody = z.infer<typeof createSupportRequestBodySchema>;
