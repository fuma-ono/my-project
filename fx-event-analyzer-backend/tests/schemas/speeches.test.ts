import { describe, expect, it } from 'vitest';
import { listSpeechesQuerySchema, speechParamsSchema } from '../../src/schemas/speeches.js';
import { upcomingNotificationsQuerySchema } from '../../src/schemas/notifications.js';

describe('listSpeechesQuerySchema', () => {
  const parse = (query: unknown) => listSpeechesQuerySchema.safeParse(query).success;

  it('accepts an empty query and every documented filter', () => {
    expect(parse({})).toBe(true);
    expect(
      parse({
        from: '2026-10-01T00:00:00Z',
        to: '2026-10-08T00:00:00+09:00',
        importance: 'HIGH',
        currency: 'USD',
        page: '2',
        limit: '50',
      }),
    ).toBe(true);
  });

  it('rejects malformed values', () => {
    expect(parse({ from: '2026-10-01' })).toBe(false);
    expect(parse({ importance: 'high' })).toBe(false);
    expect(parse({ currency: 'usd' })).toBe(false);
    expect(parse({ currency: 'USDX' })).toBe(false);
    expect(parse({ limit: '101' })).toBe(false);
  });
});

describe('speechParamsSchema', () => {
  it('accepts any 8-4-4-4-12 hex id (including seed-style ids) and rejects others', () => {
    expect(speechParamsSchema.safeParse({ speech_id: '50000000-0000-0000-0000-000000000001' }).success).toBe(true);
    expect(speechParamsSchema.safeParse({ speech_id: 'not-a-uuid' }).success).toBe(false);
  });
});

describe('upcomingNotificationsQuerySchema', () => {
  const parse = (query: unknown) => upcomingNotificationsQuerySchema.safeParse(query).success;

  it('accepts optional ISO datetimes', () => {
    expect(parse({})).toBe(true);
    expect(parse({ from: '2026-10-05T00:00:00Z', to: '2026-10-12T00:00:00Z' })).toBe(true);
  });

  it('rejects non-ISO values', () => {
    expect(parse({ from: 'tomorrow' })).toBe(false);
    expect(parse({ to: '2026-10-12' })).toBe(false);
  });
});
