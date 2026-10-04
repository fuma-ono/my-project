import { z } from 'zod';

export const updateAccountBodySchema = z
  .object({
    display_name: z.string().min(1).max(200).nullable().optional(),
  })
  .strict();

export type UpdateAccountBody = z.infer<typeof updateAccountBodySchema>;
