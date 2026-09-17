import { z } from 'zod';

export const listIndicatorsQuerySchema = z.object({
  q: z.string().min(1).max(200).optional(),
  country_code: z.string().min(1).max(10).optional(),
  currency_code: z.string().min(1).max(10).optional(),
  importance: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  sort: z.enum(['name', 'importance', 'created_at']).optional(),
});
