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

/** GET /speeches/{id}/reaction (api-design.md §14.8) — same query as GET /events/{id}/reaction. */
export const speechReactionQuerySchema = z.object({
  fx_pair_id: z.guid(),
  timeframe: z.enum(['1m', '5m', '15m', '30m', '60m', 'all']).default('all'),
});

/** GET /speeches/{id}/reaction/chart (api-design.md §14.9) — same query as the event chart. */
export const speechChartQuerySchema = z.object({
  fx_pair_id: z.guid(),
  timeframe: z.enum(['1m', '5m', '15m', '30m', '60m']),
});

export const speakerParamsSchema = z.object({
  speaker_id: z.guid(),
});

/** GET /speakers/{id}/comparison (api-design.md §14.10). fx_pair_id omitted = the speaker's first pair. */
export const speakerComparisonQuerySchema = z.object({
  fx_pair_id: z.guid().optional(),
});
