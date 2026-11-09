import { z } from 'zod';

export const listIndicatorsQuerySchema = z.object({
  q: z.string().min(1).max(200).optional(),
  country_code: z.string().min(1).max(10).optional(),
  currency_code: z.string().min(1).max(10).optional(),
  importance: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  sort: z.enum(['name', 'importance', 'created_at', 'next_release']).optional(),
});

export const listIndicatorEventsQuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  status: z.enum(['SCHEDULED', 'RELEASED', 'CANCELLED']).optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  sort: z.enum(['release_datetime']).optional(),
  // v1.31: 並び順。省略時は status=SCHEDULED なら asc(近い予定が先)、それ以外は desc(新しい発表が先)。
  order: z.enum(['asc', 'desc']).optional(),
});
