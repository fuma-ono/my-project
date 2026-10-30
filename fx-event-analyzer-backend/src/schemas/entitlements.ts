import { z } from 'zod';
import { isValidTimeZone } from '../domain/timezone.js';

/** IANA zone a plan's date limits are computed in (api-design.md §6). Default UTC. */
export const limitsTimeZoneSchema = z
  .string()
  .min(1)
  .refine(isValidTimeZone, 'must be a valid IANA time zone')
  .default('UTC');

/** GET /entitlements (api-design.md §27). */
export const entitlementsQuerySchema = z.object({
  timezone: limitsTimeZoneSchema,
});
