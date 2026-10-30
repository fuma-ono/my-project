import { z } from 'zod';

/** POST /subscription/verify body (api-design.md §25.1): StoreKit 2's
 * `Transaction.jwsRepresentation`, plus — when the client has it — the
 * subscription's `RenewalInfo.jwsRepresentation` (needed to tell ACTIVE
 * from CANCELED). */
export const verifySubscriptionBodySchema = z
  .object({
    signed_transaction: z.string().min(1),
    signed_renewal_info: z.string().min(1).optional(),
  })
  .strict();
