import { describe, expect, it } from 'vitest';
import { entitlementsQuerySchema } from '../../src/schemas/entitlements.js';

describe('entitlementsQuerySchema', () => {
  it('defaults timezone to UTC', () => {
    expect(entitlementsQuerySchema.parse({})).toEqual({ timezone: 'UTC' });
  });

  it('accepts an IANA zone and rejects an unknown one', () => {
    expect(entitlementsQuerySchema.parse({ timezone: 'America/New_York' })).toEqual({ timezone: 'America/New_York' });
    expect(entitlementsQuerySchema.safeParse({ timezone: 'Not/AZone' }).success).toBe(false);
  });
});
