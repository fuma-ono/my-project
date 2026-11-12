import { describe, expect, it } from 'vitest';
import { ApiError } from '../../src/errors/ApiError.js';
import { resolveSubscriptionState } from '../../src/storekit/appStoreTransaction.js';
import { renewalInfoPayload, TEST_BUNDLE_ID, transactionPayload } from '../helpers/storekitFixtures.js';

const USER_ID = '7f1c2a9e-3b4d-4e5f-8a6b-1c2d3e4f5a6b';
const NOW = Date.UTC(2026, 9, 2, 12, 0, 0);
const DAY_MS = 24 * 60 * 60 * 1000;
const options = { expectedBundleId: TEST_BUNDLE_ID, userId: USER_ID, now: new Date(NOW) };

function tx(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return transactionPayload(USER_ID, overrides, NOW);
}

function renewal(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return renewalInfoPayload(overrides, NOW);
}

function statusCodeOf(fn: () => unknown): number | null {
  try {
    fn();
    return null;
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    return (error as ApiError).statusCode;
  }
}

describe('resolveSubscriptionState', () => {
  it('maps an active, auto-renewing subscription to ACTIVE', () => {
    const state = resolveSubscriptionState(tx(), renewal(), options);
    expect(state).toEqual({
      originalTransactionId: '2000000000000001',
      transactionId: '2000000000000002',
      productId: 'com.fumaono.fxeventanalyzer.pro.monthly',
      environment: 'Sandbox',
      status: 'ACTIVE',
      startedAt: new Date(NOW - 2 * DAY_MS).toISOString(),
      expiresAt: new Date(NOW + 29 * DAY_MS).toISOString(),
      autoRenew: true,
      revokedAt: null,
    });
  });

  it('accepts the yearly product', () => {
    const state = resolveSubscriptionState(tx({ productId: 'com.fumaono.fxeventanalyzer.pro.yearly' }), null, options);
    expect(state.productId).toBe('com.fumaono.fxeventanalyzer.pro.yearly');
  });

  it('leaves autoRenew unknown (null) and status ACTIVE without renewal info', () => {
    const state = resolveSubscriptionState(tx(), null, options);
    expect(state.autoRenew).toBeNull();
    expect(state.status).toBe('ACTIVE');
  });

  it('is CANCELED when auto-renew is off but the period has not ended', () => {
    expect(resolveSubscriptionState(tx(), renewal({ autoRenewStatus: 0 }), options).status).toBe('CANCELED');
  });

  it('is TRIAL during a free-trial introductory offer', () => {
    const state = resolveSubscriptionState(tx({ offerType: 1, offerDiscountType: 'FREE_TRIAL' }), renewal(), options);
    expect(state.status).toBe('TRIAL');
  });

  it('is EXPIRED once expiresDate has passed', () => {
    expect(resolveSubscriptionState(tx({ expiresDate: NOW - 1 }), renewal(), options).status).toBe('EXPIRED');
  });

  it('is EXPIRED when revoked (refund), recording revokedAt', () => {
    const state = resolveSubscriptionState(tx({ revocationDate: NOW - 1000 }), renewal(), options);
    expect(state.status).toBe('EXPIRED');
    expect(state.revokedAt).toBe(new Date(NOW - 1000).toISOString());
  });

  it('matches appAccountToken case-insensitively', () => {
    const state = resolveSubscriptionState(tx({ appAccountToken: USER_ID.toUpperCase() }), null, options);
    expect(state.status).toBe('ACTIVE');
  });

  it('rejects a purchase made by another account with 403', () => {
    const other = tx({ appAccountToken: '00000000-0000-4000-8000-000000000000' });
    expect(statusCodeOf(() => resolveSubscriptionState(other, null, options))).toBe(403);
  });

  it('rejects a purchase without appAccountToken with 403', () => {
    expect(statusCodeOf(() => resolveSubscriptionState(tx({ appAccountToken: undefined }), null, options))).toBe(403);
  });

  it.each([
    ['another bundle id', { bundleId: 'com.example.other' }],
    ['an unknown product', { productId: 'com.fumaono.fxeventanalyzer.pro.weekly' }],
    ['a non-subscription purchase', { type: 'Non-Consumable' }],
    ['an unsupported environment', { environment: 'Xcode' }],
    ['a missing expiresDate', { expiresDate: undefined }],
    ['a missing transactionId', { transactionId: undefined }],
  ])('rejects %s with 422', (_label, overrides) => {
    expect(statusCodeOf(() => resolveSubscriptionState(tx(overrides), null, options))).toBe(422);
  });

  it('rejects renewal info belonging to another subscription with 422', () => {
    const other = renewal({ originalTransactionId: '9999' });
    expect(statusCodeOf(() => resolveSubscriptionState(tx(), other, options))).toBe(422);
  });
});
