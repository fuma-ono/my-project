import { z } from 'zod';

/** GET /speeches (api-design.md §14.4). `from` inclusive, `to` exclusive (§6). */
export const listSpeechesQuerySchema = z.object({
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  importance: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional(),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/, 'must be an ISO 4217 code')
    .optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

/** z.guid() rather than z.uuid(): any 8-4-4-4-12 hex id, as Postgres accepts
 * (z.uuid() also enforces the RFC version/variant bits, which seed ids lack). */
export const speechParamsSchema = z.object({
  speech_id: z.guid(),
});
