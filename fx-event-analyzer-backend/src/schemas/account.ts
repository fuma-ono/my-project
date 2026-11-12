import { z } from 'zod';

/** A real calendar date (YYYY-MM-DD) between 1900-01-01 and today (UTC). */
const birthDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, 'Not a real calendar date.')
  .refine((value) => value >= '1900-01-01' && value <= new Date().toISOString().slice(0, 10), 'Out of range.');

export const updateAccountBodySchema = z
  .object({
    display_name: z.string().trim().min(1).max(200).nullable().optional(),
    birth_date: birthDateSchema.nullable().optional(),
  })
  .strict();

export type UpdateAccountBody = z.infer<typeof updateAccountBodySchema>;
