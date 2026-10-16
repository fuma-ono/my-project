import { describe, expect, it } from 'vitest';
import {
  FEATURE_CODES,
  hasEntitlement,
  listActiveFeatureCodes,
  requireEntitlement,
} from '../../src/authorization/entitlements.js';
import { resolvePlan } from '../../src/authorization/plan.js';
import { ApiError } from '../../src/errors/ApiError.js';
import { fakeSupabaseClient } from '../helpers/fakeSupabaseClient.js';

const USER = 'user-1';
const OTHER_USER = 'user-2';

describe('hasEntitlement', () => {
  it('is true for an enabled, non-expired entitlement row', () => {
    const supabase = fakeSupabaseClient({
      entitlements: [{ user_id: USER, feature_code: 'VIEW_HISTORICAL', enabled: true, expires_at: null }],
    });
    return expect(hasEntitlement(supabase, USER, FEATURE_CODES.VIEW_HISTORICAL)).resolves.toBe(true);
  });

  it('is false when no row exists for the user at all', () => {
    const supabase = fakeSupabaseClient({ entitlements: [] });
    return expect(hasEntitlement(supabase, USER, FEATURE_CODES.VIEW_HISTORICAL)).resolves.toBe(false);
  });

  it('is false when the row is disabled', () => {
    const supabase = fakeSupabaseClient({
      entitlements: [{ user_id: USER, feature_code: 'VIEW_HISTORICAL', enabled: false, expires_at: null }],
    });
    return expect(hasEntitlement(supabase, USER, FEATURE_CODES.VIEW_HISTORICAL)).resolves.toBe(false);
  });

  it('is false when the row has expired', () => {
    const supabase = fakeSupabaseClient({
      entitlements: [
        { user_id: USER, feature_code: 'VIEW_HISTORICAL', enabled: true, expires_at: '2020-01-01T00:00:00Z' },
      ],
    });
    return expect(hasEntitlement(supabase, USER, FEATURE_CODES.VIEW_HISTORICAL)).resolves.toBe(false);
  });

  it('is true when the row has not expired yet', () => {
    const supabase = fakeSupabaseClient({
      entitlements: [
        { user_id: USER, feature_code: 'VIEW_HISTORICAL', enabled: true, expires_at: '2099-01-01T00:00:00Z' },
      ],
    });
    return expect(hasEntitlement(supabase, USER, FEATURE_CODES.VIEW_HISTORICAL)).resolves.toBe(true);
  });

  it('never lets one user pick up another user’s entitlement row (isolation)', () => {
    const supabase = fakeSupabaseClient({
      entitlements: [{ user_id: OTHER_USER, feature_code: 'VIEW_HISTORICAL', enabled: true, expires_at: null }],
    });
    return expect(hasEntitlement(supabase, USER, FEATURE_CODES.VIEW_HISTORICAL)).resolves.toBe(false);
  });

  it('does not confuse a different feature_code as satisfying the check', () => {
    const supabase = fakeSupabaseClient({
      entitlements: [{ user_id: USER, feature_code: 'VIEW_BASIC_EVENT', enabled: true, expires_at: null }],
    });
    return expect(hasEntitlement(supabase, USER, FEATURE_CODES.VIEW_HISTORICAL)).resolves.toBe(false);
  });
});

describe('requireEntitlement', () => {
  it('resolves silently when the user has the entitlement', async () => {
    const supabase = fakeSupabaseClient({
      entitlements: [{ user_id: USER, feature_code: 'VIEW_MARKET_REACTION', enabled: true, expires_at: null }],
    });
    await expect(requireEntitlement(supabase, USER, FEATURE_CODES.VIEW_MARKET_REACTION)).resolves.toBeUndefined();
  });

  it('throws a 403 FEATURE_NOT_ENTITLED ApiError when the user lacks the entitlement', async () => {
    const supabase = fakeSupabaseClient({ entitlements: [] });
    await expect(requireEntitlement(supabase, USER, FEATURE_CODES.VIEW_MARKET_REACTION)).rejects.toMatchObject({
      code: 'FEATURE_NOT_ENTITLED',
      statusCode: 403,
    });
  });

  it('the rejection is a genuine ApiError instance, so the global error handler maps it correctly', async () => {
    const supabase = fakeSupabaseClient({ entitlements: [] });
    try {
      await requireEntitlement(supabase, USER, FEATURE_CODES.VIEW_ADVANCED_STATS);
      expect.unreachable('requireEntitlement should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
    }
  });
});

describe('listActiveFeatureCodes / resolvePlan', () => {
  it('lists only active rows', async () => {
    const supabase = fakeSupabaseClient({
      entitlements: [
        { user_id: USER, feature_code: 'VIEW_BASIC_EVENT', enabled: true, expires_at: null },
        { user_id: USER, feature_code: 'VIEW_HISTORICAL', enabled: false, expires_at: null },
        { user_id: USER, feature_code: 'VIEW_MARKET_REACTION', enabled: true, expires_at: '2020-01-01T00:00:00Z' },
      ],
    });
    await expect(listActiveFeatureCodes(supabase, USER)).resolves.toEqual(['VIEW_BASIC_EVENT']);
  });

  it('is PRO with an active VIEW_ADVANCED_STATS, FREE otherwise (disabled / expired / none)', async () => {
    const row = (enabled: boolean, expires_at: string | null) => ({
      user_id: USER,
      feature_code: 'VIEW_ADVANCED_STATS',
      enabled,
      expires_at,
    });
    await expect(resolvePlan(fakeSupabaseClient({ entitlements: [row(true, null)] }), USER)).resolves.toBe('PRO');
    await expect(
      resolvePlan(fakeSupabaseClient({ entitlements: [row(true, '2099-01-01T00:00:00Z')] }), USER),
    ).resolves.toBe('PRO');
    await expect(resolvePlan(fakeSupabaseClient({ entitlements: [row(false, null)] }), USER)).resolves.toBe('FREE');
    await expect(
      resolvePlan(fakeSupabaseClient({ entitlements: [row(true, '2020-01-01T00:00:00Z')] }), USER),
    ).resolves.toBe('FREE');
    await expect(resolvePlan(fakeSupabaseClient({ entitlements: [] }), USER)).resolves.toBe('FREE');
  });

  it('never picks up another user’s PRO row', async () => {
    const supabase = fakeSupabaseClient({
      entitlements: [{ user_id: OTHER_USER, feature_code: 'VIEW_ADVANCED_STATS', enabled: true, expires_at: null }],
    });
    await expect(resolvePlan(supabase, USER)).resolves.toBe('FREE');
  });
});

describe('default_entitlements (HQ instruction 2026-10-16)', () => {
  const DEFAULTS = [
    { feature_code: 'VIEW_BASIC_EVENT' },
    { feature_code: 'VIEW_HISTORICAL' },
    { feature_code: 'VIEW_MARKET_REACTION' },
  ];

  it('grants a default feature to a user with no entitlement row', async () => {
    const supabase = fakeSupabaseClient({ entitlements: [], default_entitlements: DEFAULTS });
    await expect(hasEntitlement(supabase, USER, FEATURE_CODES.VIEW_BASIC_EVENT)).resolves.toBe(true);
    await expect(requireEntitlement(supabase, USER, FEATURE_CODES.VIEW_MARKET_REACTION)).resolves.toBeUndefined();
    await expect(listActiveFeatureCodes(supabase, USER)).resolves.toEqual([
      'VIEW_BASIC_EVENT',
      'VIEW_HISTORICAL',
      'VIEW_MARKET_REACTION',
    ]);
  });

  it('an explicit disabled row overrides the default', async () => {
    const supabase = fakeSupabaseClient({
      entitlements: [{ user_id: USER, feature_code: 'VIEW_HISTORICAL', enabled: false, expires_at: null }],
      default_entitlements: DEFAULTS,
    });
    await expect(hasEntitlement(supabase, USER, FEATURE_CODES.VIEW_HISTORICAL)).resolves.toBe(false);
    await expect(requireEntitlement(supabase, USER, FEATURE_CODES.VIEW_HISTORICAL)).rejects.toMatchObject({
      code: 'FEATURE_NOT_ENTITLED',
      statusCode: 403,
    });
    await expect(listActiveFeatureCodes(supabase, USER)).resolves.toEqual(['VIEW_BASIC_EVENT', 'VIEW_MARKET_REACTION']);
  });

  it('an explicit expired row overrides the default', async () => {
    const supabase = fakeSupabaseClient({
      entitlements: [
        { user_id: USER, feature_code: 'VIEW_MARKET_REACTION', enabled: true, expires_at: '2020-01-01T00:00:00Z' },
      ],
      default_entitlements: DEFAULTS,
    });
    await expect(hasEntitlement(supabase, USER, FEATURE_CODES.VIEW_MARKET_REACTION)).resolves.toBe(false);
  });

  it('another user’s disabled row does not revoke this user’s default', async () => {
    const supabase = fakeSupabaseClient({
      entitlements: [{ user_id: OTHER_USER, feature_code: 'VIEW_HISTORICAL', enabled: false, expires_at: null }],
      default_entitlements: DEFAULTS,
    });
    await expect(hasEntitlement(supabase, USER, FEATURE_CODES.VIEW_HISTORICAL)).resolves.toBe(true);
  });

  it('a non-default feature (VIEW_ADVANCED_STATS) still needs an active row', async () => {
    const without = fakeSupabaseClient({ entitlements: [], default_entitlements: DEFAULTS });
    await expect(hasEntitlement(without, USER, FEATURE_CODES.VIEW_ADVANCED_STATS)).resolves.toBe(false);
    const withRow = fakeSupabaseClient({
      entitlements: [{ user_id: USER, feature_code: 'VIEW_ADVANCED_STATS', enabled: true, expires_at: null }],
      default_entitlements: DEFAULTS,
    });
    await expect(hasEntitlement(withRow, USER, FEATURE_CODES.VIEW_ADVANCED_STATS)).resolves.toBe(true);
    await expect(listActiveFeatureCodes(withRow, USER)).resolves.toEqual([
      'VIEW_ADVANCED_STATS',
      'VIEW_BASIC_EVENT',
      'VIEW_HISTORICAL',
      'VIEW_MARKET_REACTION',
    ]);
  });

  it('a user with only the defaults is FREE', async () => {
    const supabase = fakeSupabaseClient({ entitlements: [], default_entitlements: DEFAULTS });
    await expect(resolvePlan(supabase, USER)).resolves.toBe('FREE');
  });
});
