import { z } from 'zod';

export const homeQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
  timezone: z.string().min(1),
  // api-design.md v1.50(HQ判断「ホームの『今日の重要イベント』→『今週の
  // 重要イベント』」): 任意。`date`から数える日数(1〜7、既定1=従来どおり
  // 1日分)。古いアプリ(このパラメータを送らない)は今までどおり1日分のまま。
  days: z.coerce.number().int().min(1).max(7).optional(),
});
