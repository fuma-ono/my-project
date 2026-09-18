import { z } from 'zod';

export const comparisonQuerySchema = z.object({
  fx_pair_id: z.string().min(1),
  timeframe: z.enum(['1m', '5m', '15m', '30m', '60m', 'all']).default('5m'),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
