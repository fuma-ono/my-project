import { z } from 'zod';

export const homeQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
  timezone: z.string().min(1),
});
