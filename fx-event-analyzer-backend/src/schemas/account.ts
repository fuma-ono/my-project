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

/** DELETE /account body. The whole body is optional: builds that predate Sign
 * in with Apple token revocation send none. Unknown fields are ignored. */
export const deleteAccountBodySchema = z
  .object({
    apple_authorization_code: z.string().min(1).max(4096).optional(),
  })
  .nullish();

export type DeleteAccountBody = z.infer<typeof deleteAccountBodySchema>;
