import { z } from 'zod';
import { CURRENCY_NAMES } from '../domain/currencies.js';

/** POST /notifications/push/devices(push-notifications-spec.md §3.1)。トークンは APNs の16進(大文字も受け、小文字で保存)。 */
export const registerPushDeviceBodySchema = z.object({
  device_token: z
    .string()
    .regex(/^[0-9a-fA-F]{64,200}$/, 'device_token must be the APNs device token as hex (64-200 chars)'),
  environment: z.enum(['SANDBOX', 'PRODUCTION']),
  app_version: z.string().min(1).max(32).optional(),
});

/** DELETE /notifications/push/devices/{id}。 */
export const pushDeviceParamsSchema = z.object({
  id: z.guid(),
});

const SUPPORTED_CURRENCIES = Object.keys(CURRENCY_NAMES) as [string, ...string[]];

/** PUT /notifications/push/favorite-currencies。空の配列 = お気に入り通貨なし。 */
export const putFavoriteCurrenciesBodySchema = z.object({
  currency_codes: z.array(z.enum(SUPPORTED_CURRENCIES)).max(SUPPORTED_CURRENCIES.length),
});

/** GET /notifications/push/history。 */
export const pushHistoryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
