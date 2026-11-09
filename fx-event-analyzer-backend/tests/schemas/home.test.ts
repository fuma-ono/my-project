import { describe, expect, it } from 'vitest';
import { homeQuerySchema } from '../../src/schemas/home.js';

// api-design.md v1.50(HQ判断「ホームの『今日の重要イベント』→『今週の
// 重要イベント』」): `days`(任意、1〜7)を追加。未指定の既存アプリは
// 今までどおり動く(デフォルトはルート側(src/routes/home.ts)で1)。
describe('homeQuerySchema', () => {
  const parse = (query: unknown) => homeQuerySchema.safeParse(query);

  it('accepts date/timezone without days (backward compatible)', () => {
    const result = parse({ date: '2026-09-17', timezone: 'Asia/Tokyo' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.days).toBeUndefined();
  });

  it('accepts days within 1〜7', () => {
    for (const days of ['1', '7']) {
      const result = parse({ date: '2026-09-17', timezone: 'Asia/Tokyo', days });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.days).toBe(Number(days));
    }
  });

  it('rejects days outside 1〜7 and non-integers', () => {
    expect(parse({ date: '2026-09-17', timezone: 'Asia/Tokyo', days: '0' }).success).toBe(false);
    expect(parse({ date: '2026-09-17', timezone: 'Asia/Tokyo', days: '8' }).success).toBe(false);
    expect(parse({ date: '2026-09-17', timezone: 'Asia/Tokyo', days: '2.5' }).success).toBe(false);
  });

  it('still rejects a malformed date regardless of days', () => {
    expect(parse({ date: '2026/09/17', timezone: 'Asia/Tokyo', days: '7' }).success).toBe(false);
  });
});
