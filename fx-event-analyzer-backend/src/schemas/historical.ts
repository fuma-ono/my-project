import { z } from 'zod';

export const comparisonQuerySchema = z.object({
  // 任意: 価格由来の機能が無効(PRICE_FEATURES_ENABLED)のときは使わない(渡されても無視。値のみのモード)。
  // 有効のときの必須チェックは、ルート側(historical.ts)で VALIDATION_ERROR にする(従来と同じ 422)。
  fx_pair_id: z.string().min(1).optional(),
  timeframe: z.enum(['1m', '5m', '15m', '30m', '60m', 'all']).default('5m'),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
